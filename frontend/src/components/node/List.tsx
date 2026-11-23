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

// 文件描述：展示节点CPU、内存和GPU的资源用量。
// 项目名称：Headlamp BBT
// 文件名称：List.tsx
// 作者：Codex
// 日期：2026-11-23

import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { createContext, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelectedClusters } from '../../lib/k8s';
import { request } from '../../lib/k8s/api/v1/clusterRequests';
import type { KubeMetrics } from '../../lib/k8s/cluster';
import { useGpuTelemetry } from '../../lib/k8s/gpu/hooks';
import { gpuModels, gpuUsage } from '../../lib/k8s/gpu/summary';
import { gpuOccupationKnown, type GpuTelemetry } from '../../lib/k8s/gpu/telemetry';
import Node from '../../lib/k8s/node';
import { getPercentStr, getResourceMetrics } from '../../lib/util';
import { DateLabel, HoverInfoLabel, StatusLabel } from '../common/Label';
import Link from '../common/Link';
import ResourceListView from '../common/Resource/ResourceListView';
import { UsageBarChart } from './Charts';
import { NodeReadyLabel } from './Details';
import UpgradeVisualizationPanel from './UpgradeVisualizationPanel';
import { formatTaint, isNodeCordoned, NodeTaintsLabel } from './utils';

const NodeMetricsContext = createContext<{
  gpu: Record<string, GpuTelemetry>;
  metrics: KubeMetrics[] | null;
  noMetrics: boolean;
}>({ gpu: {}, metrics: null, noMetrics: false });

/** 节点名、用量条和型号随实时数据更新，即使表格复用了同一行。 */
function NodeGpuCell({ node, field }: { node: Node; field: 'name' | 'usage' | 'memory' }) {
  const { t } = useTranslation('translation');
  const { gpu } = useContext(NodeMetricsContext);
  const snapshot = gpu[node.cluster];
  const cards = snapshot?.cards.filter(card => card.node === node.getName()) ?? [];
  if (field === 'name') {
    const model = gpuModels(cards);
    return (
      <Box sx={{ display: 'grid', minWidth: 0 }}>
        <Link kubeObject={node} />
        {model && (
          <Typography variant="caption" color="text.secondary" noWrap title={model}>
            {model}
          </Typography>
        )}
      </Box>
    );
  }
  if (!cards.length) return '—';
  const usage = gpuUsage(cards, gpuOccupationKnown(snapshot, node.getName()));
  const memory = field === 'memory';
  const percent = memory ? usage.vramPercent : usage.utilization;
  const label = memory ? t('GPU memory utilization') : t('GPU utilization');
  const formatted = percent === undefined ? '—' : getPercentStr(percent, 100);
  return (
    <Box
      sx={{ display: 'grid', gap: 0.5, minWidth: 64 }}
      title={!memory ? formatted ?? undefined : undefined}
    >
      <Typography variant="caption">
        {memory ? formatted : `${usage.occupied ?? '—'}/${usage.total}`}
      </Typography>
      {percent !== undefined && (
        <LinearProgress
          aria-label={label}
          variant="determinate"
          value={percent}
          color={memory ? 'success' : 'primary'}
          sx={{ height: 4, borderRadius: 2 }}
        />
      )}
    </Box>
  );
}

/** 使用和节点表相同的实时资源数据绘制CPU或内存。 */
function NodeResourceCell({ node, resource }: { node: Node; resource: 'cpu' | 'memory' }) {
  const { metrics, noMetrics } = useContext(NodeMetricsContext);
  return (
    <UsageBarChart
      node={node}
      nodeMetrics={metrics}
      resourceType={resource}
      noMetrics={noMetrics}
      showPercentage
    />
  );
}

export function filterNode(node: Node, search: string) {
  const lowerSearch = search.trim().toLowerCase();
  const isReady = !!node.status?.conditions?.find(
    condition => condition.type === 'Ready' && condition.status === 'True'
  );
  const isCordoned = isNodeCordoned(node);

  if (lowerSearch === 'ready' || lowerSearch === 'schedulable') {
    return isReady && !isCordoned;
  }
  // Ready cordoned nodes, matching the cluster chart's Cordoned slice (not-ready ones count as NotReady).
  // Drained nodes are also cordoned, so they are listed too.
  if (lowerSearch === 'cordoned') {
    return isReady && isCordoned;
  }
  if (lowerSearch === 'notready' || lowerSearch === 'not ready' || lowerSearch === 'not-ready') {
    return !isReady;
  }
  return undefined;
}

export default function NodeList() {
  const [nodeMetrics, metricsError] = Node.useMetrics();
  const { items } = Node.useList();
  const { t } = useTranslation(['glossary', 'translation']);
  const selectedClusters = useSelectedClusters();
  const { clusters: gpuClusters } = useGpuTelemetry(request, selectedClusters);
  const hasGpu = Object.keys(gpuClusters).length > 0;
  const resourceFraction = (node: Node, resource: 'cpu' | 'memory') => {
    if (!nodeMetrics?.some(item => item.metadata.name === node.getName())) return undefined;
    const [used, capacity] = getResourceMetrics(node, nodeMetrics, resource);
    return capacity ? used / capacity : undefined;
  };

  const noMetrics = metricsError?.status === 404;
  const context = useMemo(
    () => ({ gpu: gpuClusters, metrics: nodeMetrics, noMetrics }),
    [gpuClusters, nodeMetrics, noMetrics]
  );

  const hasNodePools = useMemo(() => {
    if (!items || items.length === 0) return false;
    return items.some(node => node.getNodePool() !== '');
  }, [items]);

  return (
    <NodeMetricsContext.Provider value={context}>
      <ResourceListView
        title={t('Nodes')}
        resourceClass={Node}
        searchFilter={filterNode}
        reflectInURL="nodes"
        headerProps={{
          noNamespaceFilter: true,
        }}
        columns={[
          {
            id: 'name',
            label: t('translation|Name'),
            gridTemplate: 'minmax(156px, 1fr)',
            getValue: node => node.getName(),
            render: node => <NodeGpuCell node={node} field="name" />,
          },
          'cluster',
          {
            id: 'cpu',
            label: t('CPU'),
            gridTemplate: 'min-content',
            disableFiltering: true,
            getValue: node => resourceFraction(node, 'cpu'),
            render: node => <NodeResourceCell node={node} resource="cpu" />,
          },
          {
            id: 'memory',
            label: t('Memory'),
            disableFiltering: true,
            getValue: node => resourceFraction(node, 'memory'),
            render: node => <NodeResourceCell node={node} resource="memory" />,
          },
          ...(hasGpu
            ? [
                {
                  id: 'gpu',
                  label: 'GPU',
                  gridTemplate: '96px',
                  disableFiltering: true,
                  sort: false,
                  getValue: (node: Node) => node.getName(),
                  render: (node: Node) => <NodeGpuCell node={node} field="usage" />,
                },
                {
                  id: 'gpu-memory',
                  label: t('translation|GPU memory utilization'),
                  gridTemplate: '106px',
                  disableFiltering: true,
                  sort: false,
                  getValue: (node: Node) => node.getName(),
                  render: (node: Node) => <NodeGpuCell node={node} field="memory" />,
                },
              ]
            : []),
          {
            id: 'ready',
            label: t('translation|Ready'),
            filterVariant: 'multi-select',
            getValue: node => {
              const isReady = !!node.status.conditions?.find(
                condition => condition.type === 'Ready' && condition.status === 'True'
              );
              return isReady ? t('translation|Yes') : t('translation|No');
            },
            render: node => (
              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                <NodeReadyLabel node={node} />
                {isNodeCordoned(node) && (
                  <StatusLabel status="warning">{t('translation|Cordoned')}</StatusLabel>
                )}
              </Box>
            ),
          },
          {
            id: 'taints',
            label: t('translation|Taints'),
            getValue: node => node.spec?.taints?.map(taint => formatTaint(taint))?.join(', '),
            render: (item: Node) => <NodeTaintsLabel node={item} />,
          },
          {
            id: 'roles',
            label: t('Roles'),
            gridTemplate: 'minmax(150px, .5fr)',
            getValue: node => {
              return Object.keys(node.metadata.labels ?? {})
                .filter((t: String) => t.startsWith('node-role.kubernetes.io/'))
                .map(t => t.replace('node-role.kubernetes.io/', ''))
                .join(', ');
            },
          },
          ...(hasNodePools
            ? [
                {
                  id: 'nodePool',
                  label: t('Node Pool'),
                  gridTemplate: 'minmax(150px, .5fr)',
                  getValue: (node: Node) => node.getNodePool(),
                  filterVariant: 'multi-select' as const,
                },
              ]
            : []),
          {
            id: 'internalIP',
            label: t('translation|Internal IP'),
            getValue: node => node.getInternalIP(),
            copyable: true,
          },
          {
            id: 'externalIP',
            label: t('External IP'),
            getValue: node => node.getExternalIP() || '',
            render: node => node.getExternalIP() || t('translation|None'),
            copyable: true,
          },
          {
            id: 'version',
            label: t('translation|Version'),
            gridTemplate: 'minmax(150px, .5fr)',
            getValue: node => node.status.nodeInfo?.kubeletVersion,
            filterVariant: 'multi-select',
          },
          {
            id: 'software',
            label: t('translation|Software'),
            gridTemplate: 'minmax(200px, 1.5fr)',
            getValue: node => node.status.nodeInfo?.operatingSystem,
            render: node => {
              if (node.status.nodeInfo === undefined) {
                return <></>;
              }
              let osIcon = 'mdi:desktop-classic';
              if (node.status.nodeInfo.operatingSystem === 'linux') {
                osIcon = 'mdi:linux';
              } else if (node.status.nodeInfo.operatingSystem === 'windows') {
                osIcon = 'mdi:microsoft-windows';
              }

              return (
                <>
                  <HoverInfoLabel
                    label={node.status.nodeInfo.osImage}
                    hoverInfo={t('OS image')}
                    labelProps={{ variant: 'body2' }}
                    iconPosition="start"
                    icon={osIcon}
                  />
                  {node.status.nodeInfo.kernelVersion && (
                    <HoverInfoLabel
                      label={node.status.nodeInfo.kernelVersion}
                      hoverInfo={t('Kernel version')}
                      labelProps={{ variant: 'body2' }}
                      iconPosition="start"
                      icon="mdi:nut"
                    />
                  )}
                  <HoverInfoLabel
                    label={node.status.nodeInfo.containerRuntimeVersion}
                    hoverInfo={t('Container Runtime')}
                    labelProps={{ variant: 'body2' }}
                    iconPosition="start"
                    icon="mdi:train-car-container"
                  />
                </>
              );
            },
            show: false,
          },
          'labels',
          {
            id: 'age',
            label: t('translation|Age'),
            show: false,
            gridTemplate: 'min-content',
            getValue: node => -Date.parse(node.metadata.creationTimestamp),
            disableFiltering: true,
            render: node => <DateLabel date={node.metadata.creationTimestamp} format="mini" />,
          },
        ]}
      />
      <UpgradeVisualizationPanel />
    </NodeMetricsContext.Provider>
  );
}
