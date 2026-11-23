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
 * 文件描述：订阅当前集群的GPU实时样本与趋势。
 * 项目名称：Headlamp BBT
 * 文件名称：hooks.ts
 * 作者：Codex
 * 日期：2026-11-23
 */

import { useEffect, useState } from 'react';
import type { Transport } from './client';
import type { ConnectionConfig } from './config';
import { type GpuRange, type GpuTelemetry, loadGpuRange, loadGpuTelemetry } from './telemetry';

/** 为指定集群加载GPU数据，集群改变时取消原请求。 */
export function useGpuTelemetry(
  request: Transport,
  clusters: readonly string[],
  refresh = 0
): { loading: boolean; clusters: Record<string, GpuTelemetry> } {
  const key = JSON.stringify([...new Set(clusters.filter(Boolean))].sort());
  const [result, setResult] = useState<{
    key: string;
    loading: boolean;
    clusters: Record<string, GpuTelemetry>;
  }>();

  useEffect(() => {
    const names: string[] = JSON.parse(key);
    const owner = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    if (!names.length) return;

    /** 更新有指标的集群，不带入其他集群的旧数据。 */
    async function update() {
      const snapshots = await Promise.allSettled(
        names.map(cluster => loadGpuTelemetry(request, cluster, owner.signal))
      );
      if (owner.signal.aborted) return;
      const available = Object.fromEntries(
        snapshots.flatMap((snapshot, index) =>
          snapshot.status === 'fulfilled' && snapshot.value
            ? [[names[index], snapshot.value] as const]
            : []
        )
      );
      setResult({ key, loading: false, clusters: available });
      timer = setTimeout(update, Object.keys(available).length ? 30000 : 60000);
    }

    void update();
    return () => {
      owner.abort();
      clearTimeout(timer);
    };
  }, [key, refresh, request]);

  return result?.key === key ? result : { loading: key !== '[]', clusters: {} };
}

/** 读取当前集群和选定时间范围的历史数据。 */
export function useGpuRange(
  request: Transport,
  cluster: string,
  config: ConnectionConfig | undefined,
  hours: number,
  revision = 0
) {
  const key = JSON.stringify([cluster, config, hours, revision]);
  const [result, setResult] = useState<{ key: string; data?: GpuRange }>();
  useEffect(() => {
    const [name, connection, rangeHours]: [string, ConnectionConfig | undefined, number] =
      JSON.parse(key);
    if (!name || !connection) return;
    const owner = new AbortController();
    loadGpuRange(request, name, connection, rangeHours, owner.signal)
      .then(data => {
        if (!owner.signal.aborted) setResult({ key, data });
      })
      .catch(() => {
        if (!owner.signal.aborted) setResult({ key });
      });
    return () => owner.abort();
  }, [key, request]);
  return result?.key === key ? result.data : undefined;
}
