// @kern-source: command-registry:5
export interface CommandDefinition {
  name: string;
  description: string;
  category: string;
  aliases?: string[];
  isJob?: boolean;
  source?: string;
}

// @kern-source: command-registry:6

// @kern-source: command-registry:7

// @kern-source: command-registry:8

// @kern-source: command-registry:9

// @kern-source: command-registry:10

// @kern-source: command-registry:11

// @kern-source: command-registry:13
export interface CommandHandler {
  definition: CommandDefinition;
  parseArgs: (rest: string) => Record<string, unknown>;
  execute: (args: Record<string, unknown>, ctx: any) => Promise<{ handled: boolean; ranAsJob: boolean }>;
}

// @kern-source: command-registry:18
export class CommandRegistry {
  commands: Map<string, CommandHandler>;
  aliasMap: Map<string, string>;

  constructor() {
    this.commands = new Map();
    this.aliasMap = new Map();
  }

  register(handler: CommandHandler): void {
    const name = handler.definition.name.toLowerCase();
    this.commands.set(name, handler);
    if (handler.definition.aliases) {
      for (const alias of handler.definition.aliases) {
        this.aliasMap.set(alias.toLowerCase(), name);
      }
    }
  }

  get(name: string): CommandHandler | undefined {
    const lower = name.toLowerCase();
    const handler = this.commands.get(lower);
    if (handler) return handler;
    const canonical = this.aliasMap.get(lower);
    if (canonical) return this.commands.get(canonical);
    return undefined;
  }

  has(name: string): boolean {
    const lower = name.toLowerCase();
    return this.commands.has(lower) || this.aliasMap.has(lower);
  }

  list(): CommandDefinition[] {
    return Array.from(this.commands.values())
      .map(h => h.definition)
      .sort((a, b) => {
        const catCmp = a.category.localeCompare(b.category);
        return catCmp !== 0 ? catCmp : a.name.localeCompare(b.name);
      });
  }

  listForHelp(): { cmd: string; desc: string }[] {
    return Array.from(this.commands.values())
      .map(h => ({
        cmd: '/' + h.definition.name,
        desc: h.definition.description,
      }))
      .sort((a, b) => a.cmd.localeCompare(b.cmd));
  }

  names(): string[] {
    return Array.from(this.commands.keys());
  }

  unregister(name: string): void {
    const lower = name.toLowerCase();
    const handler = this.commands.get(lower);
    if (handler) {
      this.commands.delete(lower);
      if (handler.definition.aliases) {
        for (const alias of handler.definition.aliases) {
          this.aliasMap.delete(alias.toLowerCase());
        }
      }
    }
  }
}

