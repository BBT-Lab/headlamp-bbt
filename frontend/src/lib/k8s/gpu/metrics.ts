/*
 * 文件描述：归一化NVIDIA DCGM物理GPU与MIG实例的采样。
 * 项目名称：Headlamp BBT
 * 文件名称：metrics.ts
 * 作者：gen3111620、Codex
 * 日期：2026-11-23
 */

import type { ConnectionConfig } from './config';

export const fields = {
  utilization: 'DCGM_FI_DEV_GPU_UTIL',
  engineActive: 'DCGM_FI_PROF_GR_ENGINE_ACTIVE',
  memoryUsed: 'DCGM_FI_DEV_FB_USED',
  memoryFree: 'DCGM_FI_DEV_FB_FREE',
  temperature: 'DCGM_FI_DEV_GPU_TEMP',
  power: 'DCGM_FI_DEV_POWER_USAGE',
} as const;
export type MetricField = keyof typeof fields;
export type Sample = [number, string];
export interface Series {
  metric: Record<string, string>;
  value?: Sample;
  values?: Sample[];
}
export interface Gpu {
  id: string;
  uuid: string;
  physicalId: string;
  index?: number;
  node: string;
  model: string;
  instance: string;
  workloads: { namespace: string; pod: string; container: string }[];
  metrics: Partial<Record<MetricField, number>>;
}
export interface Scope {
  node?: string;
  namespace?: string;
  pod?: string;
}
// DCGM uses large sentinel values for unsupported fields. Never chart those as measurements.
export function measurement(field: MetricField, raw: string): number | undefined {
  const value = Number(raw);
  const max = {
    utilization: 100,
    engineActive: 1,
    memoryUsed: 1e9,
    memoryFree: 1e9,
    temperature: 200,
    power: 1e6,
  };
  return raw.trim() && Number.isFinite(value) && value >= 0 && value <= max[field]
    ? value
    : undefined;
}

export function identity(
  labels: Record<string, string>
): Omit<Gpu, 'metrics' | 'workloads'> | null {
  const uuid = labels.UUID || labels.uuid;
  const node = labels.Hostname || labels.hostname || labels.node || labels.kubernetes_node || '';
  if (!uuid || !node) return null;
  const instance =
    labels.GPU_I_ID || labels.GPU_I_PROFILE || (uuid.startsWith('MIG-') ? 'MIG' : '');
  const physicalId = uuid.startsWith('MIG-') ? labels.GPU_UUID || labels.pci_bus_id || uuid : uuid;
  const gpuIndex = /^(0|[1-9]\d*)$/.test(labels.gpu ?? '') ? Number(labels.gpu) : undefined;
  return {
    id: JSON.stringify([node, uuid, instance]),
    uuid,
    physicalId,
    index: gpuIndex,
    node,
    instance,
    model: labels.modelName || labels.model_name || 'Unknown model',
  };
}

export function workload(labels: Record<string, string>) {
  // Prometheus may rename exporter labels when they collide with scrape target labels.
  // When an exported label exists, the plain label describes the exporter, not the workload.
  const namespace = labels.exported_namespace ?? labels.namespace ?? labels.pod_namespace ?? '';
  const pod = labels.exported_pod ?? labels.pod ?? labels.pod_name ?? '';
  const container = labels.exported_container ?? labels.container ?? labels.container_name ?? '';
  return { namespace, pod, container };
}

export function inScope(gpu: Gpu, scope: Scope): boolean {
  if (scope.node && gpu.node !== scope.node) return false;
  if (scope.pod && !gpu.workloads.some(w => w.pod === scope.pod && w.namespace === scope.namespace))
    return false;
  return true;
}

export function normalize(series: Series[]): { devices: Gpu[]; ignored: number } {
  const devices = new Map<string, Gpu>();
  const timestamps = new Map<string, number>();
  let ignored = 0;
  for (const item of series) {
    const base = identity(item.metric);
    const field = (Object.keys(fields) as MetricField[]).find(
      f => fields[f] === item.metric.__name__
    );
    if (!base || !field || !item.value) {
      ignored++;
      continue;
    }
    let gpu = devices.get(base.id);
    if (!gpu) {
      gpu = { ...base, metrics: {}, workloads: [] };
      devices.set(base.id, gpu);
    }
    const w = workload(item.metric);
    if (w.pod && w.namespace && !gpu.workloads.some(x => JSON.stringify(x) === JSON.stringify(w)))
      gpu.workloads.push(w);
    const value = measurement(field, item.value[1]);
    if (value === undefined) continue;
    const key = base.id + field;
    const previousTime = timestamps.get(key) ?? -Infinity;
    // Duplicate targets and pod labels must not multiply one device's measurements.
    if (item.value[0] > previousTime) {
      gpu.metrics[field] = value;
      timestamps.set(key, item.value[0]);
    } else if (item.value[0] === previousTime) {
      gpu.metrics[field] = Math.max(gpu.metrics[field] ?? 0, value);
    }
  }
  return { devices: [...devices.values()].sort((a, b) => a.id.localeCompare(b.id)), ignored };
}

export function selector(
  config: ConnectionConfig,
  metrics: string[] = Object.values(fields)
): string {
  const names = metrics.join('|');
  const cluster = config.clusterLabel
    ? `,${config.clusterLabel}=${JSON.stringify(config.clusterValue)}`
    : '';
  return `{__name__=~"${names}"${cluster}}`;
}

export function freshQuery(config: ConnectionConfig): string {
  // Check source timestamps before any function can replace them with the evaluation time.
  // Match the metric name explicitly when joining branches, retaining every metric for one GPU.
  return Object.values(fields)
    .map(name => {
      const metric = selector(config, [name]);
      return `(${metric} and (timestamp(${metric}) > time() - 120))`;
    })
    .join(' or on (__name__) ');
}
