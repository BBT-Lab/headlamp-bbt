// 文件描述：Headlamp Plus插件源码。
// 项目名称：Headlamp Plus（Headlamp BBT适配）
// 文件名称：plugin.ts
// 作者：Batuhan CIKRIKCI
// 日期：2026-11-22

import type { PluginInfo } from './common/pluginInfo';
import { PLUGIN_NAME, PRODUCT_NAME } from './config';

/** Identity of this plugin, used by the shared components in `src/common`. */
export const PLUGIN: PluginInfo = {
  name: PLUGIN_NAME,
  title: PRODUCT_NAME,
  product: 'Headlamp',
};
