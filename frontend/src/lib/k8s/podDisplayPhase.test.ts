/*
 * 文件描述：验证adviser命名空间的容器组到期完成规则。
 * 项目名称：Headlamp BBT
 * 文件名称：podDisplayPhase.test.ts
 * 作者：Codex
 * 日期：2026-11-22
 */

import { podDisplayPhase } from './podDisplayPhase';

describe('容器组展示状态', () => {
  it.each([
    ['adviser-jyl-qwenq35', 'Failed', 'DeadlineExceeded', 'Succeeded'],
    ['adviser-jyl-qwenq35', 'Failed', 'OOMKilled', 'Failed'],
    ['adviser-jyl-qwenq35', 'Running', 'DeadlineExceeded', 'Running'],
    ['default', 'Failed', 'DeadlineExceeded', 'Failed'],
  ])('%s %s / %s 显示为 %s', (namespace, phase, reason, expected) => {
    const pod = { metadata: { namespace }, status: { phase, reason } };
    expect(podDisplayPhase(pod)).toBe(expected);
    expect(pod.status.phase).toBe(phase);
  });
});
