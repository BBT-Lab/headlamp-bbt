/*
 * 文件描述：使用当前用户身份读取集群首页所需的Volcano作业与队列数量。
 * 项目名称：Headlamp BBT
 * 文件名称：volcanoCapacity.ts
 * 作者：Codex
 * 日期：2026-11-23
 */

import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { useEffect, useState } from 'react';

export interface VolcanoCapacity {
  running: number;
  pending: number;
  queues: number;
}

/** 分页读取当前账号有权访问的Volcano对象。 */
async function list<T>(cluster: string, path: string, signal: AbortSignal): Promise<T[]> {
  const entries: T[] = [];
  let next = '';
  do {
    const query = new URLSearchParams({ limit: '500' });
    if (next) query.set('continue', next);
    const response = (await request(`${path}?${query}`, {
      cluster,
      signal,
      autoLogoutOnAuthError: false,
    })) as { items: T[]; metadata?: { continue?: string } };
    entries.push(...response.items);
    next = response.metadata?.continue ?? '';
  } while (next);
  return entries;
}

/** 只在Volcano API存在且当前账户有权限时返回容量统计。 */
export function useVolcanoCapacity(cluster: string | null): VolcanoCapacity | undefined {
  const [state, setState] = useState<{ cluster: string; data: VolcanoCapacity }>();
  useEffect(() => {
    if (!cluster) return;
    const owner = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    /** 更新作业和队列数量。 */
    async function update() {
      try {
        const signal = AbortSignal.any([owner.signal, AbortSignal.timeout(15000)]);
        const [jobs, queues] = await Promise.all([
          list<{ status?: { state?: { phase?: string } } }>(
            cluster!,
            '/apis/batch.volcano.sh/v1alpha1/jobs',
            signal
          ),
          list(cluster!, '/apis/scheduling.volcano.sh/v1beta1/queues', signal),
        ]);
        if (!owner.signal.aborted) {
          setState({
            cluster: cluster!,
            data: {
              running: jobs.filter(job => job.status?.state?.phase === 'Running').length,
              pending: jobs.filter(job => job.status?.state?.phase === 'Pending').length,
              queues: queues.length,
            },
          });
        }
      } catch (error) {
        if (!owner.signal.aborted) setState(undefined);
      }
      if (!owner.signal.aborted) timer = setTimeout(update, 30000);
    }

    void update();
    return () => {
      owner.abort();
      clearTimeout(timer);
    };
  }, [cluster]);
  return state?.cluster === cluster ? state.data : undefined;
}
