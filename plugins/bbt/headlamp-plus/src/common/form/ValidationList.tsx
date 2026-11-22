// 文件描述：Headlamp Plus插件源码。
// 项目名称：Headlamp Plus（Headlamp BBT适配）
// 文件名称：ValidationList.tsx
// 作者：Batuhan CIKRIKCI
// 日期：2026-11-22

import { Icon } from '@iconify/react';
import { Alert, Box, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../i18n';
import { ValidationError } from './types';
import { useValidationMessage } from './validation';

/** The validation errors that block applying, as a short list. */
export function ValidationList({
  errors,
  title,
  max = 6,
}: {
  errors: ValidationError[];
  title: string;
  max?: number;
}) {
  const { t } = useText();
  const translate = useValidationMessage();
  if (errors.length === 0) return null;
  return (
    <Alert severity="info" icon={<Icon icon="mdi:clipboard-check-outline" />}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {errors.slice(0, max).map(e => (
          <li key={`${e.key}-${JSON.stringify(e.params || {})}`}>{translate(e)}</li>
        ))}
      </Box>
      {errors.length > max && (
        <Typography variant="caption">
          {t('…and {{count}} more', { count: errors.length - max })}
        </Typography>
      )}
    </Alert>
  );
}
