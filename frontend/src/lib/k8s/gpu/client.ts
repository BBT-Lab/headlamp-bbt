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
 * 文件描述：读取并校验DCGM指标和历史查询结果。
 * 项目名称：Headlamp BBT
 * 文件名称：client.ts
 * 作者：gen3111620、Codex
 * 日期：2026-11-23
 */

import type { Series } from './metrics';

export type Transport = (
  url: string,
  options: { cluster: string; signal: AbortSignal; timeout: number; autoLogoutOnAuthError: boolean }
) => Promise<unknown>;
export function response(
  value: unknown,
  kind: 'vector' | 'matrix'
): { series: Series[]; warnings: string[] } {
  const body = value as {
    status?: string;
    error?: string;
    warnings?: unknown;
    data?: { resultType?: string; result?: unknown };
  };
  if (!body || body.status !== 'success')
    throw new Error(body?.error || 'Prometheus did not return a successful response.');
  if (body.data?.resultType !== kind || !Array.isArray(body.data.result))
    throw new Error('The Service did not return the expected Prometheus response.');
  const series = body.data.result as Series[];
  if (
    series.some(
      s =>
        !s ||
        typeof s.metric !== 'object' ||
        s.metric === null ||
        (kind === 'vector'
          ? !validSample(s.value)
          : !Array.isArray(s.values) || !s.values.every(validSample))
    )
  )
    throw new Error('Prometheus returned malformed samples.');
  const warnings = Array.isArray(body.warnings) ? body.warnings.map(String) : [];
  if (series.length >= 1000)
    warnings.push(
      'The 1,000-series limit was reached. Results may be incomplete; narrow the cluster scope.'
    );
  return { series, warnings };
}

function validSample(sample: unknown): boolean {
  return (
    Array.isArray(sample) &&
    sample.length === 2 &&
    Number.isFinite(sample[0]) &&
    typeof sample[1] === 'string'
  );
}

export function errorMessage(error: unknown): string {
  const detail = error as { status?: number; message?: string };
  if (detail?.status === 401 || detail?.status === 403)
    return 'Access denied. Check your Headlamp login and permission to read the Prometheus Service proxy.';
  if (detail?.status === 404)
    return 'Prometheus Service or API path not found. Check the connection settings.';
  return (
    detail?.message || 'Could not query Prometheus. Check the Service, network and permissions.'
  );
}
