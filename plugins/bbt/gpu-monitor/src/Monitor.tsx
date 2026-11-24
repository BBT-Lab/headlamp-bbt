/*
 * 文件描述：显示GPU摘要、原生设备表格和实际历史趋势。
 * 项目名称：Headlamp BBT
 * 文件名称：Monitor.tsx
 * 作者：gen3111620、Codex
 * 日期：2026-11-23
 */

import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import {
  Box,
  Button,
  CircularProgress,
  Paper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useGpuRange, useGpuTelemetry } from '../../../../frontend/src/lib/k8s/gpu/hooks';
import { inScope, type Scope } from '../../../../frontend/src/lib/k8s/gpu/metrics';
import { gpuHistory, gpuUsage } from '../../../../frontend/src/lib/k8s/gpu/summary';
import {
  gpuOccupationKnown,
  loadGpuPods,
  type GpuPodAccess,
} from '../../../../frontend/src/lib/k8s/gpu/telemetry';
import {
  allocation,
  GpuDeviceTable,
  gpuInstanceLabel,
  gpuPercent,
  type GpuSelection,
  VgpuQuotaSummary,
  VgpuUsageLine,
} from './DeviceTable';
import { loadVgpuTelemetry, type VgpuAllocation } from './VgpuTelemetry';

/** 随当前集群和详情作用域读取GPU数据。 */
export function GpuMonitor({ cluster, scope }: { cluster?: string; scope?: Scope }) {
  const current = K8s.useCluster();
  const name = cluster ?? current ?? '';
  return <ClusterMonitor key={JSON.stringify([name, scope])} cluster={name} scope={scope} />;
}

/** 渲染当前集群或对象的GPU监控。 */
function ClusterMonitor({ cluster, scope }: { cluster: string; scope?: Scope }) {
  const { t } = useTranslation('headlamp-gpu-monitor');
  const [filter, setFilter] = useState('');
  const [nodeFilter, setNodeFilter] = useState('');
  const [hours, setHours] = useState(6);
  const [selection, setSelection] = useState<GpuSelection>();
  const [refresh, setRefresh] = useState(0);
  const [pods, setPods] = useState<Record<string, GpuPodAccess>>({});
  const [sharedCards, setSharedCards] = useState(new Map<string, VgpuAllocation>());
  const { clusters, loading } = useGpuTelemetry(request, [cluster], refresh);
  const data = clusters[cluster];
  const nodes = useMemo(
    () =>
      [...new Set((data?.cards ?? []).map(card => card.node))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
      ),
    [data]
  );
  const activeNode = nodes.includes(nodeFilter) ? nodeFilter : '';
  const cards = useMemo(
    () =>
      (data?.cards ?? []).flatMap(card => {
        if (activeNode && card.node !== activeNode) return [];
        if (!scope) return [card];
        const devices = card.devices.filter(device => inScope(device, scope));
        return devices.length ? [{ ...card, devices }] : [];
      }),
    [activeNode, data, scope]
  );
  const range = useGpuRange(
    request,
    cluster,
    data?.config,
    24,
    60 * refresh + Math.floor((data?.sampledAt ?? 0) / 60000)
  );
  const card = cards.find(gpu => gpu.id === selection?.cardId) ?? cards[0];
  const selectedDevice = card?.devices.find(device => device.id === selection?.deviceId);
  const points = useMemo(
    () =>
      range && card
        ? gpuHistory(
            range.series,
            range.end - hours * 3600,
            range.end,
            range.step,
            new Set(selectedDevice ? [selectedDevice.id] : card.devices.map(device => device.id))
          )
        : [],
    [range, card, selectedDevice, hours]
  );

  useEffect(() => {
    if (!data || !cards.length) return;
    const owner = new AbortController();
    loadGpuPods(request, cluster, cards, owner.signal)
      .then(result => {
        if (!owner.signal.aborted) setPods(result);
      })
      .catch(() => {
        if (!owner.signal.aborted) setPods({});
      });
    return () => owner.abort();
  }, [cards, cluster, data]);

  useEffect(() => {
    if (!data || scope) return;
    const owner = new AbortController();
    loadVgpuTelemetry(cluster, data, owner.signal)
      .then(result => {
        if (!owner.signal.aborted) setSharedCards(result);
      })
      .catch(() => {
        if (!owner.signal.aborted) setSharedCards(new Map());
      });
    return () => owner.abort();
  }, [cluster, data, scope]);

  if (scope && !cards.length) return null;
  const filterNode = scope?.node || activeNode || undefined;
  const confirmedByVolcano =
    !!data &&
    [...data.unmappedNodes].every(node => {
      if (node === '*') return false;
      if (filterNode && node !== filterNode) return true;
      const devices = cards.filter(item => item.node === node);
      return devices.length > 0 && devices.every(item => sharedCards.has(item.id));
    });
  const usage = gpuUsage(
    cards.map(item => (sharedCards.get(item.id)?.count ? { ...item, occupied: true } : item)),
    gpuOccupationKnown(data, filterNode) || confirmedByVolcano
  );
  const filtered = cards.filter(item =>
    `${item.node} GPU ${item.index} ${item.acceleratorId} ${item.model} ${item.devices
      .map(gpu => gpu.instance)
      .join(' ')}`
      .toLowerCase()
      .includes(filter.trim().toLowerCase())
  );
  const memory =
    usage.memoryUsed === undefined || usage.memoryTotal === undefined
      ? '—'
      : `${(usage.memoryUsed / 1024).toFixed(1)} / ${(usage.memoryTotal / 1024).toFixed(1)} GiB`;
  const summary = [
    [t('Occupied / total GPUs'), `${usage.occupied ?? '—'}/${usage.total}`],
    [t('Average GPU utilization'), gpuPercent(usage.utilization)],
    [t('Used / total GPU memory'), memory],
  ];
  const selectedShared = card && sharedCards.get(card.id);
  const selectedWorkload =
    selection?.cardId === card?.id
      ? selectedShared?.workloads.find(item => item.name === selection?.workloadName)
      : undefined;
  const selectedWorkloads = selectedWorkload
    ? [selectedWorkload.name]
    : selectedShared?.count
    ? selectedShared.workloads.length
      ? selectedShared.workloads.map(item => item.name)
      : [t('Assignment unknown')]
    : card && data
    ? [
        ...new Set(
          (selectedDevice ? [selectedDevice] : card.devices).flatMap(device =>
            allocation(
              device,
              pods,
              data.sampledAt,
              undefined,
              selectedShared?.count === 0 || gpuOccupationKnown(data, card.node),
              t
            ).map(item => item.label)
          )
        ),
      ]
    : [];
  return (
    <Box sx={{ display: 'grid', gap: 2.5, p: 1 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr) auto',
          alignItems: 'center',
          gap: 2,
        }}
      >
        <Typography variant="h5" component="h1" sx={{ whiteSpace: 'nowrap' }}>
          {t('GPU Monitor')}
        </Typography>
        <Box
          role="group"
          aria-label={t('GPU summary')}
          sx={{
            alignSelf: 'stretch',
            display: 'flex',
            gap: 1,
            overflowX: 'auto',
            scrollbarWidth: 'none',
          }}
        >
          {data &&
            summary.map(([label, value]) => (
              <Paper
                key={label}
                variant="outlined"
                sx={{
                  flex: '1 0 auto',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 1,
                  px: 1.25,
                  whiteSpace: 'nowrap',
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}
                >
                  {value}
                </Typography>
              </Paper>
            ))}
        </Box>
        <Button size="small" onClick={() => setRefresh(value => value + 1)}>
          {t('Refresh')}
        </Button>
      </Box>
      {loading && !data ? (
        <CircularProgress size={24} />
      ) : !data ? (
        <Typography color="text.secondary">
          {t('No available GPU telemetry for this cluster.')}
        </Typography>
      ) : (
        <>
          {!scope && nodes.length > 0 && (
            <Box
              role="group"
              aria-label={t('Filter by GPU node')}
              sx={{
                display: 'flex',
                gap: '4px',
                overflowX: 'auto',
                minWidth: 0,
                pb: 0.5,
                '& > button': {
                  flex: '0 0 min(76px, max(48px, calc((100% - 36px) / 10)))',
                  minWidth: 0,
                  px: 0.75,
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textTransform: 'none',
                },
              }}
            >
              {['', ...nodes].map(node => (
                <Button
                  key={node}
                  size="small"
                  variant={node === activeNode ? 'contained' : 'outlined'}
                  disableElevation
                  aria-pressed={node === activeNode}
                  title={node || t('All')}
                  onClick={() => {
                    setNodeFilter(node);
                    setSelection(undefined);
                  }}
                >
                  {node || t('All')}
                </Button>
              ))}
            </Box>
          )}
          <Paper variant="outlined" sx={{ minWidth: 0, overflow: 'hidden' }}>
            <Box
              sx={{
                p: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 2,
              }}
            >
              <Typography component="h2" variant="h6">
                {t('GPU devices')}
              </Typography>
              <TextField
                size="small"
                label={t('Filter GPUs')}
                value={filter}
                onChange={event => setFilter(event.target.value)}
              />
            </Box>
            <GpuDeviceTable
              cards={filtered}
              data={data}
              history={range}
              pods={pods}
              showNodes={!activeNode}
              sharedCards={sharedCards}
              selected={
                card
                  ? {
                      cardId: card.id,
                      deviceId: selectedDevice?.id,
                      workloadName: selectedWorkload?.name,
                    }
                  : undefined
              }
              onSelect={setSelection}
              t={t}
            />
          </Paper>
          {card && (
            <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  mb: 1,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle1" component="h2">
                    {t('Device metrics history')} · {card.node} / GPU {card.index}
                    {selectedDevice?.instance && ` · ${gpuInstanceLabel(selectedDevice.instance)}`}
                  </Typography>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'baseline',
                      flexWrap: 'wrap',
                      gap: 1.25,
                    }}
                  >
                    {selectedWorkloads.length > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        {t('Workload')} · {selectedWorkloads.join('、')}
                      </Typography>
                    )}
                    {selectedShared && <VgpuQuotaSummary shared={selectedShared} t={t} />}
                    {selectedWorkload && <VgpuUsageLine workload={selectedWorkload} t={t} />}
                  </Box>
                </Box>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={hours}
                  aria-label={t('Time range')}
                  onChange={(_, next: number | null) => {
                    if (next) setHours(next);
                  }}
                >
                  {[1, 6, 24].map(hour => (
                    <ToggleButton key={hour} value={hour}>
                      {t(`${hour}h`)}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Box>
              {points.some(point => point.utilization !== null || point.memory !== null) ? (
                <Box role="img" aria-label={t('Device metrics history')} sx={{ height: 190 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={points}>
                      <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.12} />
                      <XAxis
                        dataKey="ts"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={time =>
                          new Date(time).toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        }
                      />
                      <YAxis domain={[0, 100]} tickFormatter={value => `${value}%`} width={45} />
                      <Tooltip
                        labelFormatter={value => new Date(Number(value)).toLocaleString()}
                        formatter={value => gpuPercent(Number(value))}
                      />
                      <Legend />
                      <Line
                        dataKey="utilization"
                        name={t('GPU utilization')}
                        stroke="#1782c7"
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        dataKey="memory"
                        name={t('GPU memory utilization')}
                        stroke="#16806b"
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </Box>
              ) : (
                <Typography color="text.secondary">{t('No samples in this range.')}</Typography>
              )}
            </Paper>
          )}
        </>
      )}
    </Box>
  );
}
