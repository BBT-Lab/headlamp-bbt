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
 * 文件描述：按已授权集群和当前展示设置提供界面名称及选择列表。
 * 项目名称：Headlamp BBT
 * 文件名称：useClusterPresentation.ts
 * 作者：Codex
 * 日期：2026-11-23
 */

import { useMemo } from 'react';
import { useTypedSelector } from '../../redux/hooks';
import { clusterDisplayName, visibleClusters } from './clusterPresentation';
import { useClustersConf } from './index';

/**
 * 获取当前可用于列表及选择器的集群。
 *
 * :returns: 当前显示的授权集群。
 */
export function useVisibleClustersConf(): ReturnType<typeof useClustersConf> {
  const clusters = useClustersConf();
  const showAll = useTypedSelector(state => state.config.showAllClusters ?? false);
  return useMemo(() => visibleClusters(clusters, showAll), [clusters, showAll]);
}

/**
 * 将路由使用的集群键转换为界面显示名。
 *
 * :param name: 集群键。
 * :returns: 界面显示名。
 */
export function useClusterDisplayName(name?: string | null): string {
  const clusters = useClustersConf();
  return name ? clusterDisplayName(clusters?.[name], name) : '';
}
