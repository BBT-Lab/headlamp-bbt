/*
 * 文件描述：定义BBT作业到期后在Headlamp中的展示状态。
 * 项目名称：Headlamp BBT
 * 文件名称：podDisplayPhase.ts
 * 作者：Codex
 * 日期：2026-11-22
 */

interface PodStatusSource {
  metadata?: { namespace?: string };
  status?: { phase?: string; reason?: string };
}

/**
 * 判断adviser命名空间中的容器组是否触发到期完成规则。
 *
 * :param pod: 容器组的原始元数据和状态。
 * :returns: 容器组是否应按完成展示。
 */
export function isDeadlineCompletion(pod: PodStatusSource): boolean {
  return (
    pod.metadata?.namespace?.startsWith('adviser-') === true &&
    pod.status?.phase === 'Failed' &&
    pod.status.reason === 'DeadlineExceeded'
  );
}

/**
 * 返回用于状态栏和计数的阶段，不修改Kubernetes对象。
 *
 * :param pod: 容器组的原始元数据和状态。
 * :returns: 展示阶段。
 */
export function podDisplayPhase(pod: PodStatusSource): string | undefined {
  return isDeadlineCompletion(pod) ? 'Succeeded' : pod.status?.phase;
}
