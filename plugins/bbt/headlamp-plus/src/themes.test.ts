// 文件描述：Headlamp Plus插件源码。
// 项目名称：Headlamp Plus（Headlamp BBT适配）
// 文件名称：themes.test.ts
// 作者：Batuhan CIKRIKCI
// 日期：2026-11-22

import {
  darkTheme as stockDark,
  lightTheme as stockLight,
} from '@kinvolk/headlamp-plugin/lib/components/App/defaultAppThemes';
import { THEME_DARK, THEME_LIGHT } from './config';
import { darkTheme, lightTheme } from './themes';

describe('themes', () => {
  it('match Headlamp stock themes apart from the name', () => {
    expect(lightTheme).toEqual({ ...stockLight, name: THEME_LIGHT, base: 'light' });
    expect(darkTheme).toEqual({ ...stockDark, name: THEME_DARK });
  });
});
