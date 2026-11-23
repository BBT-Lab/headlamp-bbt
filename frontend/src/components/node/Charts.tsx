/*
 * Copyright 2025 The Kubernetes Authors
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

// 文件描述：渲染节点CPU和内存使用量。
// 项目名称：Headlamp BBT
// 文件名称：Charts.tsx
// 作者：Codex
// 日期：2026-11-23

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { KubeMetrics } from '../../lib/k8s/cluster';
import Node from '../../lib/k8s/node';
import { getPercentStr, getResourceMetrics, getResourceStr } from '../../lib/util';
import { PercentageBar } from '../common/Chart';
import { TooltipIcon } from '../common/Tooltip';

interface UsageBarChartProps {
  node: Node;
  nodeMetrics: KubeMetrics[] | null;
  resourceType: keyof KubeMetrics['usage'];
  noMetrics?: boolean;
  showPercentage?: boolean;
}

/**
 * 渲染节点资源进度条及可选的占用百分比。
 *
 * :param props: 节点、实时指标和资源类型。
 * :returns: 对应资源的用量图。
 */
export function UsageBarChart(props: UsageBarChartProps) {
  const { node, nodeMetrics, resourceType, noMetrics = false, showPercentage = false } = props;
  const { t } = useTranslation(['translation']);
  let [used, capacity] = [0, 0];

  if (node) {
    [used, capacity] = getResourceMetrics(node, nodeMetrics || [], resourceType);
  }

  const data = [
    {
      name: t('used'),
      value: used,
    },
  ];

  function tooltipFunc() {
    return (
      <Typography>
        {getResourceStr(used, resourceType)} of {getResourceStr(capacity, resourceType)} (
        {getPercentStr(used, capacity)})
      </Typography>
    );
  }

  const chart = <PercentageBar data={data} total={capacity} tooltipFunc={tooltipFunc} />;
  const measured = nodeMetrics?.some(item => item.metadata.name === node.getName());
  return noMetrics ? (
    <>
      <Typography display="inline">{getResourceStr(capacity, resourceType)}</Typography>
      <TooltipIcon>{t('translation|Install the metrics-server to get usage data.')}</TooltipIcon>
    </>
  ) : showPercentage ? (
    <Box sx={{ display: 'grid', gap: 0.25, minWidth: 66 }}>
      <Typography variant="caption">
        {measured ? getPercentStr(used, capacity) ?? '—' : '—'}
      </Typography>
      {chart}
    </Box>
  ) : (
    chart
  );
}
