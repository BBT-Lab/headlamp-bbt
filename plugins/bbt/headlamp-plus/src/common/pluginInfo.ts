// 文件描述：Headlamp Plus插件源码。
// 项目名称：Headlamp Plus（Headlamp BBT适配）
// 文件名称：pluginInfo.ts
// 作者：Batuhan CIKRIKCI
// 日期：2026-11-22

/**
 * What the shared components need to know about the plugin they are part of. Every plugin
 * describes itself once, in `src/plugin.ts`.
 */
export interface PluginInfo {
  /** Package name (`package.json` name); also the prefix of console messages. */
  name: string;
  /** Display name of the plugin, e.g. the sidebar root and the error page title. */
  title: string;
  /** The product the plugin manages, e.g. "Cilium" (used in "not installed" states). */
  product: string;
  /** Upstream documentation, linked from "not installed" states. */
  docsUrl?: string;
  /** Shown when none of the product's APIs are served: why, and how to install it. */
  installHint?: string;
  /** Shown when one kind of the product is not served while others are. */
  kindHint?: string;
  /** Versions the plugin was built for, shown next to unsupported API versions. */
  testedWith?: string;
}
