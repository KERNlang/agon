import { describe, expect, it } from 'vitest';
import {
  assessDelegationShape,
  buildDelegationAdvisory,
} from '../../packages/cli/src/generated/cesar/delegation-reflex.js';

const listTask = [
  'Please handle these independent cleanups across the repo:',
  '1. migrate the audio player component to the new event bus API',
  '2. rewrite the settings screen validation against the form contract',
  '3. port the notification badge logic from the legacy polling service',
].join('\n');

describe('assessDelegationShape — veto-first fan-out detection', () => {
  it('suggests on an explicit 3-item list with no vetoes', () => {
    const shape = assessDelegationShape(listTask);
    expect(shape.decision).toBe('suggest');
    expect(shape.items).toHaveLength(3);
    expect(shape.vetoes).toHaveLength(0);
  });

  it('never suggests for prose without explicit list items', () => {
    const shape = assessDelegationShape('Refactor the audio player, the settings screen, and the notification badge to use the new event bus API across the whole application.');
    expect(shape.decision).toBe('none');
    expect(shape.vetoes).toContain('fewer-than-3-items');
  });

  it('a 2-item list stays below the floor', () => {
    const shape = assessDelegationShape('Two things:\n1. migrate the audio player component to the new bus\n2. rewrite the settings screen validation against the contract');
    expect(shape.decision).toBe('none');
    expect(shape.vetoes).toContain('fewer-than-3-items');
  });

  it('sequential markers veto even a clean list', () => {
    const shape = assessDelegationShape(`${listTask}\nDo the first one, then the second once that is green.`);
    expect(shape.decision).toBe('none');
    expect(shape.vetoes).toContain('sequential-markers');
  });

  it('small-task language vetoes', () => {
    const shape = assessDelegationShape(`Just a quick pass please:\n${listTask}`);
    expect(shape.decision).toBe('none');
    expect(shape.vetoes).toContain('small-task-language');
  });

  it('shared-artifact mentions veto — parallel-looking work on one artifact is not parallel', () => {
    const shape = assessDelegationShape(`${listTask}\nAll three write to the same generated schema module.`);
    expect(shape.decision).toBe('none');
    expect(shape.vetoes).toContain('shared-artifact-mention');
  });

  it('tiny list items fail the size floor', () => {
    const shape = assessDelegationShape('These please:\n1. fix the header layout problem\n2. do tests\n3. update the readme documentation for the release');
    expect(shape.decision).toBe('none');
    expect(shape.vetoes).toContain('item-below-size-floor');
  });

  it('long items are capped in the reported list', () => {
    const long = 'x'.repeat(300);
    const shape = assessDelegationShape(`Work:\n1. ${long}\n2. ${long}\n3. ${long}`);
    expect(shape.items.every((i) => i.length <= 120)).toBe(true);
  });
});

describe('buildDelegationAdvisory', () => {
  it('renders the advisory for a suggest decision, using the canonical team-agent action', () => {
    const advisory = buildDelegationAdvisory(assessDelegationShape(listTask));
    expect(advisory).toContain('[DELEGATION SHAPE]');
    expect(advisory).toContain('3 explicit list items');
    // 'team-agent' is the action routing.kern/parseSuggestion actually
    // recognize (team- prefix + agent) — NOT 'agent-team' (review: kimi).
    expect(advisory).toContain('SUGGEST:team-agent');
    expect(advisory).toContain('ignore this note');
  });

  it('plural shared-artifact mentions veto too', () => {
    const shape = assessDelegationShape(`${listTask}\nCareful: all of them touch the schemas and lockfiles.`);
    expect(shape.decision).toBe('none');
    expect(shape.vetoes).toContain('shared-artifact-mention');
  });

  it('an unrelated far-apart first/then pair does not over-veto', () => {
    const text = `${listTask}\nThe first item is the most valuable one for users.\nOverall this is not urgent; there is more work coming eventually.`;
    const shape = assessDelegationShape(text);
    expect(shape.vetoes).not.toContain('sequential-markers');
  });

  it('returns null for a none decision', () => {
    expect(buildDelegationAdvisory(assessDelegationShape('fix the typo in the readme'))).toBeNull();
  });
});
