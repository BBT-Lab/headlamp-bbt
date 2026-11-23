// 文件描述：展示 Headlamp Plus 概览及其资源状态。
// 项目名：Headlamp Plus
// 文件名：ClusterOverview.tsx
// 作者：Qintsg
// 日期：2026-11-21

/**
 * Cluster overview dashboard: how healthy the cluster is, what needs attention and how much of
 * its capacity is used, followed by Headlamp's events table. Built from cards on a grid, the
 * same way the other plugins of this repository present their overview.
 */
import { Icon } from '@iconify/react';
import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import {
  DateLabel,
  Link,
  ResourceListView,
  ShowHideLabel,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Alert, Box, Chip, FormControlLabel, Switch, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { eventReasonLabel } from '../../../../../frontend/src/lib/k8s/eventReason';
import { useGpuTelemetry } from '../../../../../frontend/src/lib/k8s/gpu/hooks';
import { gpuUsage } from '../../../../../frontend/src/lib/k8s/gpu/summary';
import {
  gpuOccupationKnown,
  type GpuTelemetry,
} from '../../../../../frontend/src/lib/k8s/gpu/telemetry';
import { podDisplayPhase } from '../../../../../frontend/src/lib/k8s/podDisplayPhase';
import {
  Bar,
  cardGrid,
  DashboardHeader,
  HealthRow,
  isForbidden,
  IssueList,
  LegendDot,
  pageSx,
  Panel,
  percent,
  plural,
  rowSx,
  ScrollArea,
  Stat,
  StatCard,
  Tone,
  twoColumns,
} from './blocks';
import {
  clusterCapacity,
  formatCores,
  formatGiB,
  isNodeReady,
  Issue,
  isWorkloadHealthy,
  MetricsJson,
  nodeIssues,
  NodeJson,
  nodeRoles,
  nodeUsage,
  podIssues,
  PodJson,
  podPhases,
  sortIssues,
  usageTone,
  workloadIssues,
  WorkloadJson,
} from './clusterHealth';
import { UsageTrends } from './UsageTrends';
import { useVolcanoCapacity, type VolcanoCapacity } from './volcanoCapacity';
import { usePlusText } from '../i18n';

const { Node, Pod, Namespace, Deployment, StatefulSet, DaemonSet } = K8s.ResourceClasses;
// Event is not part of ResourceClasses; the module is exported as a namespace.
const Event = K8s.event.default;
// ---------------------------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------------------------

function useKubernetesVersion(cluster: string | null): string | undefined {
  const [version, setVersion] = React.useState<string>();
  React.useEffect(() => {
    let cancelled = false;
    setVersion(undefined);
    K8s.getVersion()
      .then(info => !cancelled && setVersion(info?.gitVersion))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [cluster]);
  return version;
}

// ---------------------------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------------------------

function UsageRow({
  label,
  used,
  total,
  unit,
  format,
  tone,
  amount,
}: {
  label: string;
  used?: number;
  total: number;
  unit: string;
  format: (value: number) => string;
  tone?: Tone | 'neutral';
  amount?: string;
}) {
  const hasUsage = used !== undefined;
  return (
    <Box sx={{ py: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          {label}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {amount ?? `${hasUsage ? format(used) + ' / ' : ''}${format(total)} ${unit}`}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 40, textAlign: 'right' }}>
          {hasUsage ? percent(used, total) : '—'}
        </Typography>
      </Box>
      <Bar
        value={used ?? 0}
        total={total}
        tone={tone ?? (hasUsage ? usageTone(used, total) : 'neutral')}
      />
    </Box>
  );
}

/** 将首页的Pod超时结束计入正常完成。 */
function overviewPodPhase(pod: PodJson): string | undefined {
  if (pod.status?.phase === 'Failed' && pod.status.reason === 'DeadlineExceeded')
    return 'Succeeded';
  return podDisplayPhase(pod);
}

function CapacityPanel({
  nodes,
  pods,
  metrics,
  metricsUnavailable,
  gpu,
  volcano,
}: {
  nodes: NodeJson[];
  pods: PodJson[] | null;
  metrics: MetricsJson[] | null;
  metricsUnavailable: boolean;
  gpu?: GpuTelemetry;
  volcano?: VolcanoCapacity;
}) {
  const { t } = usePlusText();
  const capacity = clusterCapacity(nodes, metrics);
  const phases = podPhases(pods ?? [], overviewPodPhase);
  const scheduled = phases.running + phases.pending + phases.unknown;
  const gpuMetrics = gpuUsage(gpu?.cards ?? [], gpuOccupationKnown(gpu));
  return (
    <>
      <UsageRow
        label="CPU"
        used={capacity.cpu.used}
        total={capacity.cpu.total}
        unit={t('cores')}
        format={formatCores}
      />
      <UsageRow
        label={t('Memory')}
        used={capacity.memory.used}
        total={capacity.memory.total}
        unit="GiB"
        format={formatGiB}
      />
      <UsageRow
        label={t('Pods')}
        used={pods ? scheduled : undefined}
        total={capacity.podSlots}
        unit={t('slots')}
        format={value => String(Math.round(value))}
      />
      {metricsUnavailable && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
          {t('CPU and memory usage need the metrics API (metrics-server), which is not available.')}
        </Typography>
      )}
      {pods && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1.5 }}>
          <LegendDot color="success.main" label={t('Running')} value={phases.running} />
          <LegendDot color="warning.main" label={t('Pending')} value={phases.pending} />
          <LegendDot color="error.main" label={t('Failed')} value={phases.failed} />
          <LegendDot color="text.disabled" label={t('Completed')} value={phases.succeeded} />
        </Box>
      )}
      {gpuMetrics.total > 0 && (
        <Box sx={{ pt: 0.5, mt: 1.25, borderTop: 1, borderColor: 'divider' }}>
          <UsageRow
            label={t('Average GPU utilization')}
            used={gpuMetrics.utilization}
            total={100}
            unit="%"
            format={formatCores}
            amount=""
          />
          <UsageRow
            label={t('Occupied GPUs')}
            used={gpuMetrics.occupied}
            total={gpuMetrics.total}
            unit=""
            format={formatCores}
            amount={`${gpuMetrics.occupied ?? '—'}/${gpuMetrics.total}`}
          />
          {gpuMetrics.memoryTotal !== undefined && (
            <UsageRow
              label={t('GPU memory utilization')}
              used={gpuMetrics.memoryUsed}
              total={gpuMetrics.memoryTotal}
              unit="GiB"
              format={value => formatGiB(value * 2 ** 20)}
            />
          )}
        </Box>
      )}
      {volcano && (
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mt: 1 }}>
          <Typography variant="body2" fontWeight={700}>
            Volcano
          </Typography>
          <LegendDot color="success.main" label={t('Running')} value={volcano.running} />
          <LegendDot color="warning.main" label={t('Queued')} value={volcano.pending} />
          <LegendDot color="info.main" label={t('Queues')} value={volcano.queues} />
        </Box>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------------------------

function MiniUsage({
  label,
  used,
  total,
  showPercent = true,
}: {
  label: string;
  used?: number;
  total: number;
  showPercent?: boolean;
}) {
  return (
    <Box sx={{ width: 110, minWidth: 48 }}>
      <Typography variant="caption" color="text.secondary" component="div" noWrap>
        {label}
        {showPercent && ` ${used === undefined ? '—' : percent(used, total)}`}
      </Typography>
      <Bar
        value={used ?? 0}
        total={total}
        tone={used === undefined ? 'neutral' : usageTone(used, total)}
      />
    </Box>
  );
}

function NodeList({
  nodes,
  metrics,
  gpu,
}: {
  nodes: KubeObject[];
  metrics: MetricsJson[] | null;
  gpu?: GpuTelemetry;
}) {
  const { t } = usePlusText();
  return (
    <ScrollArea maxHeight={360}>
      {nodes.map(node => {
        const json = node.jsonData as NodeJson;
        const ready = isNodeReady(json);
        const usage = nodeUsage(json, metrics);
        const gpuMetrics = gpuUsage(
          gpu?.cards.filter(card => card.node === node.metadata.name) ?? [],
          gpuOccupationKnown(gpu, node.metadata.name)
        );
        return (
          <Box
            key={node.metadata.uid}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              flexWrap: gpuMetrics.total ? 'nowrap' : 'wrap',
              ...rowSx,
            }}
          >
            <Tooltip title={ready ? t('Ready') : t('Not ready')}>
              <Box sx={{ color: ready ? 'success.main' : 'error.main', display: 'flex' }}>
                <Icon icon={ready ? 'mdi:check-circle' : 'mdi:alert-circle'} width={20} />
              </Box>
            </Tooltip>
            <Box sx={{ flexGrow: 1, minWidth: gpuMetrics.total ? 75 : 140 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Link kubeObject={node} />
                {nodeRoles(json).map(role => (
                  <Chip key={role} label={role} size="small" variant="outlined" />
                ))}
                {json.spec?.unschedulable && (
                  <Chip label={t('cordoned')} size="small" color="warning" variant="outlined" />
                )}
              </Box>
              <Typography variant="caption" color="text.secondary">
                {json.status?.nodeInfo?.kubeletVersion}
              </Typography>
            </Box>
            {usage && (
              <>
                <MiniUsage label="CPU" used={usage.cpu.used} total={usage.cpu.total} />
                <MiniUsage label={t('RAM')} used={usage.memory.used} total={usage.memory.total} />
              </>
            )}
            {gpuMetrics.total > 0 && (
              <MiniUsage
                label={`GPU ${gpuMetrics.occupied ?? '—'}/${gpuMetrics.total}`}
                used={gpuMetrics.utilization}
                total={100}
                showPercent={false}
              />
            )}
          </Box>
        );
      })}
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------------------------
// Workloads
// ---------------------------------------------------------------------------------------------

interface WorkloadGroup {
  kind: string;
  label: string;
  icon: string;
  route: string;
  items: KubeObject[] | null;
}

function WorkloadRow({ group }: { group: WorkloadGroup }) {
  const items = group.items;
  return (
    <HealthRow
      label={group.label}
      icon={group.icon}
      to={Router.createRouteURL(group.route)}
      loaded={!!items}
      total={items?.length ?? 0}
      healthy={items?.filter(item => isWorkloadHealthy(item.jsonData as WorkloadJson)).length ?? 0}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Events (same table as Headlamp's own overview)
// ---------------------------------------------------------------------------------------------

const EVENT_WARNING_SWITCH_KEY = 'EVENT_WARNING_SWITCH_FILTER_STORAGE_KEY';

type KubeEventObject = InstanceType<typeof Event>;

function EventsSection() {
  const { t, language } = usePlusText();
  const location = useLocation();
  const eventsFilter = new URLSearchParams(location.search).get('eventsFilter');
  const filterFunc = useFilterFunc<KubeEventObject>(['.jsonData.involvedObject.kind']);
  const [onlyWarnings, setOnlyWarnings] = React.useState(
    () => (localStorage.getItem(EVENT_WARNING_SWITCH_KEY) ?? 'true') === 'true'
  );
  const selected = useSelector(
    (state: { filter?: { namespaces?: Set<string> } }) => state.filter?.namespaces
  );
  const namespace = React.useMemo(() => [...(selected ?? [])], [selected]);
  const { items: events, errors } = Event.useList({ limit: Event.maxLimit, namespace });
  const warnings = React.useMemo(
    () => events?.filter(event => event.type === 'Warning').length ?? '?',
    [events]
  );

  return (
    <ResourceListView
      title={t('Events')}
      headerProps={{
        noNamespaceFilter: false,
        titleSideActions: [
          <FormControlLabel
            key="warning-toggle"
            checked={onlyWarnings}
            label={t('Only warnings ({{count}})', { count: warnings })}
            control={<Switch color="primary" />}
            onChange={(_, checked) => {
              localStorage.setItem(EVENT_WARNING_SWITCH_KEY, String(checked));
              setOnlyWarnings(checked);
            }}
          />,
        ],
      }}
      defaultGlobalFilter={eventsFilter ?? undefined}
      data={events}
      errors={errors}
      columns={[
        {
          label: t('Type'),
          gridTemplate: 'min-content',
          filterVariant: 'multi-select',
          getValue: event => t(event.involvedObject.kind),
        },
        {
          label: t('Name'),
          gridTemplate: 'auto',
          getValue: event => event.involvedObjectInstance?.getName() ?? event.involvedObject.name,
          render: event =>
            event.involvedObjectInstance ? (
              <Link kubeObject={event.involvedObjectInstance} />
            ) : (
              event.involvedObject.name
            ),
        },
        'namespace',
        'cluster',
        {
          label: t('Reason'),
          gridTemplate: 'min-content',
          filterVariant: 'multi-select',
          getValue: event => eventReasonLabel(event.reason, language),
          render: event => (
            <Tooltip title={eventReasonLabel(event.reason, language)}>
              <span>
                <StatusLabel status={event.type === 'Normal' ? '' : 'warning'}>
                  {eventReasonLabel(event.reason, language)}
                </StatusLabel>
              </span>
            </Tooltip>
          ),
        },
        {
          label: t('Message'),
          gridTemplate: 'auto',
          getValue: event => event.message ?? '',
          render: event => (
            <ShowHideLabel labelId={event.metadata?.uid || ''}>{event.message || ''}</ShowHideLabel>
          ),
        },
        {
          id: 'count',
          label: t('Count'),
          gridTemplate: 'min-content',
          cellProps: { align: 'right' },
          getValue: event => event.count ?? null,
          render: event => event.count ?? '-',
        },
        {
          id: 'last-seen',
          label: t('Last Seen'),
          gridTemplate: 'min-content',
          cellProps: { align: 'right' },
          getValue: event => -new Date(event.lastOccurrence).getTime(),
          render: event => <DateLabel date={event.lastOccurrence} format="mini" />,
        },
      ]}
      filterFunction={(event: KubeEventObject, search?: string) =>
        filterFunc(event, search) && (!onlyWarnings || event.jsonData.type === 'Warning')
      }
      defaultSortingColumn={{ id: 'last-seen', desc: false }}
      id="headlamp-cluster.overview.events"
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

/** Landing page of a cluster; replaces Headlamp's stock overview. */
export function ClusterOverview() {
  const { t } = usePlusText();
  const cluster = K8s.useCluster();
  const { clusters: gpuClusters } = useGpuTelemetry(request, cluster ? [cluster] : []);
  const gpu = cluster ? gpuClusters[cluster] : undefined;
  const volcano = useVolcanoCapacity(cluster);
  const clusters = K8s.useClustersConf();
  const displayName = cluster ? clusters?.[cluster]?.meta_data?.rancherDisplayName || cluster : '';
  const version = useKubernetesVersion(cluster);
  const [nodes, nodesError] = Node.useList();
  const [pods, podsError] = Pod.useList();
  const [namespaces] = Namespace.useList();
  const [deployments, deploymentsError] = Deployment.useList();
  const [statefulSets, statefulSetsError] = StatefulSet.useList();
  const [daemonSets, daemonSetsError] = DaemonSet.useList();
  const [metrics, metricsError] = Node.useMetrics();

  const workloads: WorkloadGroup[] = [
    {
      kind: 'Deployment',
      label: t('Deployments'),
      icon: 'mdi:rocket-launch-outline',
      route: 'Deployments',
      items: deployments,
    },
    {
      kind: 'StatefulSet',
      label: t('Stateful Sets'),
      icon: 'mdi:database-outline',
      route: 'StatefulSets',
      items: statefulSets,
    },
    {
      kind: 'DaemonSet',
      label: t('Daemon Sets'),
      icon: 'mdi:server-network',
      route: 'DaemonSets',
      items: daemonSets,
    },
  ];
  const lists: [string, KubeObject[] | null, unknown][] = [
    [t('Nodes'), nodes, nodesError],
    [t('Pods'), pods, podsError],
    [t('Deployments'), deployments, deploymentsError],
    [t('Stateful Sets'), statefulSets, statefulSetsError],
    [t('Daemon Sets'), daemonSets, daemonSetsError],
  ];
  const forbidden = lists.filter(([, , error]) => isForbidden(error)).map(([label]) => label);
  const pending = lists
    .filter(([, items, error]) => items === null && !error)
    .map(([label]) => label);

  const { issues, objects } = React.useMemo(() => {
    const found: Issue[] = [];
    const byUid = new Map<string, KubeObject>();
    const collect = (
      items: KubeObject[] | null,
      toIssues: (json: KubeObject['jsonData']) => Issue[]
    ) => {
      for (const item of items ?? []) {
        const itemIssues = toIssues(item.jsonData);
        if (itemIssues.length > 0 && item.metadata.uid) byUid.set(item.metadata.uid, item);
        found.push(...itemIssues);
      }
    };
    collect(nodes, json => nodeIssues(json as NodeJson, t));
    collect(pods, json =>
      overviewPodPhase(json as PodJson) === 'Succeeded'
        ? []
        : podIssues(json as PodJson, undefined, t)
    );
    collect(deployments, json => workloadIssues('Deployment', json as WorkloadJson, t));
    collect(statefulSets, json => workloadIssues('StatefulSet', json as WorkloadJson, t));
    collect(daemonSets, json => workloadIssues('DaemonSet', json as WorkloadJson, t));
    return { issues: sortIssues(found), objects: byUid };
  }, [nodes, pods, deployments, statefulSets, daemonSets, t]);

  const nodeJson = React.useMemo(() => (nodes ?? []).map(n => n.jsonData as NodeJson), [nodes]);
  const podJson = React.useMemo(() => pods?.map(p => p.jsonData as PodJson) ?? null, [pods]);
  const metricsJson = metrics as MetricsJson[] | null;
  const capacity = clusterCapacity(nodeJson, metricsJson);
  const phases = podPhases(podJson ?? [], overviewPodPhase);
  const readyNodes = nodeJson.filter(isNodeReady).length;
  const allWorkloads = workloads.flatMap(group => group.items ?? []);
  const healthyWorkloads = allWorkloads.filter(item =>
    isWorkloadHealthy(item.jsonData as WorkloadJson)
  ).length;
  const errorCount = issues.filter(issue => issue.level === 'error').length;
  // Issues are shown as soon as they are found; "healthy" needs every list.
  const loading = pending.length > 0 && issues.length === 0;

  const stats: Stat[] = [
    {
      id: 'nodes',
      label: t('Nodes'),
      value: nodes ? `${readyNodes}/${nodes.length}` : '—',
      caption: !nodes
        ? t('Not available')
        : readyNodes === nodes.length
        ? t('All ready')
        : t('Not all ready'),
      icon: 'mdi:server',
      tone: !nodes ? 'primary' : readyNodes === nodes.length ? 'success' : 'error',
      to: Router.createRouteURL('nodes'),
    },
    {
      id: 'pods',
      label: t('Pods'),
      value: pods ? phases.running : '—',
      caption: !pods
        ? t('Not available')
        : phases.failed + phases.pending > 0
        ? t('{{pending}} pending · {{failed}} failed', {
            pending: phases.pending,
            failed: phases.failed,
          })
        : t('Running'),
      icon: 'mdi:cube-outline',
      tone: !pods
        ? 'primary'
        : phases.failed > 0
        ? 'error'
        : phases.pending > 0
        ? 'warning'
        : 'success',
      to: Router.createRouteURL('Pods'),
    },
    {
      id: 'workloads',
      label: t('Workloads'),
      value: allWorkloads.length > 0 ? `${healthyWorkloads}/${allWorkloads.length}` : '—',
      caption:
        allWorkloads.length === 0
          ? t('None yet')
          : healthyWorkloads === allWorkloads.length
          ? t('All ready')
          : t('{{count}} degraded', { count: allWorkloads.length - healthyWorkloads }),
      icon: 'mdi:chart-donut',
      tone:
        allWorkloads.length === 0
          ? 'primary'
          : healthyWorkloads === allWorkloads.length
          ? 'success'
          : 'warning',
      to: Router.createRouteURL('workloads'),
    },
    {
      id: 'namespaces',
      label: t('Namespaces'),
      value: namespaces ? namespaces.length : '—',
      caption: t('In this cluster'),
      icon: 'mdi:folder-outline',
      tone: 'primary',
      to: Router.createRouteURL('namespaces'),
    },
  ];

  return (
    <Box sx={pageSx}>
      <DashboardHeader
        icon="mdi:kubernetes"
        title={displayName || t('Cluster')}
        chips={version && <Chip label={`Kubernetes ${version}`} size="small" color="primary" />}
        subtitle={[
          t('Cluster overview'),
          nodes && plural(t, nodes.length, 'node'),
          namespaces && plural(t, namespaces.length, 'namespace'),
        ]
          .filter(Boolean)
          .join(' · ')}
        issues={issues}
        loading={loading}
      />

      {forbidden.length > 0 && (
        <Alert severity="warning" icon={<Icon icon="mdi:shield-lock-outline" />}>
          {t(
            'Your user is not allowed to list some resources ({{resources}}), so parts of this overview are incomplete.',
            { resources: forbidden.join(', ') }
          )}
        </Alert>
      )}

      <Box sx={cardGrid(210)}>
        {stats.map(stat => (
          <StatCard key={stat.id} stat={stat} />
        ))}
      </Box>

      <Box sx={twoColumns}>
        <Panel
          title={t('Needs attention')}
          icon="mdi:bell-alert-outline"
          action={
            !loading &&
            issues.length > 0 && (
              <Chip
                size="small"
                color={errorCount > 0 ? 'error' : 'warning'}
                label={issues.length}
              />
            )
          }
        >
          <IssueList
            issues={issues}
            objects={objects}
            pending={pending}
            emptyText={t('Every node is ready and every workload has its replicas.')}
          />
        </Panel>
        <Panel title={t('Capacity')} icon="mdi:gauge">
          <CapacityPanel
            nodes={nodeJson}
            pods={podJson}
            metrics={metricsJson}
            metricsUnavailable={!!metricsError}
            gpu={gpu}
            volcano={volcano}
          />
        </Panel>
      </Box>

      <UsageTrends
        cpuCapacity={nodes ? capacity.cpu.total : undefined}
        memoryCapacity={nodes ? capacity.memory.total : undefined}
        capacityLabel={t('allocatable')}
        gpuConfig={gpu?.config}
        gpuSampledAt={gpu?.sampledAt}
      />

      <Box sx={twoColumns}>
        <Panel
          title={t('Nodes')}
          icon="mdi:server"
          action={nodes && <Chip size="small" variant="outlined" label={nodes.length} />}
        >
          {nodes ? (
            <NodeList nodes={nodes} metrics={metricsJson} gpu={gpu} />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {nodesError ? t('Nodes are not available.') : t('Loading…')}
            </Typography>
          )}
        </Panel>
        <Panel title={t('Workloads')} icon="mdi:chart-donut">
          {workloads.map(group => (
            <WorkloadRow key={group.kind} group={group} />
          ))}
        </Panel>
      </Box>

      <EventsSection />
    </Box>
  );
}
