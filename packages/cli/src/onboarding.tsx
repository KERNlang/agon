import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import {
  EngineRegistry,
  ensureAgonHome,
  configSet,
} from '@agon/core';
import { resolveBuiltinEnginesDir } from './lib/engines-dir.js';
import { createCliAdapter } from '@agon/adapter-cli';
import type { EngineAdapter } from '@agon/core';
import { ENGINE_COLORS } from './output.js';
import { icons } from './icons.js';

interface EngineInfo {
  id: string;
  isAvail: boolean;
  version: string;
  displayName: string;
}

function OnboardingApp() {
  const { exit } = useApp();
  const [step, setStep] = useState(0);
  const [scanning, setScanning] = useState(true);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [selectedEngines, setSelectedEngines] = useState<string[]>([]);
  const [defaultEngine, setDefaultEngine] = useState<string>('');
  const [cursorIndex, setCursorIndex] = useState(0);

  // Scan engines on mount
  useEffect(() => {
    (async () => {
      const registry = new EngineRegistry();
      registry.load(resolveBuiltinEnginesDir());
      const adapter = createCliAdapter(registry);
      const allEngines = registry.list();

      const data = await Promise.all(
        allEngines.map(async (engine) => {
          const isAvail = registry.isAvailable(engine);
          const version = isAvail ? ((await adapter.getVersion(engine)) ?? '') : '';
          return { id: engine.id, isAvail, version, displayName: engine.displayName };
        }),
      );

      setEngines(data);
      const available = data.filter((e) => e.isAvail);
      setSelectedEngines(available.map((e) => e.id));
      if (available.length > 0) setDefaultEngine(available[0].id);
      setScanning(false);
    })();
  }, []);

  const available = engines.filter((e) => e.isAvail);

  useInput((input, key) => {
    if (key.escape) { exit(); return; }

    if (step === 0 && !scanning) {
      // Engine selection
      if (key.upArrow) setCursorIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) setCursorIndex((i) => Math.min(available.length - 1, i + 1));
      if (input === ' ') {
        const id = available[cursorIndex]?.id;
        if (id) {
          setSelectedEngines((prev) =>
            prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id],
          );
        }
      }
      if (key.return) {
        if (selectedEngines.length > 0) {
          configSet('forgeEnabledEngines', selectedEngines);
          setCursorIndex(0);
          setStep(1);
        }
      }
    } else if (step === 1) {
      // Default engine selection
      if (key.upArrow) setCursorIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) setCursorIndex((i) => Math.min(available.length - 1, i + 1));
      if (key.return) {
        const id = available[cursorIndex]?.id;
        if (id) {
          configSet('forgeFixedStarter', id);
          setDefaultEngine(id);
          configSet('onboarded', true);
          setStep(2);
        }
      }
    } else if (step === 2) {
      if (key.return) exit();
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="yellow">{'   ▄▀█ ▄▀▀ ▄▀▄ █▄ █'}</Text>
      <Text bold color="yellow">{'   █▀█ ▀▄█ ▀▄▀ █ ▀█'}</Text>
      <Text italic dimColor>{'   Any AI can join. They compete. You ship.'}</Text>
      <Text> </Text>

      {step === 0 && (
        <Box flexDirection="column">
          <Text bold>{'Welcome to Agon!'}</Text>
          <Text> </Text>
          {scanning ? (
            <Text><Spinner type="dots" /> Scanning engines...</Text>
          ) : (
            <Box flexDirection="column">
              <Text>Which engines should compete? (space to toggle, enter to confirm)</Text>
              <Text> </Text>
              {available.map((e, i) => (
                <Box key={e.id}>
                  <Text color={i === cursorIndex ? 'yellow' : undefined}>
                    {i === cursorIndex ? icons().prompt + ' ' : '  '}
                    {selectedEngines.includes(e.id) ? icons().dotOn : icons().dotOff} {' '}
                  </Text>
                  <Text color={String(ENGINE_COLORS[e.id] ?? 245)} bold>{e.id}</Text>
                  <Text dimColor> {e.version}</Text>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}

      {step === 1 && (
        <Box flexDirection="column">
          <Text bold>Which engine answers when you just chat?</Text>
          <Text> </Text>
          {available.map((e, i) => (
            <Box key={e.id}>
              <Text color={i === cursorIndex ? 'yellow' : undefined}>
                {i === cursorIndex ? icons().prompt + ' ' : '  '}
              </Text>
              <Text color={String(ENGINE_COLORS[e.id] ?? 245)} bold>{e.id}</Text>
              <Text dimColor> {e.displayName}</Text>
            </Box>
          ))}
        </Box>
      )}

      {step === 2 && (
        <Box flexDirection="column">
          <Text> </Text>
          <Text bold color="green">{"You're all set! Just talk — or / for commands."}</Text>
          <Text dimColor>Press Enter to start.</Text>
        </Box>
      )}
    </Box>
  );
}

export async function runOnboarding(): Promise<void> {
  ensureAgonHome();
  const instance = render(React.createElement(OnboardingApp));
  await instance.waitUntilExit();
}
