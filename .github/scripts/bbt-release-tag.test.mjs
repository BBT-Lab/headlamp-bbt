/*
 * 文件描述：测试BBT版本递增与香港时区格式。
 * 项目名称：Headlamp BBT
 * 文件名称：bbt-release-tag.test.mjs
 * 作者：Codex
 * 日期：2026-11-23
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { nextReleaseTag } from './bbt-release-tag.mjs';

const now = new Date('2026-11-22T16:01:00Z');

test('新上游版本从1开始，日期按香港时间计算', () => {
  assert.equal(nextReleaseTag('0.46.0', ['v0.45.0.bbt.99-2611222359'], now),
    'v0.46.0.bbt.1-2611230001');
});

test('从现有最大BBT序号递增，并忽略旧格式与其他版本', () => {
  assert.equal(nextReleaseTag('0.46.0', [
    'v0.46.0-bbt-2611222353', 'v0.46.0.bbt.2-2611222354',
    'v0.46.0.bbt.10-2611222356', 'v0.46.0.bbt.9-2611222358',
    'v0.47.0.bbt.13-2611222359',
  ], now), 'v0.46.0.bbt.11-2611230001');
});
