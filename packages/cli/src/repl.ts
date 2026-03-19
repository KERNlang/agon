/**
 * REPL entry point — delegates to Ink-based app.
 *
 * The original 2280-line REPL has been decomposed:
 * - UI → app.tsx (Ink React components)
 * - Handlers → handlers/ (dispatch-based, no stdout writes)
 * - State machine → kern/app-state.kern (KERN-sourced)
 * - UI components → kern/ui-app.kern, kern/ui-blocks.kern (KERN-sourced)
 */
export { startRepl } from './app.js';
