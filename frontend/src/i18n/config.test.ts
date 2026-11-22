// 文件描述：验证默认语言、术语回退和语言切换。
// 项目名称：Headlamp BBT
// 文件名称：config.test.ts
// 作者：Codex
// 日期：2026-11-22

/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { bbtBilingualLocale } from './bbtLocale';
import i18next from './config';

describe('i18n configuration', () => {
  it('starts with the bilingual locale and uses Chinese for ordinary text', async () => {
    await i18next.loadLanguages(bbtBilingualLocale);
    expect(i18next.resolvedLanguage).toBe(bbtBilingualLocale);
    expect(i18next.t('Namespace')).toBe('命名空间 (Namespace)');
    expect(i18next.t('Connect')).toBe('连接');
  });

  it('keeps the Chinese and English language choices distinct', async () => {
    await i18next.changeLanguage('zh');
    expect(i18next.t('Namespace')).toBe('命名空间');
    expect(i18next.t('Connect')).toBe('连接');

    await i18next.changeLanguage('en');
    expect(i18next.t('Namespace')).toBe('Namespace');
    expect(i18next.t('Connect')).toBe('Connect');
  });

  // "pt" is the region-less preference stored by earlier versions.
  it.each([
    ['pt-PT', 'pt-PT'],
    ['pt-BR', 'pt-BR'],
    ['pt', 'pt-PT'],
  ])('loads translations for %s', async (locale, expectedResolved) => {
    await i18next.changeLanguage(locale);

    expect(i18next.t('Close')).toBe('Fechar');
    // Components localize Material UI, tables and plugins off the resolved variant.
    expect(i18next.resolvedLanguage).toBe(expectedResolved);
  });
});
