import { describe, expect, it } from 'vitest';
import { renderTribunalResult } from '../../packages/mod-tribunal/src/presentation.js';

describe('Tribunal CLI presentation', () => {
  it.each([false, true])('preserves ordered output and truncation (failures=%s)', failures => {
    const lines: string[] = [];
    const format = {
      log: (text: string) => { lines.push(text); },
      header: (text: string) => { lines.push(`HEADER ${text}`); },
      warn: (text: string) => { lines.push(`WARN ${text}`); },
      info: (text: string) => { lines.push(`INFO ${text}`); },
      bold: (text: string) => `<b>${text}</b>`,
      dim: (text: string) => `<dim>${text}</dim>`,
      red: (text: string) => `<red>${text}</red>`,
    };
    const positions = [
      { engineId: 'alpha', position: 'Argue FOR', arguments: ['a'.repeat(501)] },
      { engineId: 'beta', position: 'Argue AGAINST', arguments: ['first\nsecond'] },
    ];
    renderTribunalResult({ question: 'Q', rounds: [{ round: 1, positions }], positions, summary: 'Verdict text',
      panelHealth: { requested: 2, responded: failures ? 1 : 2, degraded: failures, notes: [], banner: failures ? 'panel degraded' : null },
    }, failures ? [
      { engineId: 'beta', phase: 'round-1', error: 'e'.repeat(161) },
      { engineId: 'beta', phase: 'round-2', error: 'second failure' },
      { engineId: 'alpha', phase: 'summary', error: 'summary failure' },
    ] : [], '/fixture/run', format);
    expect(lines).toEqual([
      '', 'HEADER Round 1', '', '  <b>alpha</b> <dim>(Argue FOR)</dim>', `  ${'a'.repeat(500)}`,
      '  <dim>...(truncated)</dim>', '', '  <b>beta</b> <dim>(Argue AGAINST)</dim>', '  first', '  second',
      ...(failures ? [
        '', 'HEADER Engines that hit errors', 'WARN <b>beta</b> (2 failures)',
        `  <dim>round-1</dim>: <red>${'e'.repeat(160)}…</red>`,
        '  <dim>round-2</dim>: <red>second failure</red>', 'WARN <b>alpha</b> (1 failure)',
        '  <dim>summary</dim>: <red>summary failure</red>', '', 'WARN panel degraded',
      ] : []),
      '', 'HEADER Verdict', '', 'Verdict text', '', 'INFO <dim>Full debate saved: /fixture/run</dim>',
    ]);
  });
});
