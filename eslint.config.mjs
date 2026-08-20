// Minimal typed ESLint config.
//
// Agon used to get a class of structural checks for free from the KERN
// compiler (`kern check`). After the eject to plain TypeScript those
// invariants have to come from somewhere, so this config replaces the few
// that actually caught bugs — nothing more. It is deliberately NOT a style
// linter: no formatting rules, no opinionated `recommended` preset, no
// mass source edits to satisfy it. Adding a rule here means committing to
// keeping the whole tree clean under it.
//
// Scope: TypeScript under `packages/*/src` (typed, via the TS project
// service) plus the plain-ESM tooling under `scripts/` (untyped).
// `*.entry.tsx` is excluded from the CLI tsconfig, so it is out of the
// project service's reach and is ignored here too.

import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-tsc/**',
      '**/node_modules/**',
      '**/*.entry.tsx',
      'packages/dedup/**',
      'packages/saas-api/**',
    ],
  },
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A `switch` over a discriminated union that silently ignores a new
      // variant is the single most common way a new mode/event/tool half-lands.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      // Implicit fallthrough between non-empty cases.
      'no-fallthrough': 'error',
      // Dead bindings left behind by a refactor. `_`-prefixed names opt out.
      //
      // WARN, not error: the tree inherited ~390 unused bindings from the
      // retired KERN codegen (mostly dead imports it emitted per-module).
      // Clearing them is a mechanical source sweep of its own; until then an
      // `error` here would either fail the gate or force a mass edit through a
      // change that is meant to be behavior-preserving. Promote to `error`
      // once the backlog is zero.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      // TypeScript already resolves globals/imports.
      'no-undef': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.js', '*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'no-fallthrough': 'error',
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'off',
    },
  },
);
