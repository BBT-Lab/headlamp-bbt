// 文件描述：Headlamp Plus插件源码。
// 项目名称：Headlamp Plus（Headlamp BBT适配）
// 文件名称：types.ts
// 作者：Batuhan CIKRIKCI
// 日期：2026-11-22

/** Shapes shared by the editors, wizards and validators. */

/** Metadata of an object as the editors see it. */
export interface KubeMetadataJson {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  resourceVersion?: string;
  uid?: string;
  generation?: number;
  creationTimestamp?: string;
  deletionTimestamp?: string;
  finalizers?: string[];
  ownerReferences?: Array<{
    apiVersion?: string;
    kind: string;
    name: string;
    uid?: string;
    controller?: boolean;
  }>;
  // Other metadata (finalizers, ownerReferences, …) is carried through unchanged.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** A Kubernetes object as plain JSON, as edited by the forms and the YAML editor. */
export interface KubeJson {
  apiVersion: string;
  kind: string;
  metadata: KubeMetadataJson;
  // The spec shape depends on the kind; typed models live next to each kind.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** A validation problem: an English message with `{{placeholders}}` and its values. */
export interface ValidationError {
  key: string;
  params?: Record<string, unknown>;
}
