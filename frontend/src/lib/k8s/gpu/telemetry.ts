/*
 * Copyright 2026 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * 文件描述：用Headlamp当前用户身份读取GPU设备、分配和历史数据。
 * 项目名称：Headlamp BBT
 * 文件名称：telemetry.ts
 * 作者：Codex
 * 日期：2026-11-23
 */

import { response, type Transport } from './client';
import { type ConnectionConfig, defaultConfig, queryPath } from './config';
import { discoverSources } from './discovery';
import {
  fields,
  freshQuery,
  type Gpu,
  identity,
  normalize,
  type Series,
  workload,
} from './metrics';
import { gpuWorkloads, type PhysicalGpu, physicalGpus } from './summary';

const preferredServices = [
  { namespace: 'monitoring', service: 'prometheus-stack-kube-prom-prometheus' },
  { namespace: 'monitor', service: 'prometheus-kube-prometheus-prometheus' },
];

export interface GpuTelemetry {
  config: ConnectionConfig;
  cards: PhysicalGpu[];
  unmappedNodes: Set<string>;
  sampledAt: number;
}

export interface GpuRange {
  series: Series[];
  start: number;
  end: number;
  step: number;
}

/** 通过所选集群的API代理读取指标。 */
async function query(
  request: Transport,
  cluster: string,
  config: ConnectionConfig,
  params: URLSearchParams,
  signal: AbortSignal,
  kind: 'vector' | 'matrix'
) {
  const api = kind === 'vector' ? 'query' : 'query_range';
  const result = await request(`${queryPath(config, api)}?${params}`, {
    cluster,
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    timeout: 15000,
    autoLogoutOnAuthError: false,
  });
  return response(result, kind).series;
}

/** 优先尝试已有Prometheus服务，其他集群通过实际发现获得可用的唯一指标源。 */
export async function loadGpuTelemetry(
  request: Transport,
  cluster: string,
  signal: AbortSignal
): Promise<GpuTelemetry | undefined> {
  const probe = (config: ConnectionConfig) =>
    query(
      request,
      cluster,
      config,
      new URLSearchParams({ query: freshQuery(config), limit: '1000' }),
      signal,
      'vector'
    );
  const preferred = preferredServices.map(service => ({ ...defaultConfig, ...service }));
  const answers = await Promise.allSettled(preferred.map(probe));
  signal.throwIfAborted();
  const index = answers.findIndex(
    answer => answer.status === 'fulfilled' && answer.value.length > 0
  );
  let config: ConnectionConfig;
  let series: Series[];
  if (index >= 0) {
    config = preferred[index];
    series = (answers[index] as PromiseFulfilledResult<Series[]>).value;
  } else {
    const { sources } = await discoverSources(request, cluster, signal);
    const proven = sources.filter(source => source.automatic);
    if (proven.length !== 1) return undefined;
    config = proven[0].config;
    series = await probe(config);
  }
  const devices = normalize(series).devices;
  const cards = physicalGpus(devices);
  if (!cards.length) return undefined;

  const mapped = new Set(
    devices.flatMap(gpu => gpuWorkloads(gpu).map(item => `${item.namespace}/${item.pod}`))
  );
  const unmappedNodes = new Set<string>();
  const allocationQuery =
    'max by(namespace,pod,node,resource) (kube_pod_container_resource_requests{resource=~".*(vgpu|mirage_gpu).*"} > 0) and on(namespace,pod) (kube_pod_status_phase{phase="Running"} == 1)';
  try {
    const [allocations, shared] = await Promise.all([
      query(
        request,
        cluster,
        config,
        new URLSearchParams({ query: allocationQuery }),
        signal,
        'vector'
      ),
      query(
        request,
        cluster,
        config,
        new URLSearchParams({
          query:
            'max by(NodeName,devID) (volcano_vgpu_device_shared_number and (timestamp(volcano_vgpu_device_shared_number) > time() - 120))',
        }),
        signal,
        'vector'
      ),
    ]);
    const sharedCounts = new Map(
      shared.map(({ metric, value }) => [
        JSON.stringify([metric.NodeName, metric.devID]),
        Number(value?.[1]),
      ])
    );
    const completeNodes = new Set(
      cards
        .map(card => card.node)
        .filter(node =>
          cards
            .filter(card => card.node === node)
            .every(card => {
              const count = sharedCounts.get(JSON.stringify([node, card.acceleratorId]));
              return count !== undefined && Number.isInteger(count) && count >= 0;
            })
        )
    );
    for (const card of cards) {
      if (!completeNodes.has(card.node)) continue;
      const count = sharedCounts.get(JSON.stringify([card.node, card.acceleratorId]));
      card.occupied ||= count !== undefined && count > 0;
    }
    for (const { metric } of allocations) {
      if (
        !mapped.has(`${metric.namespace}/${metric.pod}`) &&
        !(metric.resource?.startsWith('volcano_sh_vgpu') && completeNodes.has(metric.node))
      )
        unmappedNodes.add(metric.node || '*');
    }
  } catch (error) {
    signal.throwIfAborted();
    // 无法读取共享GPU归属时，空闲数量仍然未知。
    unmappedNodes.add('*');
  }
  return { config, cards, unmappedNodes, sampledAt: Date.now() };
}

/** 指定节点或整个集群的物理卡占用数量是否可确认。 */
export function gpuOccupationKnown(data: GpuTelemetry | undefined, node?: string): boolean {
  return (
    !!data &&
    !data.unmappedNodes.has('*') &&
    (node ? !data.unmappedNodes.has(node) : data.unmappedNodes.size === 0)
  );
}

/** 读取同一连接的历史，保留采样间隔，最多约240个点。 */
export async function loadGpuRange(
  request: Transport,
  cluster: string,
  config: ConnectionConfig,
  hours: number,
  signal: AbortSignal
): Promise<GpuRange> {
  const step = Math.max(30, Math.ceil((hours * 3600) / 240));
  const end = Math.floor(Date.now() / 1000 / step) * step;
  const start = end - hours * 3600;
  const params = new URLSearchParams({
    query: freshQuery(config),
    start: String(start),
    end: String(end),
    step: String(step),
    limit: '1000',
  });
  return {
    start,
    end,
    step,
    series: await query(request, cluster, config, params, signal, 'matrix'),
  };
}

export interface GpuPodAccess {
  allowed: boolean;
  startedAt?: number;
}

/** 按当前Kubernetes权限读取各占用Pod的本次启动时间。 */
export async function loadGpuPods(
  request: Transport,
  cluster: string,
  cards: readonly PhysicalGpu[],
  signal: AbortSignal
): Promise<Record<string, GpuPodAccess>> {
  const workloads = new Map(
    cards.flatMap(card =>
      card.devices.flatMap(device =>
        gpuWorkloads(device).map(item => [`${item.namespace}/${item.pod}`, item] as const)
      )
    )
  );
  const entries = [...workloads.entries()];
  const result: Record<string, GpuPodAccess> = {};
  for (let offset = 0; offset < entries.length; offset += 8) {
    signal.throwIfAborted();
    await Promise.all(
      entries.slice(offset, offset + 8).map(async ([key, item]) => {
        const path = `/api/v1/namespaces/${encodeURIComponent(
          item.namespace
        )}/pods/${encodeURIComponent(item.pod)}`;
        try {
          const pod = (await request(path, {
            cluster,
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
            timeout: 5000,
            autoLogoutOnAuthError: false,
          })) as { status?: { startTime?: string } };
          const startedAt = Date.parse(pod?.status?.startTime ?? '');
          result[key] = {
            allowed: true,
            startedAt: Number.isFinite(startedAt) ? startedAt : undefined,
          };
        } catch (error) {
          signal.throwIfAborted();
          result[key] = { allowed: false };
        }
      })
    );
  }
  return result;
}

/** 以连续有效历史估算空闲起点，不把没有采样的时间算作空闲。 */
export function gpuIdleAge(device: Gpu, range: GpuRange, now: number) {
  const labelsByTime = new Map<number, { idle: boolean; busy: boolean }>();
  for (const item of range.series) {
    if (item.metric.__name__ !== fields.memoryUsed || identity(item.metric)?.id !== device.id)
      continue;
    const owner = workload(item.metric);
    if (!owner.namespace || !owner.pod) continue;
    for (const [time] of item.values ?? []) {
      const entry = labelsByTime.get(time) ?? { idle: false, busy: false };
      if (owner.namespace === 'gpu-operator') entry.idle = true;
      else entry.busy = true;
      labelsByTime.set(time, entry);
    }
  }
  let firstIdle: number | undefined;
  let lowerBound = true;
  for (let time = range.end; time >= range.start; time -= range.step) {
    const owner = labelsByTime.get(time);
    if (!owner) break;
    if (owner.busy || !owner.idle) {
      lowerBound = !owner.busy;
      break;
    }
    firstIdle = time;
  }
  return firstIdle === undefined
    ? undefined
    : {
        milliseconds: Math.max(0, now - firstIdle * 1000),
        lowerBound,
      };
}
