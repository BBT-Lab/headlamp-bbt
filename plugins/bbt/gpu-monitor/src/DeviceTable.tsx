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
  ButtonBase,
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
import { darken, lighten, type Theme } from '@mui/material/styles';
import { Fragment, useLayoutEffect, useRef } from 'react';
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
import { quotaRatio, vgpuMemory, vgpuResources, type VgpuAllocation } from './VgpuTelemetry';

export type Translate = (key: string) => string;
export interface GpuSelection {
  cardId: string;
  deviceId?: string;
  workloadName?: string;
}

interface Row {
  card: PhysicalGpu;
  device: Gpu;
  nodeSpan?: number;
  cardSpan?: number;
  workloadSpan?: number;
  shared?: VgpuAllocation;
  showSharedRow?: boolean;
}

/** 将连续设备行中的相同工作负载同时合并到两列。 */
function tableRows(
  cards: readonly PhysicalGpu[],
  sharedCards: ReadonlyMap<string, VgpuAllocation>
): Row[] {
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
        shared: sharedCards.get(card.id),
        showSharedRow:
          index === card.devices.length - 1 && Boolean(sharedCards.get(card.id)?.count),
        cardSpan: index === 0 ? card.devices.length : undefined,
      }))
    );
    if (!rows.length) return rows;
    rows[0].nodeSpan = rows.length + rows.filter(row => row.showSharedRow).length;
    const workloadKeys = rows.map(row =>
      row.shared
        ? ''
        : [...new Set(gpuWorkloads(row.device).map(item => `${item.namespace}/${item.pod}`))]
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

/** 在同一组中显示物理卡的三项调度配额。 */
export function VgpuQuotaSummary({ shared, t }: { shared: VgpuAllocation; t: Translate }) {
  return (
    <Box
      role="group"
      aria-label={t('vGPU allocated over allocatable')}
      data-vgpu-quota
      sx={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        columnGap: 1.2,
        rowGap: 0.25,
      }}
    >
      {vgpuResources(shared).map(({ label, value, ratio }) => (
        <Typography
          key={label}
          variant="caption"
          color="text.secondary"
          sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
        >
          {t(label)}{' '}
          <Box component="strong" sx={{ color: 'text.primary' }}>
            {value}
          </Box>
          {ratio && ` (${ratio})`}
        </Typography>
      ))}
    </Box>
  );
}

/** 在一张物理卡下展示当前Pod的HAMi实测值。 */
export function VgpuUsageLine({
  workload,
  t,
}: {
  workload: VgpuAllocation['workloads'][number];
  t: Translate;
}) {
  const devices = [...workload.usage.values()];
  const sumBytes = (key: 'usedBytes' | 'limitBytes') =>
    devices.length && devices.every(item => item[key] !== undefined)
      ? devices.reduce((sum, item) => sum + (item[key] ?? 0), 0)
      : undefined;
  const used = sumBytes('usedBytes');
  const limit = sumBytes('limitBytes');
  const memoryRatio = quotaRatio(used, limit);
  const utilization =
    devices.length > 1
      ? devices.map(item => `${item.container} ${gpuPercent(item.utilization)}`).join(' / ')
      : gpuPercent(devices[0]?.utilization);

  return (
    <Typography variant="caption" color="text.secondary" data-hami-workload-usage>
      {t('GPU utilization')} <strong>{utilization}</strong>
      {' · '}
      {t('GPU memory usage')} <strong>{vgpuMemory(used)}</strong>
      {limit !== undefined && ` / ${vgpuMemory(limit)}`}
      {memoryRatio && ` (${memoryRatio})`}
      {' · '}
      {workload.cores
        ? `${t('GPU cores reserved')} ${workload.cores}%`
        : t('No GPU cores reserved')}
    </Typography>
  );
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
export function allocation(
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

/** 在八条设备记录后限制滚动区域，把第八条记录的vGPU详情保留在可视区。 */
function sizeDeviceViewport(container: HTMLDivElement, table: HTMLTableElement) {
  const ninth = table.querySelectorAll<HTMLTableRowElement>('[data-gpu-device-row]')[8];
  if (!ninth) {
    container.style.removeProperty('--gpu-device-list-height');
    return;
  }
  const rowHeight = ninth.getBoundingClientRect().top - table.getBoundingClientRect().top;
  const scrollbarHeight = container.offsetHeight - container.clientHeight;
  container.style.setProperty(
    '--gpu-device-list-height',
    `${Math.ceil(rowHeight + scrollbarHeight)}px`
  );
}

/** 所有选中单元格使用同一个背景色，合并单元格随其覆盖的选中行高亮。 */
function selectionBackground(theme: Theme) {
  const paper = theme.palette.background.paper;
  return theme.palette.mode === 'dark' ? lighten(paper, 0.16) : darken(paper, 0.09);
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
  showNodes,
  sharedCards,
  history,
  t,
}: {
  cards: PhysicalGpu[];
  data: GpuTelemetry;
  selected?: GpuSelection;
  onSelect: (value: GpuSelection) => void;
  pods: Record<string, GpuPodAccess>;
  showNodes: boolean;
  sharedCards: ReadonlyMap<string, VgpuAllocation>;
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
  const firstColumn = showNodes ? 0 : 1;
  const visibleHeadings = headings.slice(firstColumn);
  const groupSx = { bgcolor: 'action.hover', verticalAlign: 'middle' };
  const scroller = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const rows = tableRows(cards, sharedCards);
  const selectedNode = cards.find(item => item.id === selected?.cardId)?.node;
  const selectedRows = rows.map(
    ({ card, device }) =>
      selected?.cardId === card.id && (!selected.deviceId || selected.deviceId === device.id)
  );
  useLayoutEffect(() => {
    const container = scroller.current;
    const table = tableRef.current;
    if (!container || !table) return;
    const measure = () => {
      sizeDeviceViewport(container, table);
      positionNodeLabels(container);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(table);
    return () => observer.disconnect();
  }, [cards, sharedCards, showNodes]);
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
      sx={{
        maxHeight: 'var(--gpu-device-list-height, none)',
        overflowY: 'auto',
        overscrollBehaviorY: 'auto',
      }}
      tabIndex={0}
    >
      <Table
        ref={tableRef}
        stickyHeader
        size="small"
        aria-label={t('GPU devices')}
        sx={{
          minWidth: showNodes ? 1080 : 1024,
          '& th, & td': { py: 0.65, px: 1, whiteSpace: 'nowrap' },
          '& thead th': {
            height: 38,
            boxSizing: 'border-box',
            fontWeight: 650,
          },
        }}
      >
        <colgroup>
          {visibleHeadings.map((label, i) => (
            <col key={label} style={{ width: sizes[i + firstColumn] }} />
          ))}
        </colgroup>
        <TableHead>
          <TableRow>
            {visibleHeadings.map((label, i) => (
              <TableCell key={label} align={i + firstColumn >= 7 ? 'center' : 'left'}>
                {t(label)}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(
            ({ card, device, nodeSpan, cardSpan, workloadSpan, shared, showSharedRow }, index) => {
              const memory = gpuMemory([device]);
              const cardSelected = selected?.cardId === card.id;
              const cardSx = {
                ...groupSx,
                bgcolor: cardSelected ? selectionBackground : groupSx.bgcolor,
              };
              const workloadSelected =
                workloadSpan && selectedRows.slice(index, index + workloadSpan).some(Boolean);
              const workloadColor = workloadSelected ? selectionBackground : undefined;
              const entries = workloadSpan
                ? allocation(
                    device,
                    pods,
                    data.sampledAt,
                    history,
                    shared?.count === 0 || gpuOccupationKnown(data, card.node),
                    t
                  )
                : [];
              const thermal = card.devices.find(
                item => item.metrics.temperature !== undefined || item.metrics.power !== undefined
              )?.metrics;
              return (
                <Fragment key={device.id}>
                  <TableRow
                    data-gpu-device-row
                    aria-selected={selectedRows[index]}
                    selected={selectedRows[index]}
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
                      '&.Mui-selected': { bgcolor: selectionBackground },
                      '& td, & th': {
                        borderTop: nodeSpan ? 1 : undefined,
                        borderTopColor: 'divider',
                      },
                      '& > :is(td, th):not([rowspan]), & > :is(td, th)[rowspan="1"]': {
                        cursor: 'pointer',
                      },
                    }}
                  >
                    {showNodes && nodeSpan && (
                      <TableCell
                        component="th"
                        scope="rowgroup"
                        rowSpan={nodeSpan}
                        sx={{
                          ...groupSx,
                          bgcolor:
                            selectedNode === card.node ? selectionBackground : groupSx.bgcolor,
                          position: 'relative',
                          verticalAlign: 'top',
                          textAlign: 'center',
                        }}
                      >
                        <Box
                          data-gpu-node-label
                          sx={{
                            position: 'absolute',
                            top: 7,
                            insetInline: 4,
                            fontWeight: 650,
                          }}
                        >
                          {card.node}
                        </Box>
                      </TableCell>
                    )}
                    {cardSpan && (
                      <>
                        <TableCell rowSpan={cardSpan} sx={cardSx}>
                          <Tooltip title={card.acceleratorId} describeChild>
                            {cardSpan === 1 ? (
                              <Button
                                size="small"
                                sx={{
                                  p: 0,
                                  minWidth: 0,
                                  textTransform: 'none',
                                }}
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
                        <TableCell rowSpan={cardSpan} sx={cardSx}>
                          <Typography variant="body2" noWrap title={card.model}>
                            {card.model}
                          </Typography>
                          {device.instance && (
                            <Typography variant="caption" color="text.secondary">
                              MIG
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell rowSpan={cardSpan} sx={cardSx}>
                          {thermal?.temperature === undefined
                            ? '—'
                            : `${thermal.temperature.toFixed(0)} °C`}
                        </TableCell>
                        <TableCell rowSpan={cardSpan} sx={cardSx}>
                          {thermal?.power === undefined ? '—' : `${thermal.power.toFixed(0)} W`}
                        </TableCell>
                      </>
                    )}
                    <TableCell>
                      <Box
                        sx={{
                          display: 'flex',
                          gap: 0.75,
                          alignItems: 'center',
                        }}
                      >
                        {device.instance && (
                          <Button
                            variant="outlined"
                            size="small"
                            sx={{
                              px: 0.4,
                              py: 0,
                              minWidth: 0,
                              whiteSpace: 'nowrap',
                            }}
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
                        <TableCell
                          rowSpan={workloadSpan}
                          align="center"
                          sx={{ bgcolor: workloadColor }}
                        >
                          <Box
                            sx={{
                              display: 'flex',
                              justifyContent: 'center',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: 0.75,
                            }}
                          >
                            {!shared?.count &&
                              entries.map(entry => (
                                <Tooltip key={entry.key} title={entry.title ?? ''} describeChild>
                                  <Chip
                                    size="small"
                                    label={entry.label}
                                    color={entry.idle ? 'success' : 'default'}
                                    sx={{ maxWidth: 'none' }}
                                  />
                                </Tooltip>
                              ))}
                            {shared && <VgpuQuotaSummary shared={shared} t={t} />}
                          </Box>
                        </TableCell>
                        <TableCell
                          rowSpan={workloadSpan}
                          align="center"
                          sx={{ bgcolor: workloadColor }}
                        >
                          {!shared?.count &&
                            entries.map(entry => (
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
                  {showSharedRow && shared && (
                    <TableRow data-gpu-vgpu-row>
                      <TableCell
                        colSpan={visibleHeadings.length - (showNodes ? 1 : 0)}
                        sx={{
                          bgcolor: cardSelected ? selectionBackground : 'action.hover',
                        }}
                      >
                        <Box
                          sx={{
                            ml: 2,
                            pl: 1.5,
                            borderLeft: 2,
                            borderColor: 'primary.main',
                          }}
                        >
                          {shared.workloads.length ? (
                            shared.workloads.map(workload => (
                              <ButtonBase
                                key={workload.name}
                                aria-label={workload.name}
                                aria-pressed={
                                  cardSelected && selected?.workloadName === workload.name
                                }
                                onClick={() =>
                                  onSelect({ cardId: card.id, workloadName: workload.name })
                                }
                                sx={{
                                  display: 'grid',
                                  gridTemplateColumns: 'minmax(0, 1fr) auto 67px',
                                  width: '100%',
                                  alignItems: 'center',
                                  textAlign: 'left',
                                  gap: 2,
                                  my: 0.25,
                                  px: 0.75,
                                  borderRadius: 1,
                                  '&[aria-pressed="true"]': { bgcolor: 'action.selected' },
                                  '&:hover, &.Mui-focusVisible': { bgcolor: 'action.focus' },
                                }}
                              >
                                <Typography
                                  component="span"
                                  variant="body2"
                                  title={workload.name}
                                  noWrap
                                >
                                  {workload.name}
                                </Typography>
                                <VgpuUsageLine workload={workload} t={t} />
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ textAlign: 'center', minWidth: 67 }}
                                >
                                  {gpuDuration(
                                    Number.isFinite(workload.startedAt)
                                      ? data.sampledAt - workload.startedAt
                                      : undefined
                                  )}
                                </Typography>
                              </ButtonBase>
                            ))
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              {t('Assignment unknown')}
                            </Typography>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            }
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
