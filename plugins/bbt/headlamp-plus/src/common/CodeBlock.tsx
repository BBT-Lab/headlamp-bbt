// 文件描述：Headlamp Plus插件源码。
// 项目名称：Headlamp Plus（Headlamp BBT适配）
// 文件名称：CodeBlock.tsx
// 作者：Batuhan CIKRIKCI
// 日期：2026-11-22

import { Box } from '@mui/material';
import React from 'react';

/** Read-only monospace block for YAML, JSON or commands; objects are shown as JSON. */
export function CodeBlock({ value, maxHeight = 400 }: { value: unknown; maxHeight?: number }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 1.5,
        borderRadius: 1,
        bgcolor: 'background.default',
        border: '1px solid',
        borderColor: 'divider',
        overflow: 'auto',
        maxHeight,
        fontSize: '0.8rem',
        fontFamily: 'monospace',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {text}
    </Box>
  );
}
