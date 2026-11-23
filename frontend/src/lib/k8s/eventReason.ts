/*
 * 文件描述：本地化Kubernetes事件原因，在双语界面保留原始标识。
 * 项目名称：Headlamp BBT
 * 文件名称：eventReason.ts
 * 作者：Codex
 * 日期：2026-11-23
 */

const reasons: Record<string, string> = {
  AddedInterface: '已添加网络接口',
  BackOff: '退避重试',
  ClickHouseWarning: 'ClickHouse警告',
  Completed: '已完成',
  CrashLoopBackOff: '反复崩溃，等待重试',
  Created: '已创建',
  DeadlineExceeded: '达到运行时限',
  ErrImagePull: '镜像拉取失败',
  Evicted: '已驱逐',
  ExecuteAction: '执行操作',
  ExternalProvisioning: '等待外部卷置备',
  Failed: '失败',
  FailedAttachVolume: '存储卷附加失败',
  FailedBinding: '绑定失败',
  FailedCreate: '创建失败',
  FailedDaemonPod: '守护进程Pod失败',
  FailedGetScale: '读取副本数失败',
  FailedMount: '挂载失败',
  FailedScheduling: '调度失败',
  FailedSync: '同步失败',
  ImagePullBackOff: '镜像拉取退避',
  InvalidProviderConfig: '提供程序配置无效',
  Killing: '正在终止',
  NodeNotReady: '节点未就绪',
  NodeReady: '节点已就绪',
  OOMKilled: '内存不足被终止',
  PodGroupPending: 'Pod组等待调度',
  PolicyError: '策略错误',
  Provisioning: '正在置备卷',
  ProvisioningFailed: '卷置备失败',
  ProvisioningSucceeded: '卷置备成功',
  Pulled: '镜像已拉取',
  Pulling: '正在拉取镜像',
  ReconciliationFailed: '调谐失败',
  ReconciliationSucceeded: '调谐成功',
  ResourceUpdated: '资源已更新',
  SawCompletedJob: '检测到已完成的作业',
  ScalingReplicaSet: '调整副本集大小',
  Scheduled: '已调度',
  Started: '已启动',
  SuccessfulCreate: '创建成功',
  SuccessfulDelete: '删除成功',
  SuccessfulMountVolume: '卷挂载成功',
  Unhealthy: '健康检查失败',
  UnexpectedJob: '意外的作业',
  Unschedulable: '暂无法调度',
  UpdateFailed: '更新失败',
};

/**
 * 本地化已知事件原因，保留自定义控制器的原值。
 *
 * :param reason: Kubernetes事件的reason字段。
 * :param language: 当前界面语言。
 * :returns: 显示文案。
 */
export function eventReasonLabel(reason: string, language: string): string {
  if (!Object.prototype.hasOwnProperty.call(reasons, reason)) return reason;
  if (language === 'zh-x-bbt') return `${reasons[reason]} (${reason})`;
  return /^zh(?:-Hans|-CN)?$/i.test(language) ? reasons[reason] : reason;
}
