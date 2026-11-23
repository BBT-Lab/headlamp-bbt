/*
 * 文件描述：用当前用户权限发现和访问集群中的Prometheus服务。
 * 项目名称：Headlamp BBT
 * 文件名称：prometheus.mjs
 * 作者：Codex
 * 日期：2026-11-23
 */

/**
 * 寻找提供Prometheus查询API的Service。
 *
 * :param request: Headlamp集群代理的请求函数。
 * :param cluster: 发起请求的集群键。
 * :returns: 已通过查询验证的Service，或空的发现结果。
 */
export async function discoverPrometheus(request, cluster) {
  const unavailable = { type: 'none' };
  if (!cluster) return unavailable;

  const options = { cluster, autoLogoutOnAuthError: false, timeout: 5000 };
  const preferred = [
    ['monitoring', 'prometheus-stack-kube-prom-prometheus', 9090],
    ['monitor', 'prometheus-kube-prometheus-prometheus', 9090],
  ];

  /**
   * 通过当前用户的Service代理确认请求可以返回有效的PromQL结果。
   *
   * :param endpoint: Service命名空间、名称与端口。
   * :returns: 可用的代理端点。
   */
  const probe = async ([namespace, name, port]) => {
    const prefix = `/api/v1/namespaces/${namespace}/services/${name}:${port}/proxy`;
    const response = await request(prefix + '/api/v1/query?query=vector%281%29', options);
    if (response?.status !== 'success' || response.data?.resultType !== 'vector') {
      throw new Error('当前Service未提供Prometheus查询接口');
    }
    return { type: 'services', namespace, name, port: String(port) };
  };

  const existing = await Promise.allSettled(preferred.map(probe));
  for (const result of existing) {
    if (result.status === 'fulfilled') return result.value;
  }

  let inventory;
  try {
    inventory = await request('/api/v1/services', options);
  } catch (error) {
    if (error?.status === 403 || error?.status === 401) return unavailable;
    throw error;
  }
  const candidates = inventory.items.flatMap(({ metadata, spec }) => {
    const isPrometheus =
      metadata.labels?.['headlamp-prometheus'] === 'true' ||
      spec.selector?.['app.kubernetes.io/name'] === 'prometheus' ||
      metadata.labels?.['app.kubernetes.io/name'] === 'prometheus';
    if (!isPrometheus) return [];
    return spec.ports
      .filter(port => port.name === 'web' || port.name === 'http-web' || port.port === 9090)
      .map(port => [metadata.namespace, metadata.name, port.port]);
  });
  const discovered = await Promise.allSettled(candidates.slice(0, 10).map(probe));
  for (const result of discovered) {
    if (result.status === 'fulfilled') return result.value;
  }
  return unavailable;
}
