import { FIRST_PARTY_SURFACE_CATALOG } from '@kernlang/agon-kernel';
import { CommandRegistry } from '../signals/command-registry.js';

import type { CommandHandler } from '../signals/command-registry.js';

/**
 * Register all built-in slash commands as metadata-only handlers in the CommandRegistry.
 */
export function registerBuiltinCommands(registry: CommandRegistry): void {
  const noop = async () => ({ handled: false, ranAsJob: false });
  const passthrough = (rest: string) => ({ input: rest });

  const builtins = FIRST_PARTY_SURFACE_CATALOG
    .filter((entry) => entry.category === 'builtinCommandMetadata')
    .map((entry) => ({ name: entry.publicId, desc: entry.description, category: entry.group, aliases: [...entry.aliases] }));

  for (const b of builtins) {
    const handler: CommandHandler = {
      definition: {
        name: b.name,
        description: b.desc,
        category: b.category,
        aliases: b.aliases,
        source: 'builtin',
      },
      parseArgs: passthrough,
      execute: noop,
    };
    registry.register(handler);
  }
}
