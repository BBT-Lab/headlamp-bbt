/*
 * 文件描述：按节点、物理GPU、工作负载组合显示GPU设备。
 * 项目名称：Headlamp BBT
 * 文件名称：DeviceTable.tsx
 * 作者：Codex
 * 日期：2026-11-23
 */

import {
  Box,
  Button,
  Chip,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useLayoutEffect, useRef } from 'react';
import type { Gpu } from '../../../../frontend/src/lib/k8s/gpu/metrics';
import {
  gpuDuration,
  gpuMemory,
  gpuUtilization,
  gpuWorkloads,
  type PhysicalGpu,
} from '../../../../frontend/src/lib/k8s/gpu/summary';
import {
  gpuIdleAge,
  gpuOccupationKnown,
  type GpuPodAccess,
  type GpuRange,
  type GpuTelemetry,
} from '../../../../frontend/src/lib/k8s/gpu/telemetry';

export type Translate = (key: string) => string;
export interface GpuSelection {
  cardId: string;
  deviceId?: string;
}

interface Row {
  card: PhysicalGpu;
  device: Gpu;
  nodeSpan?: number;
  cardSpan?: number;
  workloadSpan?: number;
}

/** 将连续设备行中的相同工作负载同时合并到两列。 */
function tableRows(cards: readonly PhysicalGpu[]): Row[] {
  const groups = new Map<string, PhysicalGpu[]>();
  for (const card of cards) {
    const group = groups.get(card.node) ?? [];
    group.push(card);
    groups.set(card.node, group);
  }
  return [...groups.values()].flatMap(group => {
    const rows: Row[] = group.flatMap(card =>
      card.devices.map((device, index) => ({
        card,
        device,
        cardSpan: index === 0 ? card.devices.length : undefined,
      }))
    );
    if (!rows.length) return rows;
    rows[0].nodeSpan = rows.length;
    const workloadKeys = rows.map(row =>
      [...new Set(gpuWorkloads(row.device).map(item => `${item.namespace}/${item.pod}`))]
        .sort()
        .join('\u0000')
    );
    for (let start = 0; start < rows.length; ) {
      let end = start + 1;
      while (workloadKeys[start] && workloadKeys[start] === workloadKeys[end]) end += 1;
      rows[start].workloadSpan = end - start;
      start = end;
    }
    return rows;
  });
}

/** GPU模型和设备ID使用DCGM采样的名称。 */
export function gpuInstanceLabel(instance: string): string {
  return instance.startsWith('MIG') ? instance : `MIG ${instance}`;
}

/** 按界面设计显示去掉多余小数的GPU使用率。 */
export function gpuPercent(value: number | undefined): string {
  return value === undefined ? '—' : `${Math.round(value * 10) / 10}%`;
}

/** 显示原始GPU指标与紧凑进度条。 */
function Meter({ value, label, memory }: { value?: number; label: string; memory?: boolean }) {
  return (
    <Box sx={{ minWidth: 42 }}>
      <Typography variant="caption">{gpuPercent(value)}</Typography>
      {value !== undefined && (
        <LinearProgress
          aria-label={label}
          variant="determinate"
          value={value}
          color={memory ? 'success' : 'primary'}
          sx={{ width: 45, height: 4, borderRadius: 2 }}
        />
      )}
    </Box>
  );
}

/** 在当前用户有Pod读取权限时显示归属与本次启动时长。 */
function allocation(
  device: Gpu,
  pods: Record<string, GpuPodAccess>,
  sampledAt: number,
  range: GpuRange | undefined,
  known: boolean,
  t: Translate
) {
  const active = new Set(gpuWorkloads(device).map(item => `${item.namespace}/${item.pod}`));
  const visible: {
    key: string;
    label: string;
    title?: string;
    duration: string;
    idle?: boolean;
  }[] = [];
  for (const key of [...active].sort()) {
    const access = pods[key];
    if (!access?.allowed) continue;
    visible.push({
      key,
      label: key,
      title: key,
      duration: gpuDuration(
        access.startedAt === undefined ? undefined : sampledAt - access.startedAt
      ),
    });
  }
  if (active.size)
    return visible.length ? visible : [{ key: 'occupied', label: t('Occupied'), duration: '—' }];
  const operator = device.workloads.filter(item => item.namespace === 'gpu-operator');
  if (operator.length && known) {
    const idle = range ? gpuIdleAge(device, range, sampledAt) : undefined;
    return [
      {
        key: 'idle',
        label: t('Idle'),
        idle: true,
        title: operator
          .map(
            item => `${item.namespace}/${item.pod}${item.container ? ` (${item.container})` : ''}`
          )
          .join('\n'),
        duration: (idle?.lowerBound ? '≥' : '') + gpuDuration(idle?.milliseconds),
      },
    ];
  }
  return [{ key: 'unknown', label: t('Assignment unknown'), duration: '—' }];
}

/** 节点名默认居中，中心移出可视区域时才贴住可见边缘。 */
function positionNodeLabels(scroller: HTMLDivElement | null) {
  if (!scroller) return;
  const viewport = scroller.getBoundingClientRect();
  const header = scroller.querySelector('thead th')?.getBoundingClientRect();
  const top = Math.max(viewport.top, header?.bottom ?? viewport.top);
  for (const label of scroller.querySelectorAll<HTMLElement>('[data-gpu-node-label]')) {
    const cell = label.parentElement?.getBoundingClientRect();
    if (!cell) continue;
    const center = (cell.height - label.offsetHeight) / 2;
    const firstVisible = Math.max(cell.top, top) - cell.top;
    const lastVisible = Math.min(cell.bottom, viewport.bottom) - cell.top - label.offsetHeight;
    const offset =
      firstVisible <= lastVisible ? Math.max(firstVisible, Math.min(center, lastVisible)) : center;
    label.style.top = `${offset}px`;
  }
}

/** 渲染原生合并单元格，节点名在长分组滚动时沿边界移动。 */
export function GpuDeviceTable({
  cards,
  data,
  selected,
  onSelect,
  pods,
  history,
  t,
}: {
  cards: PhysicalGpu[];
  data: GpuTelemetry;
  selected?: GpuSelection;
  onSelect: (value: GpuSelection) => void;
  pods: Record<string, GpuPodAccess>;
  history?: GpuRange;
  t: Translate;
}) {
  const headings = [
    'Node',
    'Physical GPU',
    'GPU model',
    'Temperature',
    'Power',
    'GPU utilization',
    'GPU memory utilization',
    'Workload',
    'Elapsed',
  ];
  const sizes = [56, 73, 153, 62, 61, 119, 110, undefined, 85];
  const groupSx = { bgcolor: 'action.hover', verticalAlign: 'middle' };
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = scroller.current;
    if (!container) return;
    positionNodeLabels(container);
    const observer = new ResizeObserver(() => positionNodeLabels(container));
    observer.observe(container);
    return () => observer.disconnect();
  }, [cards]);
  const rows = tableRows(cards);
  if (!rows.length)
    return (
      <Typography sx={{ p: 2 }} color="text.secondary">
        {t('No matching GPU devices')}
      </Typography>
    );
  return (
    <TableContainer
      ref={scroller}
      onScroll={event => positionNodeLabels(event.currentTarget)}
      sx={{ maxHeight: 324, overscrollBehaviorY: 'contain' }}
      tabIndex={0}
    >
      <Table
        stickyHeader
        size="small"
        aria-label={t('GPU devices')}
        sx={{
          minWidth: 1080,
          '& th, & td': { py: 0.65, px: 1, whiteSpace: 'nowrap' },
          '& thead th': { height: 38, boxSizing: 'border-box', fontWeight: 650 },
        }}
      >
        <colgroup>
          {headings.map((label, i) => (
            <col key={label} style={{ width: sizes[i] }} />
          ))}
        </colgroup>
        <TableHead>
          <TableRow>
            {headings.map((label, i) => (
              <TableCell key={label} align={i >= 7 ? 'center' : 'left'}>
                {t(label)}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(({ card, device, nodeSpan, cardSpan, workloadSpan }) => {
            const memory = gpuMemory([device]);
            const entries = workloadSpan
              ? allocation(
                  device,
                  pods,
                  data.sampledAt,
                  history,
                  gpuOccupationKnown(data, card.node),
                  t
                )
              : [];
            const thermal = card.devices.find(
              item => item.metrics.temperature !== undefined || item.metrics.power !== undefined
            )?.metrics;
            return (
              <TableRow
                key={device.id}
                selected={
                  selected?.cardId === card.id &&
                  (!selected.deviceId || selected.deviceId === device.id)
                }
                onClick={event => {
                  const target = event.target;
                  if (!(target instanceof Element) || target.closest('button, a')) return;
                  const cell = target.closest('td, th');
                  if (
                    cell instanceof HTMLTableCellElement &&
                    cell.rowSpan === 1 &&
                    cell.parentElement === event.currentTarget
                  ) {
                    onSelect({
                      cardId: card.id,
                      deviceId: device.instance ? device.id : undefined,
                    });
                  }
                }}
                sx={{
                  '& td, & th': { borderTop: nodeSpan ? 1 : undefined, borderTopColor: 'divider' },
                  '& > :is(td, th):not([rowspan]), & > :is(td, th)[rowspan="1"]': {
                    cursor: 'pointer',
                  },
                }}
              >
                {nodeSpan && (
                  <TableCell
                    component="th"
                    scope="rowgroup"
                    rowSpan={nodeSpan}
                    sx={{
                      ...groupSx,
                      position: 'relative',
                      verticalAlign: 'top',
                      textAlign: 'center',
                    }}
                  >
                    <Box
                      data-gpu-node-label
                      sx={{ position: 'absolute', top: 7, insetInline: 4, fontWeight: 650 }}
                    >
                      {card.node}
                    </Box>
                  </TableCell>
                )}
                {cardSpan && (
                  <>
                    <TableCell rowSpan={cardSpan} sx={groupSx}>
                      <Tooltip title={card.acceleratorId} describeChild>
                        {cardSpan === 1 ? (
                          <Button
                            size="small"
                            sx={{ p: 0, minWidth: 0, textTransform: 'none' }}
                            onClick={() => onSelect({ cardId: card.id })}
                          >
                            GPU {card.index}
                          </Button>
                        ) : (
                          <Typography component="span" tabIndex={0} variant="body2">
                            GPU {card.index}
                          </Typography>
                        )}
                      </Tooltip>
                    </TableCell>
                    <TableCell rowSpan={cardSpan} sx={groupSx}>
                      <Typography variant="body2" noWrap title={card.model}>
                        {card.model}
                      </Typography>
                      {device.instance && (
                        <Typography variant="caption" color="text.secondary">
                          MIG
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell rowSpan={cardSpan} sx={groupSx}>
                      {thermal?.temperature === undefined
                        ? '—'
                        : `${thermal.temperature.toFixed(0)} °C`}
                    </TableCell>
                    <TableCell rowSpan={cardSpan} sx={groupSx}>
                      {thermal?.power === undefined ? '—' : `${thermal.power.toFixed(0)} W`}
                    </TableCell>
                  </>
                )}
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                    {device.instance && (
                      <Button
                        variant="outlined"
                        size="small"
                        sx={{ px: 0.4, py: 0, minWidth: 0, whiteSpace: 'nowrap' }}
                        aria-pressed={selected?.deviceId === device.id}
                        onClick={() => onSelect({ cardId: card.id, deviceId: device.id })}
                      >
                        {gpuInstanceLabel(device.instance)}
                      </Button>
                    )}
                    <Meter value={gpuUtilization(device)} label={t('GPU utilization')} />
                  </Box>
                </TableCell>
                <TableCell>
                  <Meter
                    value={memory ? (100 * memory.used) / memory.total : undefined}
                    memory
                    label={t('GPU memory utilization')}
                  />
                </TableCell>
                {workloadSpan && (
                  <>
                    <TableCell rowSpan={workloadSpan} align="center">
                      <Box sx={{ display: 'grid', justifyItems: 'center', gap: 0.25 }}>
                        {entries.map(entry => (
                          <Tooltip key={entry.key} title={entry.title ?? ''} describeChild>
                            <Chip
                              size="small"
                              label={entry.label}
                              color={entry.idle ? 'success' : 'default'}
                              sx={{ maxWidth: 'none' }}
                            />
                          </Tooltip>
                        ))}
                      </Box>
                    </TableCell>
                    <TableCell rowSpan={workloadSpan} align="center">
                      {entries.map(entry => (
                        <Typography
                          key={entry.key}
                          variant="caption"
                          component="div"
                          sx={{ lineHeight: '26px' }}
                        >
                          {entry.duration}
                        </Typography>
                      ))}
                    </TableCell>
                  </>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
