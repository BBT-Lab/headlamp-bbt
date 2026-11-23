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
 * 文件描述：按物理卡去重计算GPU容量、使用情况与历史。
 * 项目名称：Headlamp BBT
 * 文件名称：summary.ts
 * 作者：Codex
 * 日期：2026-11-23
 */

import { fields, type Gpu, identity, measurement, type MetricField, type Series } from './metrics';

export interface PhysicalGpu {
  id: string;
  node: string;
  acceleratorId: string;
  index: number;
  model: string;
  devices: Gpu[];
  occupied: boolean;
}

export interface GpuUsage {
  total: number;
  occupied?: number;
  utilization?: number;
  vramPercent?: number;
  memoryUsed?: number;
  memoryTotal?: number;
}

/** 返回有效的物理卡或MIG实例利用率。 */
export function gpuUtilization(device: Gpu): number | undefined {
  if (device.instance && device.metrics.engineActive !== undefined) {
    return device.metrics.engineActive * 100;
  }
  return device.metrics.utilization;
}

/** 只把真实Pod的归属标记计入占用。 */
export function gpuWorkloads(device: Gpu) {
  return device.workloads.filter(workload => workload.namespace !== 'gpu-operator');
}

/** 同一物理设备的多个MIG实例合并计入一张卡。 */
export function physicalGpus(devices: readonly Gpu[]): PhysicalGpu[] {
  const grouped = new Map<string, Gpu[]>();
  for (const device of devices) {
    const key = JSON.stringify([device.node, device.physicalId]);
    const group = grouped.get(key) ?? [];
    group.push(device);
    grouped.set(key, group);
  }
  const cards = [...grouped.entries()].sort(
    ([, [a]], [, [b]]) =>
      a.node.localeCompare(b.node, undefined, { numeric: true }) ||
      (a.index ?? Infinity) - (b.index ?? Infinity) ||
      a.physicalId.localeCompare(b.physicalId)
  );
  const assigned = new Map<string, Set<number>>();
  const reported = new Map<string, Set<number>>();
  for (const [, [device]] of cards) {
    const indices = reported.get(device.node) ?? new Set<number>();
    if (device.index !== undefined) indices.add(device.index);
    reported.set(device.node, indices);
  }
  return cards.map(([id, group]) => {
    const base = group.find(device => !device.instance) ?? group[0];
    const used = assigned.get(base.node) ?? new Set<number>();
    assigned.set(base.node, used);
    let index = base.index;
    if (index === undefined || used.has(index)) {
      index = 0;
      while (used.has(index) || reported.get(base.node)?.has(index)) index += 1;
    }
    used.add(index);
    const instances = group.filter(device => device.instance);
    return {
      id,
      index,
      node: base.node,
      acceleratorId: base.physicalId,
      model: base.model.replace(/\s+PCIe$/, ''),
      devices: instances.length
        ? instances.sort((a, b) =>
            a.instance.localeCompare(b.instance, undefined, { numeric: true })
          )
        : group,
      occupied: group.some(device => gpuWorkloads(device).length > 0),
    };
  });
}

/** 计算有效测量样本的平均值。 */
function mean(values: number[]): number | undefined {
  return values.length
    ? values.reduce((sum, number) => sum + number, 0) / values.length
    : undefined;
}

/** 返回所有有效显存样本的总量和已用量。 */
export function gpuMemory(devices: readonly Gpu[]): { used: number; total: number } | undefined {
  let used = 0;
  let total = 0;
  for (const { metrics } of devices) {
    if (metrics.memoryUsed === undefined || metrics.memoryFree === undefined) continue;
    used += metrics.memoryUsed;
    total += metrics.memoryUsed + metrics.memoryFree;
  }
  return total ? { used, total } : undefined;
}

/** 按物理卡平均利用率，按实际显存容量求比值。 */
export function gpuUsage(cards: readonly PhysicalGpu[], occupancyKnown = true): GpuUsage {
  const utilization = cards.flatMap(card => {
    const value = mean(card.devices.flatMap(device => gpuUtilization(device) ?? []));
    return value ?? [];
  });
  const memory = gpuMemory(cards.flatMap(card => card.devices));
  return {
    total: cards.length,
    occupied: occupancyKnown ? cards.filter(card => card.occupied).length : undefined,
    utilization: mean(utilization),
    vramPercent: memory ? (100 * memory.used) / memory.total : undefined,
    memoryUsed: memory?.used,
    memoryTotal: memory?.total,
  };
}

/** 按节点下的物理GPU型号合并计数。 */
export function gpuModels(cards: readonly PhysicalGpu[]): string {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const name = card.model.replace('GeForce ', '');
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => (count > 1 ? `${name} x${count}` : name)).join(' · ');
}

/** 以紧凑格式显示天、小时、分钟。 */
export function gpuDuration(milliseconds: number | undefined): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  const minutes = Math.floor(milliseconds / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes / 60) % 24;
  return (days ? `${days}d` : '') + (days || hours ? `${hours}h` : '') + `${minutes % 60}m`;
}

/** 生成带实际采样缺口的使用率历史，供原有趋势图消费。 */
export function gpuHistory(
  series: readonly Series[],
  start: number,
  end: number,
  step: number,
  deviceIds?: ReadonlySet<string>
) {
  const metricNames = new Map<string, MetricField>(
    Object.entries(fields).map(([field, name]) => [name, field as MetricField])
  );
  const devicesByTime = new Map<number, Map<string, Gpu>>();
  for (const item of series) {
    const gpu = identity(item.metric);
    const field = metricNames.get(item.metric.__name__);
    if (!gpu || !field || (deviceIds && !deviceIds.has(gpu.id))) continue;
    for (const [ts, raw] of item.values ?? []) {
      if (ts < start || ts > end) continue;
      const value = measurement(field, raw);
      if (value === undefined) continue;
      const devices = devicesByTime.get(ts) ?? new Map<string, Gpu>();
      devicesByTime.set(ts, devices);
      const device = devices.get(gpu.id) ?? { ...gpu, workloads: [], metrics: {} };
      device.metrics[field] = Math.max(device.metrics[field] ?? 0, value);
      devices.set(gpu.id, device);
    }
  }
  const result = [];
  for (let time = start; time <= end; time += step) {
    const usage = gpuUsage(physicalGpus([...(devicesByTime.get(time)?.values() ?? [])]));
    result.push({
      ts: time * 1000,
      utilization: usage.utilization ?? null,
      memory: usage.vramPercent ?? null,
    });
  }
  return result;
}
