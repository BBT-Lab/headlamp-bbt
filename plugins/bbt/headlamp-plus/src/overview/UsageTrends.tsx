// 文件描述：展示 Headlamp Plus 概览及其资源状态。
// 项目名：Headlamp Plus
// 文件名：UsageTrends.tsx
// 作者：Qintsg
// 日期：2026-11-21

/**
 * "Usage trend" panel of the cluster and namespace dashboards: CPU and memory used over the last
 * hour to week, from Prometheus. Shown only when a Prometheus compatible service answers; the
 * service can also be entered by hand for the session.
 */
import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import {
  Box,
  Button,
  CircularProgress,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ConnectionConfig } from '../../../../../frontend/src/lib/k8s/gpu/config';
import { useGpuRange } from '../../../../../frontend/src/lib/k8s/gpu/hooks';
import { gpuHistory } from '../../../../../frontend/src/lib/k8s/gpu/summary';
import { cardGrid, Panel } from './blocks';
import { formatCores, formatGiB } from './clusterHealth';
import {
  discoverPrometheus,
  endpointOf,
  parseService,
  PrometheusEndpoint,
  promRange,
} from './prometheus';
import {
  RANGES,
  rangeWindow,
  summarize,
  timeLabel,
  toPoints,
  TrendPoint,
  trendQueries,
  TrendRange,
} from './trends';
import { usePlusText } from '../i18n';

/** Categorical slot 1 of the reference palette, stepped per mode. */
const SERIES_COLOR = { light: '#2a78d6', dark: '#3987e5' };

/** Services entered by hand, per cluster, for the session. */
const manual = new Map<string, PrometheusEndpoint>();

type PromState =
  | { status: 'loading' }
  | { status: 'ready'; endpoint: PrometheusEndpoint }
  | { status: 'missing' };

function usePrometheus(cluster: string): [PromState, (endpoint: PrometheusEndpoint) => void] {
  const [state, setState] = React.useState<PromState>({ status: 'loading' });
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    const chosen = manual.get(cluster);
    if (chosen) {
      setState({ status: 'ready', endpoint: chosen });
      return;
    }
    setState({ status: 'loading' });
    discoverPrometheus(cluster)
      .then(endpoint => {
        if (!cancelled) setState(endpoint ? { status: 'ready', endpoint } : { status: 'missing' });
      })
      .catch(() => !cancelled && setState({ status: 'missing' }));
    return () => {
      cancelled = true;
    };
  }, [cluster, attempt]);
  const choose = (endpoint: PrometheusEndpoint) => {
    manual.set(cluster, endpoint);
    setAttempt(a => a + 1);
  };
  return [state, choose];
}

interface Trends {
  cpu: TrendPoint[];
  memory: TrendPoint[];
}

function useTrends(
  endpoint: PrometheusEndpoint | undefined,
  cluster: string,
  range: TrendRange,
  namespace?: string
): { data?: Trends; error?: string; loading: boolean } {
  const [state, setState] = React.useState<{ data?: Trends; error?: string; loading: boolean }>({
    loading: true,
  });
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const timer = window.setInterval(() => setTick(t => t + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  React.useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;
    const { start, end, step } = rangeWindow(range);
    const queries = trendQueries(namespace, step);
    setState(s => ({ ...s, loading: true }));
    Promise.all([
      promRange(endpoint, queries.cpu, start, end, step, cluster),
      promRange(endpoint, queries.memory, start, end, step, cluster),
    ])
      .then(
        ([cpu, memory]) =>
          !cancelled &&
          setState({ data: { cpu: toPoints(cpu), memory: toPoints(memory) }, loading: false })
      )
      .catch(err => !cancelled && setState({ error: (err as Error).message, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [endpoint?.base, cluster, range, namespace, tick]);
  return state;
}

function TrendChart({
  title,
  points,
  range,
  format,
  unit,
  capacity,
  capacityLabel,
  emptyLabel,
}: {
  title: string;
  points: { ts: number; value: number | null }[];
  range: TrendRange;
  format: (value: number) => string;
  unit: string;
  capacity?: number;
  capacityLabel: string;
  emptyLabel?: string;
}) {
  const { t, language } = usePlusText();
  const theme = useTheme();
  const color = SERIES_COLOR[theme.palette.mode === 'dark' ? 'dark' : 'light'];
  const summary = summarize(points.filter((point): point is TrendPoint => point.value !== null));
  const id = React.useId().replace(/:/g, '');
  const top = Math.max(summary?.max ?? 0, capacity ?? 0) * 1.05 || 1;
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          {title}
        </Typography>
        {summary && (
          <Typography variant="body2" color="text.secondary">
            {t('now')}{' '}
            <Box component="strong" sx={{ color: 'text.primary' }}>
              {format(summary.last)} {unit}
            </Box>{' '}
            {t('· peak')} {format(summary.max)} {unit}
          </Typography>
        )}
      </Box>
      {!summary ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
          {emptyLabel ??
            t(
              "No samples in this range. The trend needs the kubelet's cAdvisor metrics in Prometheus."
            )}
        </Typography>
      ) : (
        <Box
          sx={{ height: 180 }}
          role="img"
          aria-label={t('{{title}} over the last {{range}}', { title, range: t(range) })}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={theme.palette.divider} strokeDasharray="0" vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={ts => timeLabel(ts, range, language)}
                tick={{ fill: theme.palette.text.secondary, fontSize: 11 }}
                stroke={theme.palette.divider}
                minTickGap={40}
              />
              <YAxis
                domain={[0, top]}
                tickFormatter={v => format(v)}
                tick={{ fill: theme.palette.text.secondary, fontSize: 11 }}
                stroke={theme.palette.divider}
                width={48}
              />
              <Tooltip
                cursor={{ stroke: theme.palette.text.secondary, strokeWidth: 1 }}
                contentStyle={{
                  background: theme.palette.background.paper,
                  border: `1px solid ${theme.palette.divider}`,
                  color: theme.palette.text.primary,
                  fontSize: 12,
                }}
                labelFormatter={ts => new Date(Number(ts)).toLocaleString(language)}
                formatter={v => [`${format(Number(v))} ${unit}`, title]}
              />
              {capacity !== undefined && (
                <ReferenceLine
                  y={capacity}
                  stroke={theme.palette.text.secondary}
                  strokeDasharray="4 4"
                  label={{
                    value: `${capacityLabel} ${format(capacity)}`,
                    position: 'insideTopLeft',
                    fill: theme.palette.text.secondary,
                    fontSize: 11,
                  }}
                />
              )}
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fill={`url(#fill-${id})`}
                isAnimationActive={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Box>
  );
}

function ServicePicker({ onChoose }: { onChoose: (endpoint: PrometheusEndpoint) => void }) {
  const { t } = usePlusText();
  const [text, setText] = React.useState('');
  const service = parseService(text);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="body2" color="text.secondary">
        {t(
          "No Prometheus compatible service was found. The trend needs Prometheus (or Thanos, Mimir, VictoriaMetrics) with the kubelet's cAdvisor metrics; enter its service to use it."
        )}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          size="small"
          label={t('Prometheus service')}
          placeholder="monitoring/prometheus-operated:9090"
          value={text}
          onChange={e => setText(e.target.value)}
          error={!!text && !service}
          sx={{ flexGrow: 1 }}
        />
        <Button
          variant="outlined"
          disabled={!service}
          onClick={() => service && onChoose(endpointOf(service))}
        >
          {t('Use')}
        </Button>
      </Box>
    </Box>
  );
}

/**
 * CPU and memory used over time by the whole cluster or by one namespace, with the allocatable
 * capacity or the quota as a dashed line.
 */
export function UsageTrends({
  namespace,
  cpuCapacity,
  memoryCapacity,
  capacityLabel,
  gpuConfig,
  gpuSampledAt,
}: {
  namespace?: string;
  /** Cores. */
  cpuCapacity?: number;
  /** Bytes. */
  memoryCapacity?: number;
  /** Name of the dashed line, e.g. "allocatable" or "quota". */
  capacityLabel: string;
  gpuConfig?: ConnectionConfig;
  gpuSampledAt?: number;
}) {
  const { t } = usePlusText();
  const cluster = K8s.useCluster() || '';
  const [prom, choose] = usePrometheus(cluster);
  const [range, setRange] = React.useState<TrendRange>('6h');
  const gpuRange = useGpuRange(
    request,
    cluster,
    gpuConfig,
    range === '7d' ? 168 : Number.parseInt(range, 10),
    Math.floor((gpuSampledAt ?? 0) / 60000)
  );
  const gpuPoints = React.useMemo(
    () =>
      gpuRange
        ? gpuHistory(gpuRange.series, gpuRange.start, gpuRange.end, gpuRange.step).map(point => ({
            ts: point.ts,
            value: point.utilization,
          }))
        : [],
    [gpuRange]
  );
  const trends = useTrends(
    prom.status === 'ready' ? prom.endpoint : undefined,
    cluster,
    range,
    namespace
  );

  return (
    <Panel
      title={t('Usage trend')}
      icon="mdi:chart-areaspline"
      action={
        prom.status === 'ready' && (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={range}
            onChange={(_, v) => v && setRange(v)}
            aria-label={t('Time range')}
          >
            {RANGES.map(r => (
              <ToggleButton key={r} value={r} sx={{ py: 0.25, px: 1 }}>
                {t(r)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )
      }
    >
      {prom.status === 'loading' ? (
        <CircularProgress size={20} />
      ) : prom.status === 'missing' ? (
        <ServicePicker onChoose={choose} />
      ) : trends.error ? (
        <Typography variant="body2" color="error">
          <Icon icon="mdi:alert-circle" width={16} style={{ verticalAlign: 'middle' }} />{' '}
          {trends.error === 'Unexpected Prometheus response'
            ? t('Unexpected Prometheus response')
            : trends.error}
        </Typography>
      ) : !trends.data ? (
        <CircularProgress size={20} />
      ) : (
        <>
          <Box sx={cardGrid(320)}>
            <TrendChart
              title={t('CPU used')}
              points={trends.data.cpu}
              range={range}
              format={formatCores}
              unit={t('cores')}
              capacity={cpuCapacity}
              capacityLabel={capacityLabel}
            />
            <TrendChart
              title={t('Memory used')}
              points={trends.data.memory}
              range={range}
              format={formatGiB}
              unit="GiB"
              capacity={memoryCapacity}
              capacityLabel={capacityLabel}
            />
            {gpuConfig && (
              <TrendChart
                title={t('GPU usage')}
                points={gpuPoints}
                range={range}
                format={formatCores}
                unit="%"
                capacity={100}
                capacityLabel={t('Maximum')}
                emptyLabel={t('No GPU samples in this range.')}
              />
            )}
          </Box>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
            {t('From {{source}}: container usage reported by the kubelets (cAdvisor).', {
              source: prom.endpoint.label,
            })}
          </Typography>
        </>
      )}
    </Panel>
  );
}
