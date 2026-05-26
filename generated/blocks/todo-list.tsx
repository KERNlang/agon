// @kern-source: todo-list:8
import React from 'react';

// @kern-source: todo-list:9
import { Box, Text } from 'ink';

// @kern-source: todo-list:10
import type { Todo } from '../signals/todos.js';

// @kern-source: todo-list:12
export const TODO_STATE_ICONS: Record<string,{icon:string,color:string}> = ({ pending: { icon: '○', color: '#64748b' }, running: { icon: '●', color: '#fbbf24' }, done: { icon: '✓', color: '#22c55e' }, failed: { icon: '✗', color: '#ef4444' }, cancelled: { icon: '—', color: '#64748b' } });

// @kern-source: todo-list:14

export function TodoList({ todos }: { todos: Todo[] }) {
        if (!todos || todos.length === 0) return null;
        const done = todos.filter((t) => t.state === 'done').length;
        const running = todos.filter((t) => t.state === 'running');
        return (
          <Box flexDirection="column" paddingLeft={2} marginTop={1}>
            <Box>
              <Text dimColor>{'Todos '}</Text>
              <Text dimColor>{String(done)}{'/'}{String(todos.length)}</Text>
              {running.length > 0 && <Text color="#fbbf24">{' ●'}</Text>}
            </Box>
            {todos.map((t) => {
              const cfg = TODO_STATE_ICONS[t.state] ?? TODO_STATE_ICONS.pending;
              return (
                <Box key={t.id}>
                  <Text color={cfg.color}>{cfg.icon}{' '}</Text>
                  <Text color={t.state === 'done' ? '#64748b' : t.state === 'running' ? 'white' : undefined} dimColor={t.state !== 'done' && t.state !== 'running'}>{t.text}</Text>
                  {t.note ? (<Text dimColor>{' — '}{t.note}</Text>) : null}
                </Box>
              );
            })}
          </Box>
        );
}


