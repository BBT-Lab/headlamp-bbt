// 文件描述：Headlamp Plus插件源码。
// 项目名称：Headlamp Plus（Headlamp BBT适配）
// 文件名称：validation.ts
// 作者：Batuhan CIKRIKCI
// 日期：2026-11-22

/**
 * Validation used by the shared editors and wizards. Each plugin registers its own validator for
 * the kinds it edits once, from `index.tsx` (`registerResourceValidator`); until then nothing is
 * reported and the API server remains the only check.
 */
import { useText } from '../i18n';
import { KubeJson, ValidationError } from './types';

type Validator = (value: KubeJson) => ValidationError[];

let validator: Validator = () => [];

/** Sets the validator of the plugin. */
export function registerResourceValidator(fn: Validator) {
  validator = fn;
}

/** Validation errors of one object, from the plugin's validator. */
export function validateResource(value: KubeJson): ValidationError[] {
  return validator(value);
}

/** Validation errors of several objects, each prefixed with the kind it belongs to. */
export function validateAll(resources: KubeJson[]): ValidationError[] {
  return resources.flatMap(resource =>
    validateResource(resource).map(error => ({
      key: `{{__resource}}: ${error.key}`,
      params: { ...(error.params || {}), __resource: resource.kind },
    }))
  );
}

/** Returns a function that turns a validation error into English text. */
export function useValidationMessage() {
  const { t } = useText();
  return (e: ValidationError) => t(e.key, e.params);
}
