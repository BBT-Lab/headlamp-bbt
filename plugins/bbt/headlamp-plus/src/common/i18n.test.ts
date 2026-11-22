// 文件描述：Headlamp Plus插件源码。
// 项目名称：Headlamp Plus（Headlamp BBT适配）
// 文件名称：i18n.test.ts
// 作者：Batuhan CIKRIKCI
// 日期：2026-11-22

import { describe, expect, it } from 'vitest';
import { interpolate, t, useText } from './i18n';

describe('interpolate', () => {
  it('fills placeholders and keeps unknown ones', () => {
    expect(interpolate('Accepted {{accepted}}/{{ total }}', { accepted: 1, total: 2 })).toBe(
      'Accepted 1/2'
    );
    expect(interpolate('Hi {{name}}', {})).toBe('Hi {{name}}');
    expect(interpolate('Plain')).toBe('Plain');
  });
});

describe('t and useText', () => {
  it('return English text with placeholders filled in', () => {
    expect(t('Must be at most {{max}}', { max: 10 })).toBe('Must be at most 10');
    expect(useText().t('{{count}} items', { count: 3 })).toBe('3 items');
  });
});
