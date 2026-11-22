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
 * 文件描述：提供集群的显示名称与默认列表筛选规则。
 * 项目名称：Headlamp BBT
 * 文件名称：clusterPresentation.ts
 * 作者：Codex
 * 日期：2026-11-22
 */

import type { Cluster } from './cluster';

/**
 * 读取Rancher显示名。链接和请求继续使用集群键。
 *
 * :param cluster: 服务端提供的集群配置。
 * :param fallback: 配置还未加载时使用的名称。
 * :returns: 界面显示名。
 */
export function clusterDisplayName(cluster?: Cluster, fallback = ''): string {
  return cluster?.meta_data?.rancherDisplayName || cluster?.name || fallback;
}

/**
 * 从账号已经获准访问的集群中选出当前显示的集群。
 *
 * :param clusters: 账号可访问的集群，null表示正在加载。
 * :param showAll: 是否显示所有已获授权的集群。
 * :returns: 按集群键保存的可显示集群。
 */
export function visibleClusters(
  clusters: Record<string, Cluster> | null,
  showAll: boolean
): Record<string, Cluster> | null {
  if (!clusters || showAll) return clusters;
  const entries = Object.entries(clusters);
  const visible = entries.filter(([, cluster]) => cluster.meta_data?.hideByDefault !== true);
  return visible.length === entries.length ? clusters : Object.fromEntries(visible);
}
