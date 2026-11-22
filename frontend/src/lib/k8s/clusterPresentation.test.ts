/*
 * Copyright 2026 The Kubernetes Authors
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

/*
 * 文件描述：测试授权集群列表的显示名和展开规则。
 * 项目名称：Headlamp BBT
 * 文件名称：clusterPresentation.test.ts
 * 作者：Codex
 * 日期：2026-11-22
 */

import { clusterDisplayName, visibleClusters } from './clusterPresentation';

describe('集群列表呈现', () => {
  const allowed = {
    'prd--c-sz99k': {
      name: 'prd--c-sz99k',
      auth_type: 'oidc',
      meta_data: { rancherDisplayName: 'prd' },
    },
    'harbor--c-vfttv': {
      name: 'harbor--c-vfttv',
      auth_type: 'oidc',
      meta_data: { rancherDisplayName: 'harbor', hideByDefault: true },
    },
  };

  it('保持集群键不变并隐藏标记集群', () => {
    const result = visibleClusters(allowed, false)!;
    expect(Object.keys(result)).toEqual(['prd--c-sz99k']);
    expect(clusterDisplayName(result['prd--c-sz99k'])).toBe('prd');
  });

  it('只展开服务端已经授权的集群', () => {
    expect(visibleClusters(allowed, true)).toBe(allowed);
    expect(visibleClusters({}, true)).toEqual({});
    expect(visibleClusters(null, true)).toBeNull();
  });
});
