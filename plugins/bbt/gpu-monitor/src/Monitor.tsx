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
import { GpuDeviceTable, gpuInstanceLabel, gpuPercent, type GpuSelection } from './DeviceTable';

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
  const [hours, setHours] = useState(6);
  const [selection, setSelection] = useState<GpuSelection>();
  const [refresh, setRefresh] = useState(0);
  const [pods, setPods] = useState<Record<string, GpuPodAccess>>({});
  const { clusters, loading } = useGpuTelemetry(request, [cluster], refresh);
  const data = clusters[cluster];
  const cards = useMemo(
    () =>
      (data?.cards ?? []).flatMap(card => {
        if (!scope) return [card];
        const devices = card.devices.filter(device => inScope(device, scope));
        return devices.length ? [{ ...card, devices }] : [];
      }),
    [data, scope]
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

  if (scope && !cards.length) return null;
  const usage = gpuUsage(cards, gpuOccupationKnown(data, scope?.node));
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
  return (
    <Box sx={{ display: 'grid', gap: 2.5, p: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Typography variant="h5" component="h1">
          {t('GPU Monitor')}
        </Typography>
        <Button onClick={() => setRefresh(value => value + 1)}>{t('Refresh')}</Button>
      </Box>
      {loading && !data ? (
        <CircularProgress size={24} />
      ) : !data ? (
        <Typography color="text.secondary">
          {t('No available GPU telemetry for this cluster.')}
        </Typography>
      ) : (
        <>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: 2,
            }}
          >
            {summary.map(([label, value]) => (
              <Paper key={label} variant="outlined" sx={{ p: 2.5 }}>
                <Typography variant="body2" color="text.secondary">
                  {label}
                </Typography>
                <Typography variant="h4" sx={{ mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>
                  {value}
                </Typography>
              </Paper>
            ))}
          </Box>
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
              selected={card ? { cardId: card.id, deviceId: selectedDevice?.id } : undefined}
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
                <Typography variant="subtitle1" component="h2">
                  {t('Device metrics history')} · {card.node} / GPU {card.index}
                  {selectedDevice?.instance && ` · ${gpuInstanceLabel(selectedDevice.instance)}`}
                </Typography>
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
