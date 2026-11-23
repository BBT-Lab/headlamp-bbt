/*
 * 文件描述：注册GPU监控页面和节点、Pod详情入口。
 * 项目名称：Headlamp BBT
 * 文件名称：index.tsx
 * 作者：gen3111620、Codex
 * 日期：2026-11-23
 */

import {
  registerDetailsViewSection,
  registerRoute,
  registerSidebarEntry,
} from '@kinvolk/headlamp-plugin/lib';
import { GpuMonitor } from './Monitor';

registerSidebarEntry({
  parent: null,
  name: 'gpu-monitor',
  label: 'GPU Monitor',
  url: '/gpu-monitor',
  icon: 'mdi:expansion-card',
});
registerRoute({
  path: '/gpu-monitor',
  sidebar: 'gpu-monitor',
  name: 'gpu-monitor',
  exact: true,
  component: () => <GpuMonitor />,
});
registerDetailsViewSection(({ resource }) => {
  if (resource?.kind === 'Node') {
    return <GpuMonitor cluster={resource.cluster} scope={{ node: resource.getName() }} />;
  }
  if (resource?.kind === 'Pod') {
    const containers = resource.jsonData.spec?.containers ?? [];
    const usesGpu = containers.some(
      (container: {
        resources?: { requests?: Record<string, unknown>; limits?: Record<string, unknown> };
      }) =>
        [
          ...Object.keys(container.resources?.requests ?? {}),
          ...Object.keys(container.resources?.limits ?? {}),
        ].some(key => /^nvidia\.com\/(gpu|mig-)|(?:vgpu|mirage\.com\/gpu)/.test(key))
    );
    if (usesGpu)
      return (
        <GpuMonitor
          cluster={resource.cluster}
          scope={{
            namespace: resource.getNamespace(),
            pod: resource.getName(),
          }}
        />
      );
  }
  return null;
});
