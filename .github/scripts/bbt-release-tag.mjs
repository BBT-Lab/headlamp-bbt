/*
 * 文件描述：生成Headlamp BBT发布标签。
 * 项目名称：Headlamp BBT
 * 文件名称：bbt-release-tag.mjs
 * 作者：Codex
 * 日期：2026-11-23
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const upstreamVersionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;

/**
 * 按上游版本递增BBT发布序号，并使用香港时间生成标签。
 *
 * :param upstreamVersion: 源码声明的上游版本。
 * :param tags: Git仓库中已存在的标签。
 * :param now: 发版时间。
 * :returns: 新版本标签。
 */
export function nextReleaseTag(upstreamVersion, tags, now = new Date()) {
  if (typeof upstreamVersion !== 'string' || !upstreamVersionPattern.test(upstreamVersion)) {
    throw new Error('上游版本号须采用MAJOR.MINOR.PATCH格式');
  }
  const prefix = `v${upstreamVersion}.bbt.`;
  let last = 0n;
  for (const tag of tags) {
    if (!tag.startsWith(prefix)) continue;
    const match = /^([1-9][0-9]*)-[0-9]{10}$/u.exec(tag.slice(prefix.length));
    if (!match) continue;
    const sequence = BigInt(match[1]);
    if (sequence > last) last = sequence;
  }

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Hong_Kong',
      year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(part => [part.type, part.value])
  );
  return `${prefix}${last + 1n}-${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = JSON.parse(readFileSync(new URL('../../app/package.json', import.meta.url), 'utf8'));
  const tags = execFileSync('git', ['tag', '--list'], { encoding: 'utf8' }).trim().split(/\r?\n/u);
  process.stdout.write(nextReleaseTag(app.version, tags) + '\n');
}
