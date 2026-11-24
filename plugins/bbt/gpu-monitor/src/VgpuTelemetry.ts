/*
 * 文件描述：读取Volcano的vGPU分配与HAMi的Pod用量。
 * 项目名称：Headlamp BBT
 * 文件名称：VgpuTelemetry.ts
 * 作者：Codex
 * 日期：2026-11-24
 */

import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { load } from 'js-yaml';
import { response } from '../../../../frontend/src/lib/k8s/gpu/client';
import { queryPath } from '../../../../frontend/src/lib/k8s/gpu/config';
import type { GpuTelemetry } from '../../../../frontend/src/lib/k8s/gpu/telemetry';

export interface HamiContainerUsage {
  container: string;
  utilization?: number;
  usedBytes?: number;
  limitBytes?: number;
}

export interface VgpuAllocation {
  count: number;
  capacity?: number;
  allocatedMemory?: number;
  memoryCapacity?: number;
  memoryBytesPerUnit?: number;
  allocatedCores?: number;
  coreCapacity?: number;
  workloads: {
    name: string;
    namespace: string;
    pod: string;
    startedAt: number;
    memory: number;
    cores: number;
    usage: Map<string, HamiContainerUsage>;
  }[];
}

const fields = {
  count: 'volcano_vgpu_device_shared_number',
  allocatedMemory: 'volcano_vgpu_device_allocated_memory',
  memoryCapacity: 'volcano_vgpu_device_memory_limit',
  allocatedCores: 'volcano_vgpu_device_allocated_cores',
} as const;

const usageFields = {
  Device_utilization_desc_of_container: 'utilization',
  vGPU_device_memory_usage_in_bytes: 'usedBytes',
  vGPU_device_memory_limit_in_bytes: 'limitBytes',
} as const;

/** 将HAMi输出的字节数格式化为GiB。 */
export function vgpuMemory(bytes?: number) {
  return bytes === undefined ? '—' : `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

/** 只有已分配量和总量都已知时才计算比例。 */
export function quotaRatio(used?: number, capacity?: number) {
  return used !== undefined && capacity !== undefined && capacity > 0
    ? `${Math.round((1000 * used) / capacity) / 10}%`
    : undefined;
}

/** 格式化当前物理卡的已分配量、可分配总量和调度比例。 */
export function vgpuResources(allocation: VgpuAllocation) {
  const {
    count,
    capacity,
    allocatedMemory,
    memoryCapacity,
    memoryBytesPerUnit,
    allocatedCores,
    coreCapacity,
  } = allocation;
  const asGiB = (units?: number) =>
    units === undefined || memoryBytesPerUnit === undefined
      ? '—'
      : ((units * memoryBytesPerUnit) / 1024 ** 3).toFixed(2);

  return [
    {
      label: 'vGPU slots',
      value: `${count}/${capacity ?? '—'}`,
      ratio: undefined,
    },
    {
      label:
        memoryBytesPerUnit === undefined ? 'vGPU memory allocation units' : 'vGPU memory quota',
      value:
        memoryBytesPerUnit === undefined
          ? `${allocatedMemory ?? '—'}/${memoryCapacity ?? '—'}`
          : `${asGiB(allocatedMemory)}/${asGiB(memoryCapacity)} GiB`,
      ratio: quotaRatio(allocatedMemory, memoryCapacity),
    },
    {
      label: 'vGPU compute quota',
      value: `${allocatedCores ?? '—'}/${coreCapacity ?? '—'}`,
      ratio: quotaRatio(allocatedCores, coreCapacity),
    },
  ];
}

/** 根据Volcano指标和当前用户可读取的节点、Pod注解，补充每张卡的vGPU资源。 */
export async function loadVgpuTelemetry(cluster: string, data: GpuTelemetry, signal: AbortSignal) {
  const options = {
    cluster,
    signal,
    timeout: 12000,
    autoLogoutOnAuthError: false,
  };
  const query = async (expression: string) => {
    const path = queryPath(data.config, 'query');
    const params = new URLSearchParams({ query: expression });
    return response(await request(`${path}?${params}`, options), 'vector').series;
  };
  const samples = await query(
    `max by (__name__,NodeName,devID) (${Object.values(fields)
      .map(name => `(${name} and (timestamp(${name}) > time() - 120))`)
      .join(' or on (__name__) ')})`
  );
  const cardsByDevice = new Map(
    data.cards.map(card => [JSON.stringify([card.node, card.acceleratorId]), card])
  );
  const cardsByNode = new Set<string>();
  const result = new Map<string, VgpuAllocation>();
  for (const { metric, value } of samples) {
    if (metric.__name__ !== fields.count) continue;
    const card = cardsByDevice.get(JSON.stringify([metric.NodeName, metric.devID]));
    const count = Number(value?.[1]);
    if (!card || !Number.isInteger(count) || count < 0) continue;
    result.set(card.id, { count, workloads: [] });
    cardsByNode.add(card.node);
  }
  for (const { metric, value } of samples) {
    const card = cardsByDevice.get(JSON.stringify([metric.NodeName, metric.devID]));
    const allocation = card && result.get(card.id);
    const amount = Number(value?.[1]);
    if (!allocation || !Number.isFinite(amount) || amount < 0) continue;
    if (metric.__name__ === fields.allocatedMemory) allocation.allocatedMemory = amount;
    if (metric.__name__ === fields.memoryCapacity) allocation.memoryCapacity = amount;
    if (metric.__name__ === fields.allocatedCores) allocation.allocatedCores = amount;
  }
  const readMemoryFactor = result.size
    ? request('/api/v1/namespaces/kube-system/configmaps/volcano-vgpu-device-config', options)
        .then(raw => {
          const yaml = (raw as { data?: Record<string, string> })?.data?.['device-config.yaml'];
          if (!yaml) return;
          const factor = (load(yaml) as { nvidia?: { gpuMemoryFactor?: number } })?.nvidia
            ?.gpuMemoryFactor;
          if (factor !== undefined && Number.isInteger(factor) && factor > 0) {
            for (const allocation of result.values())
              allocation.memoryBytesPerUnit = factor * 1024 ** 2;
          }
        })
        .catch(() => undefined)
    : undefined;
  const readCapacities = Promise.all(
    [...cardsByNode].map(async node => {
      const resource = (await request(`/api/v1/nodes/${encodeURIComponent(node)}`, options).catch(
        () => undefined
      )) as
        | {
            metadata?: { annotations?: Record<string, string> };
            status?: { allocatable?: Record<string, string> };
          }
        | undefined;
      signal.throwIfAborted();
      const registration = resource?.metadata?.annotations?.['volcano.sh/node-vgpu-register'] ?? '';
      const registrations = [
        ...registration.matchAll(
          /(GPU-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}),(\d+),\d+,[^,:]+,(true|false)(?:,([^:]+))?(?=:|$)/gi
        ),
      ];
      const healthy = registrations.filter(([, , , ready]) => ready === 'true');
      const nodeSlots = Number(resource?.status?.allocatable?.['volcano.sh/vgpu-number']);
      const nodeCores = Number(resource?.status?.allocatable?.['volcano.sh/vgpu-cores']);
      const coresPerCard = nodeCores / healthy.length;
      const registeredSlots = healthy.reduce((total, [, , slots]) => total + Number(slots), 0);
      const confirmedCoreCapacity =
        nodeSlots === registeredSlots && coresPerCard > 0 && Number.isInteger(coresPerCard);
      for (const [, uuid, slots, modeReady, mode] of registrations) {
        const card = cardsByDevice.get(JSON.stringify([node, uuid]));
        const allocation = card && result.get(card.id);
        if (!allocation || modeReady !== 'true') continue;
        allocation.capacity = Number(slots);
        if (mode === 'hami-core' && confirmedCoreCapacity) allocation.coreCapacity = coresPerCard;
      }
    })
  );
  const readCandidates = [...result.values()].some(item => item.count > 0)
    ? query(
        'max by(namespace,pod,node) (kube_pod_container_resource_requests{resource="volcano_sh_vgpu_number"} > 0) and on(namespace,pod) (kube_pod_status_phase{phase="Running"} == 1)'
      )
    : Promise.resolve([]);
  const [candidates] = await Promise.all([readCandidates, readCapacities, readMemoryFactor]);
  for (const {
    metric: { node, namespace, pod },
  } of candidates) {
    if (!node || !namespace || !pod) continue;
    const path = `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(
      pod
    )}`;
    const owner = (await request(path, options).catch(() => undefined)) as
      | {
          metadata?: { annotations?: Record<string, string> };
          spec?: { nodeName?: string };
          status?: { phase?: string; startTime?: string };
        }
      | undefined;
    signal.throwIfAborted();
    if (owner?.spec?.nodeName !== node || owner.status?.phase !== 'Running') continue;
    const assignment = owner.metadata?.annotations?.['volcano.sh/vgpu-ids-new'] ?? '';
    for (const [, uuid, memory, cores] of assignment.matchAll(
      /(GPU-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}),[^,:;]+,(\d+),(\d+)/gi
    )) {
      const card = cardsByDevice.get(JSON.stringify([node, uuid]));
      const allocation = card && result.get(card.id);
      if (!allocation?.count) continue;
      const name = `${namespace}/${pod}`;
      const current = allocation.workloads.find(item => item.name === name);
      if (current) {
        current.memory += Number(memory);
        current.cores += Number(cores);
      } else {
        allocation.workloads.push({
          name,
          namespace,
          pod,
          startedAt: Date.parse(owner.status.startTime ?? ''),
          memory: Number(memory),
          cores: Number(cores),
          usage: new Map(),
        });
      }
    }
  }

  const visiblePods = new Map<string, VgpuAllocation['workloads'][number]>();
  const podsByNamespace = new Map<string, Set<string>>();
  for (const card of data.cards) {
    for (const workload of result.get(card.id)?.workloads ?? []) {
      visiblePods.set(JSON.stringify([card.node, card.acceleratorId, workload.name]), workload);
      const pods = podsByNamespace.get(workload.namespace) ?? new Set();
      pods.add(workload.pod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      podsByNamespace.set(workload.namespace, pods);
    }
  }
  if (!visiblePods.size) return result;
  const hamiSamples = await Promise.allSettled(
    [...podsByNamespace].map(([namespace, pods]) => {
      const filter = `job="bbt-hami-vgpu-pods",podnamespace=${JSON.stringify(
        namespace
      )},podname=~${JSON.stringify([...pods].join('|'))}`;
      const expression = Object.keys(usageFields)
        .map(metric => {
          const series = `${metric}{${filter}}`;
          return `(${series} and (timestamp(${series}) > time() - 120))`;
        })
        .join(' or on (__name__) ');
      return query(
        `max by (__name__,hami_node,deviceuuid,podnamespace,podname,ctrname,vdeviceid) (${expression})`
      );
    })
  );
  signal.throwIfAborted();
  for (const answer of hamiSamples) {
    if (answer.status !== 'fulfilled') continue;
    for (const { metric, value } of answer.value) {
      const name = `${metric.podnamespace}/${metric.podname}`;
      const workload = visiblePods.get(JSON.stringify([metric.hami_node, metric.deviceuuid, name]));
      const field = usageFields[metric.__name__ as keyof typeof usageFields];
      const measurement = Number(value?.[1]);
      if (
        !workload ||
        !field ||
        !metric.ctrname ||
        !Number.isFinite(measurement) ||
        measurement < 0
      )
        continue;
      if (field === 'utilization' && measurement > 100) continue;
      const key = JSON.stringify([metric.ctrname, metric.vdeviceid]);
      const usage = workload.usage.get(key) ?? { container: metric.ctrname };
      usage[field] = measurement;
      workload.usage.set(key, usage);
    }
  }
  return result;
}
