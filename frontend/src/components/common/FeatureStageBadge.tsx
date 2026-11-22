/*
 * 文件描述：用角标表示测试版和实验功能。
 * 项目名称：Headlamp BBT
 * 文件名称：FeatureStageBadge.tsx
 * 作者：Codex
 * 日期：2026-11-22
 */

import Box from '@mui/material/Box';
import { alpha } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import { useTranslation } from 'react-i18next';

export type FeatureStage = 'alpha' | 'beta';

/**
 * 显示功能阶段，鼠标提示和辅助技术可读取完整含义。
 *
 * :param stage: 功能阶段。
 * :returns: 单行名称旁的图标。
 */
export default function FeatureStageBadge({ stage }: { stage: FeatureStage }) {
  const { t } = useTranslation();
  const description = stage === 'beta' ? t('Beta feature') : t('Experimental feature');
  return (
    <Tooltip title={description}>
      <Box
        component="sup"
        role="img"
        aria-label={description}
        sx={theme => {
          const palette = stage === 'beta' ? theme.palette.info : theme.palette.warning;
          const color = theme.palette.mode === 'dark' ? palette.light : palette.dark;
          return {
            display: 'inline-grid',
            placeItems: 'center',
            ml: 0.5,
            width: 15,
            height: 14,
            boxSizing: 'border-box',
            border: '1px solid',
            borderColor: alpha(color, 0.4),
            borderRadius: '5px',
            bgcolor: alpha(color, 0.1),
            color,
            fontSize: '0.65rem',
            fontWeight: 700,
            lineHeight: 1,
            verticalAlign: 'super',
          };
        }}
      >
        {stage === 'beta' ? 'β' : 'α'}
      </Box>
    </Tooltip>
  );
}
