// 文件描述：展示 Headlamp Plus 概览及其资源状态。
// 项目名：Headlamp Plus
// 文件名：WorkloadsOverview.tsx
// 作者：Qintsg
// 日期：2026-11-21

/**
 * Workloads dashboard: health of every workload kind, what needs attention, and Headlamp's own
 * table of all workloads underneath. Follows the namespace filter of the table. Every part
 * renders as soon as its own data has arrived.
 */
import { Icon } from '@iconify/react';
import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import { Link, ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { getReadyReplicas, getTotalReplicas } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Alert, Box, Chip } from '@mui/material';
import React from 'react';
import { useSelector } from 'react-redux';
import {
  cardGrid,
  DashboardHeader,
  HealthRow,
  isForbidden,
  IssueList,
  pageSx,
  Panel,
  plural,
  Stat,
  StatCard,
  twoColumns,
} from './blocks';
import {
  CronJobJson,
  Issue,
  isWorkloadHealthy,
  jobIssues,
  JobJson,
  jobState,
  podIssues,
  PodJson,
  podPhases,
  sortIssues,
  totalReplicas,
  workloadIssues,
  WorkloadJson,
} from './clusterHealth';
import { Translate, usePlusText } from '../i18n';

const { Pod, Deployment, StatefulSet, DaemonSet, ReplicaSet, Job, CronJob, JobSet } =
  K8s.ResourceClasses;

/** One workload kind: how to judge its objects and what to report about them. */
interface KindGroup {
  kind: string;
  label: string;
  icon: string;
  /** Name of Headlamp's list route. */
  route: string;
  items: KubeObject[] | null;
  error: unknown;
  // Method syntax so each kind can take the JSON shape it understands (PodJson, JobJson, ...).
  isHealthy(json: KubeObject['jsonData']): boolean;
  issues(json: KubeObject['jsonData']): Issue[];
  /** Word after the healthy count in the "by kind" row; "ready" by default. */
  unit?: string;
  /** Extra detail for the "by kind" row. */
  caption?: (items: KubeObject[]) => string | undefined;
}

const replicaKind = (kind: string, t: Translate) => ({
  isHealthy: (json: WorkloadJson) => isWorkloadHealthy(json),
  issues: (json: WorkloadJson) => workloadIssues(kind, json, t),
});

const jobKind = (kind: string, t: Translate) => ({
  unit: 'healthy',
  isHealthy: (json: JobJson) => jobState(json) !== 'failed',
  issues: (json: JobJson) => jobIssues(kind, json, t),
});

function countWhere(
  items: KubeObject[] | null,
  predicate: (json: KubeObject['jsonData']) => boolean
): number {
  return (items ?? []).filter(item => predicate(item.jsonData)).length;
}

/** Namespaces selected in Headlamp's namespace filter; empty means all. */
function useSelectedNamespaces(): Set<string> {
  const selected = useSelector(
    (state: { filter?: { namespaces?: Set<string> } }) => state.filter?.namespaces
  );
  return React.useMemo(() => new Set(selected ?? []), [selected]);
}

/** Landing page of the Workloads section; replaces Headlamp's stock workloads overview. */
export function WorkloadsOverview() {
  const { t } = usePlusText();
  const [pods, podsError] = Pod.useList();
  const [deployments, deploymentsError] = Deployment.useList();
  const [statefulSets, statefulSetsError] = StatefulSet.useList();
  const [daemonSets, daemonSetsError] = DaemonSet.useList();
  const [replicaSets, replicaSetsError] = ReplicaSet.useList();
  const [jobs, jobsError] = Job.useList();
  const [cronJobs, cronJobsError] = CronJob.useList();
  const [jobSets, jobSetsError] = JobSet.useList();
  const namespaces = useSelectedNamespaces();

  const { groups, table } = React.useMemo(() => {
    const visible = (items: KubeObject[] | null) =>
      items && namespaces.size > 0
        ? items.filter(item => namespaces.has(item.metadata.namespace ?? ''))
        : items;
    const all: KindGroup[] = [
      {
        kind: 'Pod',
        label: t('Pods'),
        icon: 'mdi:cube-outline',
        route: 'Pods',
        items: visible(pods),
        error: podsError,
        isHealthy: (json: PodJson) => podIssues(json).length === 0,
        issues: (json: PodJson) => podIssues(json, undefined, t),
      },
      {
        kind: 'Deployment',
        label: t('Deployments'),
        icon: 'mdi:rocket-launch-outline',
        route: 'Deployments',
        items: visible(deployments),
        error: deploymentsError,
        ...replicaKind('Deployment', t),
      },
      {
        kind: 'StatefulSet',
        label: t('Stateful Sets'),
        icon: 'mdi:database-outline',
        route: 'StatefulSets',
        items: visible(statefulSets),
        error: statefulSetsError,
        ...replicaKind('StatefulSet', t),
      },
      {
        kind: 'DaemonSet',
        label: t('Daemon Sets'),
        icon: 'mdi:server-network',
        route: 'DaemonSets',
        items: visible(daemonSets),
        error: daemonSetsError,
        ...replicaKind('DaemonSet', t),
      },
      {
        kind: 'ReplicaSet',
        label: t('Replica Sets'),
        icon: 'mdi:content-copy',
        route: 'ReplicaSets',
        items: visible(replicaSets),
        error: replicaSetsError,
        isHealthy: (json: WorkloadJson) => isWorkloadHealthy(json),
        // Deployments already report their missing replicas; listing the ReplicaSet too would
        // show every problem twice.
        issues: () => [],
      },
      {
        kind: 'Job',
        label: t('Jobs'),
        icon: 'mdi:briefcase-check-outline',
        route: 'Jobs',
        items: visible(jobs),
        error: jobsError,
        ...jobKind('Job', t),
        caption: items => {
          const active = countWhere(items, json => jobState(json) === 'active');
          return active > 0 ? t('{{count}} active', { count: active }) : undefined;
        },
      },
      {
        kind: 'CronJob',
        label: t('Cron Jobs'),
        icon: 'mdi:calendar-clock',
        route: 'CronJobs',
        items: visible(cronJobs),
        error: cronJobsError,
        unit: 'active',
        isHealthy: (json: CronJobJson) => !json.spec?.suspend,
        issues: () => [],
        caption: items => {
          const suspended = countWhere(items, (json: CronJobJson) => !!json.spec?.suspend);
          return suspended > 0 ? t('{{count}} suspended', { count: suspended }) : undefined;
        },
      },
      {
        kind: 'JobSet',
        label: t('Job Sets'),
        icon: 'mdi:briefcase-variant-outline',
        route: 'JobSets',
        items: visible(jobSets),
        error: jobSetsError,
        ...jobKind('JobSet', t),
      },
    ];
    // Everything but pods, unfiltered: the table applies the namespace filter itself. Like
    // Headlamp's own page it fills in as lists arrive; it only shows its spinner until the
    // first one has.
    const lists: (KubeObject[] | null)[] = [
      deployments,
      statefulSets,
      daemonSets,
      replicaSets,
      jobs,
      cronJobs,
      jobSets,
    ];
    const errors = [
      deploymentsError,
      statefulSetsError,
      daemonSetsError,
      replicaSetsError,
      jobsError,
      cronJobsError,
      jobSetsError,
    ];
    const noneLoaded = lists.every((items, index) => items === null && !errors[index]);
    return { groups: all, table: noneLoaded ? null : lists.flatMap(items => items ?? []) };
  }, [
    namespaces,
    pods,
    deployments,
    statefulSets,
    daemonSets,
    replicaSets,
    jobs,
    cronJobs,
    jobSets,
    podsError,
    deploymentsError,
    statefulSetsError,
    daemonSetsError,
    replicaSetsError,
    jobsError,
    cronJobsError,
    jobSetsError,
    t,
  ]);

  const { issues, objects } = React.useMemo(() => {
    const found: Issue[] = [];
    const byUid = new Map<string, KubeObject>();
    for (const group of groups) {
      for (const item of group.items ?? []) {
        const itemIssues = group.issues(item.jsonData);
        if (itemIssues.length > 0 && item.metadata.uid) byUid.set(item.metadata.uid, item);
        found.push(...itemIssues);
      }
    }
    return { issues: sortIssues(found), objects: byUid };
  }, [groups]);

  const group = (kind: string) => groups.find(g => g.kind === kind)!;
  // JobSet is an optional API: its discovery can take long when the CRD is missing, so nothing
  // waits for it.
  const pending = groups
    .filter(g => g.kind !== 'JobSet' && g.items === null && !g.error)
    .map(g => g.label);
  const isPending = (kind: string) => pending.includes(group(kind).label);
  const forbidden = groups.filter(g => isForbidden(g.error)).map(g => g.label);
  // A kind whose API is missing (JobSet without its CRD: Headlamp reports an empty list with an
  // error) is left out instead of shown as empty.
  const shownGroups = groups.filter(g => !g.error || isForbidden(g.error));
  const errorCount = issues.filter(issue => issue.level === 'error').length;
  // Issues are shown as soon as they are found; "healthy" needs every list.
  const loading = pending.length > 0 && issues.length === 0;

  const controllers = ['Deployment', 'StatefulSet', 'DaemonSet'].flatMap(
    kind => group(kind).items ?? []
  );
  const controllersPending = ['Deployment', 'StatefulSet', 'DaemonSet'].some(isPending);
  const healthyControllers = controllers.filter(item => isWorkloadHealthy(item.jsonData)).length;
  const replicas = totalReplicas(controllers.map(item => item.jsonData as WorkloadJson));
  const podItems = group('Pod').items;
  const phases = podPhases((podItems ?? []).map(pod => pod.jsonData as PodJson));
  const jobItems = group('Job').items;
  const failedJobs = countWhere(jobItems, json => jobState(json) === 'failed');
  const activeJobs = countWhere(jobItems, json => jobState(json) === 'active');
  const cronItems = group('CronJob').items;
  const suspended = countWhere(cronItems, (json: CronJobJson) => !!json.spec?.suspend);

  const stats: Stat[] = [
    {
      id: 'workloads',
      label: t('Workloads ready'),
      value:
        !controllersPending && controllers.length > 0
          ? `${healthyControllers}/${controllers.length}`
          : '—',
      caption: controllersPending
        ? t('Loading…')
        : controllers.length === 0
        ? t('No deployments, stateful or daemon sets')
        : healthyControllers === controllers.length
        ? t('All ready')
        : t('{{count}} degraded', { count: controllers.length - healthyControllers }),
      icon: 'mdi:chart-donut',
      tone:
        controllersPending || controllers.length === 0
          ? 'primary'
          : healthyControllers === controllers.length
          ? 'success'
          : 'warning',
    },
    {
      id: 'replicas',
      label: t('Replicas'),
      value:
        !controllersPending && replicas.desired > 0 ? `${replicas.ready}/${replicas.desired}` : '—',
      caption: controllersPending
        ? t('Loading…')
        : replicas.desired === 0
        ? t('None requested')
        : replicas.ready === replicas.desired
        ? t('All ready')
        : t('{{count}} not ready', { count: replicas.desired - replicas.ready }),
      icon: 'mdi:layers-triple-outline',
      tone:
        controllersPending || replicas.desired === 0
          ? 'primary'
          : replicas.ready === replicas.desired
          ? 'success'
          : 'warning',
    },
    {
      id: 'pods',
      label: t('Pods running'),
      value: podItems ? phases.running : '—',
      caption: !podItems
        ? t('Not available')
        : phases.failed + phases.pending > 0
        ? t('{{pending}} pending · {{failed}} failed', {
            pending: phases.pending,
            failed: phases.failed,
          })
        : t('of {{pods}}', { pods: plural(t, podItems.length, 'pod') }),
      icon: 'mdi:cube-outline',
      tone: !podItems
        ? 'primary'
        : phases.failed > 0
        ? 'error'
        : phases.pending > 0
        ? 'warning'
        : 'success',
      to: Router.createRouteURL('Pods'),
    },
    {
      id: 'jobs',
      label: t('Jobs'),
      value: jobItems ? jobItems.length : '—',
      caption: !jobItems
        ? t('Not available')
        : failedJobs + activeJobs > 0
        ? t('{{active}} active · {{failed}} failed', { active: activeJobs, failed: failedJobs })
        : jobItems.length > 0
        ? t('All completed')
        : t('None yet'),
      icon: 'mdi:briefcase-check-outline',
      tone: !jobItems ? 'primary' : failedJobs > 0 ? 'error' : activeJobs > 0 ? 'info' : 'success',
      to: Router.createRouteURL('Jobs'),
    },
    {
      id: 'cronjobs',
      label: t('Cron Jobs'),
      value: cronItems ? cronItems.length : '—',
      caption: !cronItems
        ? t('Not available')
        : suspended > 0
        ? t('{{count}} suspended', { count: suspended })
        : t('Scheduled'),
      icon: 'mdi:calendar-clock',
      tone: suspended > 0 ? 'warning' : 'primary',
      to: Router.createRouteURL('CronJobs'),
    },
  ];

  return (
    <Box sx={pageSx}>
      <DashboardHeader
        icon="mdi:chart-donut"
        title={t('Workloads')}
        subtitle={[
          namespaces.size > 0 ? plural(t, namespaces.size, 'namespace') : t('All namespaces'),
          !controllersPending && plural(t, controllers.length, 'workload'),
          podItems && plural(t, podItems.length, 'pod'),
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
            emptyText={t('Every workload has its replicas and no pod or job is failing.')}
          />
        </Panel>
        <Panel title={t('Health by kind')} icon="mdi:heart-pulse">
          {shownGroups.map(g => (
            <HealthRow
              key={g.kind}
              label={g.label}
              icon={g.icon}
              to={Router.createRouteURL(g.route)}
              loaded={!!g.items}
              total={g.items?.length ?? 0}
              healthy={countWhere(g.items, g.isHealthy)}
              caption={g.items && g.caption ? g.caption(g.items) : undefined}
              unit={g.unit}
            />
          ))}
        </Panel>
      </Box>

      {/* Same table as Headlamp's own workloads page. */}
      <ResourceListView
        title={t('Workloads')}
        reflectInURL
        columns={[
          'kind',
          {
            id: 'name',
            label: t('Name'),
            gridTemplate: 'auto',
            getValue: item => item.metadata.name,
            render: item => <Link kubeObject={item} />,
          },
          'namespace',
          'cluster',
          {
            id: 'pods',
            label: t('Pods'),
            gridTemplate: 'min-content',
            getValue: item =>
              `${getReadyReplicas(item.jsonData)}/${getTotalReplicas(item.jsonData)}`,
            sort: (a, b) =>
              getTotalReplicas(a.jsonData) - getTotalReplicas(b.jsonData) ||
              getReadyReplicas(a.jsonData) - getReadyReplicas(b.jsonData),
          },
          'age',
        ]}
        data={table}
        headerProps={{ noNamespaceFilter: false }}
        id="headlamp-workloads"
      />
    </Box>
  );
}
