/*
 * Copyright 2026 The Kubernetes Authors
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

/*
 * 文件描述：通过当前用户的Kubernetes发现接口决定随附插件菜单是否可用。
 * 项目名称：Headlamp BBT
 * 文件名称：useBundledPluginResources.ts
 * 作者：Codex
 * 日期：2026-11-23
 */

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ApiError } from '../../lib/k8s/api/v2/ApiError';
import { clusterFetch } from '../../lib/k8s/api/v2/fetch';

const pluginResources: Record<string, Record<string, string>> = {
  volcano: {
    jobs: 'batch.volcano.sh/v1alpha1/jobs',
    queues: 'scheduling.volcano.sh/v1beta1/queues',
    podgroups: 'scheduling.volcano.sh/v1beta1/podgroups',
  },
  kyverno: {
    policyreports: 'wgpolicyk8s.io/v1alpha2/policyreports',
    clusterpolicyreports: 'wgpolicyk8s.io/v1alpha2/clusterpolicyreports',
    clusterpolicies: 'kyverno.io/v1/clusterpolicies',
    policies: 'kyverno.io/v1/policies',
    cleanuppolicies: 'kyverno.io/v2/cleanuppolicies',
    clustercleanuppolicies: 'kyverno.io/v2/clustercleanuppolicies',
    exceptions: 'kyverno.io/v2/policyexceptions',
    admissionreports: 'kyverno.io/v2/admissionreports',
    clusteradmissionreports: 'kyverno.io/v2/clusteradmissionreports',
    backgroundscanreports: 'kyverno.io/v2/backgroundscanreports',
    clusterbackgroundscanreports: 'kyverno.io/v2/clusterbackgroundscanreports',
    ephemeralreports: 'reports.kyverno.io/v1/ephemeralreports',
    clusterephemeralreports: 'reports.kyverno.io/v1/clusterephemeralreports',
    validatingpolicies: 'policies.kyverno.io/v1/validatingpolicies',
    mutatingpolicies: 'policies.kyverno.io/v1/mutatingpolicies',
    generatingpolicies: 'policies.kyverno.io/v1/generatingpolicies',
    deletingpolicies: 'policies.kyverno.io/v1/deletingpolicies',
    imagevalidatingpolicies: 'policies.kyverno.io/v1/imagevalidatingpolicies',
  },
  'cert-manager': {
    certificates: 'cert-manager.io/v1/certificates',
    certificaterequests: 'cert-manager.io/v1/certificaterequests',
    issuers: 'cert-manager.io/v1/issuers',
    clusterissuers: 'cert-manager.io/v1/clusterissuers',
    orders: 'acme.cert-manager.io/v1/orders',
    challenges: 'acme.cert-manager.io/v1/challenges',
  },
  argocd: {
    applications: 'argoproj.io/v1alpha1/applications',
    projects: 'argoproj.io/v1alpha1/appprojects',
    applicationsets: 'argoproj.io/v1alpha1/applicationsets',
  },
  kubevirt: {
    overview: 'kubevirt.io/v1/virtualmachines',
    virtualmachines: 'kubevirt.io/v1/virtualmachines',
    virtualmachineinstances: 'kubevirt.io/v1/virtualmachineinstances',
    migrations: 'kubevirt.io/v1/virtualmachineinstancemigrations',
    instancetypes: 'instancetype.kubevirt.io/v1beta1/virtualmachineinstancetypes',
    preferences: 'instancetype.kubevirt.io/v1beta1/virtualmachinepreferences',
    templates: 'template.kubevirt.io/v1alpha1/virtualmachinetemplates',
    datasources: 'cdi.kubevirt.io/v1beta1/datasources',
    datavolumes: 'cdi.kubevirt.io/v1beta1/datavolumes',
    networks: 'k8s.cni.cncf.io/v1/network-attachment-definitions',
    snapshots: 'snapshot.kubevirt.io/v1beta1/virtualmachinesnapshots',
    restores: 'snapshot.kubevirt.io/v1beta1/virtualmachinerestores',
    clones: 'clone.kubevirt.io/v1beta1/virtualmachineclones',
    exports: 'export.kubevirt.io/v1beta1/virtualmachineexports',
  },
};

interface DiscoveryDocument {
  resources: { name: string; verbs: string[] }[];
}

/**
 * 获取插件入口依赖的资源。路径由插件注册，与界面语言无关。
 *
 * :param url: 插件菜单路径。
 * :returns: 对应的API资源路径。
 */
export function bundledPluginResource(url?: string): string | undefined {
  const [, plugin, section] = url?.split('/') ?? [];
  const resources = pluginResources[plugin?.toLowerCase()];
  return resources && (resources[section?.toLowerCase()] ?? Object.values(resources)[0]);
}

/**
 * 读取当前集群提供的资源，供插件侧边栏使用。
 *
 * :param clusters: 当前选中的集群。
 * :param entries: 已载入插件注册的菜单项。
 * :returns: 已发现的API资源路径。
 */
export function useBundledPluginResources(
  clusters: string[],
  entries: Record<string, { url?: string }>
) {
  const versions = [
    ...new Set(
      Object.values(entries).flatMap(entry => {
        const api = bundledPluginResource(entry.url);
        return api ? [api.slice(0, api.lastIndexOf('/'))] : [];
      })
    ),
  ].sort();

  const available = useQueries({
    queries: clusters.flatMap(cluster =>
      versions.map(version => ({
        queryKey: ['bundledPluginResources', cluster, version],
        refetchInterval: 30_000,
        staleTime: 30_000,
        retry: false,
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
          try {
            const response = await clusterFetch('/apis/' + version, { cluster, signal });
            const discovery: DiscoveryDocument = await response.json();
            return discovery.resources
              .filter(resource => resource.verbs.includes('list'))
              .map(resource => version + '/' + resource.name);
          } catch (error) {
            if (error instanceof ApiError && [401, 403, 404].includes(error.status ?? 0)) {
              return [];
            }
            throw error;
          }
        },
      }))
    ),
    combine: results => results.flatMap(result => result.data ?? []),
  });
  return useMemo(() => new Set(available), [available]);
}
