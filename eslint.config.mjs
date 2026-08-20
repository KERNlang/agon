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
// WARNING CEILING — LOWER-ONLY RATCHET. `npm run lint` runs with
// `--max-warnings <N>` pinned to the exact warning count of the tree at the
// time it was set. The codegen-era backlog is cleared, so N is 0: any new
// warning fails the gate. When you clear warnings, lower N to the new count
// in the same commit; never raise it to make a red gate green.
//
// Scope: TypeScript under `packages/*/src` (typed, via the TS project
// service), the test suite and root TS config files (untyped — they are
// outside every package tsconfig, so the project service cannot see them),
// and the plain-ESM tooling under `scripts/` (untyped).
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
      // WARN in severity only: the codegen-era backlog (~430 dead bindings the
      // retired KERN emitter left behind) is swept, and `npm run lint` pins
      // `--max-warnings 0`, so a single new dead binding fails the gate exactly
      // like an error would.
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
    // Tests and root TS config files: untyped lint. They belong to no package
    // tsconfig, so the typed project service cannot resolve them — linting them
    // with type-aware rules would error out per file. Listing them explicitly
    // (rather than leaving them to match nothing) is the point: an unmatched
    // file is silently unlinted.
    files: ['tests/**/*.ts', 'tests/**/*.tsx', '*.ts'],
    extends: [tseslint.configs.base],
    rules: {
      'no-fallthrough': 'error',
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
