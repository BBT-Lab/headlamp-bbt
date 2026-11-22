// 文件描述：为 Headlamp Plus 概览提供随 Headlamp 切换的翻译。
// 项目名：Headlamp Plus
// 文件名：i18n.tsx
// 作者：Qintsg
// 日期：2026-11-21

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import React, { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { t as englishText } from './common/i18n';
import { PLUGIN_NAME } from './config';

export type Translate = typeof englishText;

const LocaleContext = createContext({ t: englishText, language: 'en' });

/**
 * 将 Headlamp 的插件翻译与当前语言提供给概览组件。
 *
 * :param children: 使用翻译的概览组件。
 */
export function HeadlampLocale({ children }: React.PropsWithChildren) {
  const { i18n } = useTranslation(PLUGIN_NAME);
  const language = useSyncExternalStore(
    onChange => {
      i18n?.on('languageChanged', onChange);
      return () => i18n?.off('languageChanged', onChange);
    },
    () => i18n?.language ?? 'en'
  );
  const locale = useMemo(() => {
    const translate = i18n?.getFixedT(language);
    const t: Translate = translate
      ? (key, options) =>
          translate(key, {
            ...options,
            defaultValue: key,
            keySeparator: false,
            nsSeparator: false,
          })
      : englishText;
    return { t, language };
  }, [i18n, language]);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/**
 * 读取当前概览的翻译函数和语言。
 *
 * :returns: 当前语言及其翻译函数。
 */
export function usePlusText() {
  return useContext(LocaleContext);
}
