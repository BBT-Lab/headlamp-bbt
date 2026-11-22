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

// 文件描述：在集群设置中按显示名称选择集群。
// 项目名称：Headlamp BBT
// 文件名称：ClusterSelector.tsx
// 作者：Codex
// 日期：2026-11-23

import { FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useHistory } from 'react-router-dom';
import type { Cluster } from '../../../lib/k8s/cluster';
import { clusterDisplayName } from '../../../lib/k8s/clusterPresentation';

export interface ClusterSelectorProps {
  currentCluster?: string;
  clusters: string[];
  clusterConfig?: Record<string, Cluster> | null;
}

const ClusterSelector: React.FC<ClusterSelectorProps> = ({
  currentCluster = '',
  clusters,
  clusterConfig,
}) => {
  const history = useHistory();
  const { t } = useTranslation('glossary');

  return (
    <FormControl variant="outlined" margin="normal" size="small" sx={{ minWidth: 250 }}>
      <InputLabel id="settings--cluster-selector">{t('glossary|Cluster')}</InputLabel>
      <Select
        labelId="settings--cluster-selector"
        value={currentCluster}
        onChange={event => {
          history.replace(`/settings/cluster?c=${event.target.value}`);
        }}
        label={t('glossary|Cluster')}
        autoWidth
        aria-label={t('glossary|Cluster selector')}
      >
        {clusters.map(clusterName => (
          <MenuItem key={clusterName} value={clusterName}>
            {clusterDisplayName(clusterConfig?.[clusterName], clusterName)}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};

export default ClusterSelector;
