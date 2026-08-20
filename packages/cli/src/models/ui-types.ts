// Shared UI state shapes for the Ink surface.
//
// These describe values that are PRODUCED in signals/ (the output-event
// reducer) and CONSUMED in both surfaces/ and blocks/. Neither producer nor
// consumer is a valid home for them — blocks/ must never import from
// surfaces/, and surfaces/ must not own a shape signals/ constructs — so they
// live here in models/, which both layers may depend on.

import type { OutputEvent } from './handler-types.js';

/** One selectable row in a question prompt. `__other` is the free-text escape hatch appended by the 'question' reducer. */
export interface QuestionChoice {
  key: string;
  label: string;
  color?: string;
  description?: string;
}

/**
 * The pinned prompt above the composer. Two producers build it:
 *   - the 'question' OutputEvent (prompt + optional choices + resolve), and
 *   - the permission queue (`kind: 'permission'`), which adds the tool /
 *     command / reason / diff-preview fields the approval prompt renders.
 * Permission-only fields are optional because a plain question never sets them.
 */
export interface QuestionState {
  kind?: 'permission';
  prompt: string;
  choices?: QuestionChoice[];
  defaultChoiceKey?: string;
  resolve: (answer: string) => void;
  tool?: string;
  command?: string;
  description?: string;
  reason?: string;
  diffPreview?: Extract<OutputEvent, { type: 'permission-ask' }>['diffPreview'];
  fallbackNote?: string;
}
