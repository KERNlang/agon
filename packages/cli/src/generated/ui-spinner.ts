import { Box, Text } from 'ink';

import { engineColor, contentWidth } from '../components.js';

import React, {  } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

export function SpinnerBlock({ message, color }: { message: string; color?: number }) {
  return (
          <Text>
            <Text color={color ? String(color) : 'yellow'}><Spinner type="dots" /></Text>
            <Text> {message}</Text>
          </Text>
  );
}


import React, {  } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

export function TokenGauge({ tokens, maxTokens }: { tokens: number; maxTokens: number }) {
  return (
          const pct = Math.min(100, Math.round((tokens / maxTokens) * 100));
          const barWidth = 12;
          const filled = Math.round((pct / 100) * barWidth);
          const empty = barWidth - filled;
          const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
          const barColor = pct > 80 ? '#ef4444' : pct > 60 ? '#fbbf24' : '#4ade80';
          return (
            <Text>
              <Text color={barColor}>{bar}</Text>
              <Text dimColor>{` ${pct}%`}</Text>
            </Text>
          );
  );
}


import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

export function AgonTip({  }: {  }) {
  const [tip, setTip] = useState<string>(AGON_TIPS[Math.floor(Math.random() * AGON_TIPS.length)]);

  return (
          <Text>
            <Text dimColor>{'  \u2514 Tip: '}</Text>
            <Text dimColor>{tip}</Text>
          </Text>
  );
}


