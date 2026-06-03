import { defineCommand } from 'citty';
import { writeFileSync, mkdirSync, unlinkSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { header, success, fail, info, table, bold, green, red, dim, yellow } from '../output.js';
import { fetchModelsRegistry, buildModelEntries, searchModels, modelEntryToEngineDef, getAuthKey, setAuthKey, removeAuthKey, loadAllAuthKeys, listStoredProviders } from '@kernlang/agon-core';
import type { ModelEntry } from '@kernlang/agon-core';

function enginesDir() {
  return join(homedir(), '.agon', 'engines');
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function printResults(results: ModelEntry[], offset: number, limit: number) {
  const page = results.slice(offset, offset + limit);
  let currentProvider = '';
  for (let i = 0; i < page.length; i++) {
    const entry = page[i];
    if (entry.providerName !== currentProvider) {
      currentProvider = entry.providerName;
      console.log('');
      console.log(bold(currentProvider));
    }
    const idx = offset + i + 1;
    const cost = entry.costInput != null ? dim(` $${entry.costInput}/$${entry.costOutput} per 1M tok`) : '';
    const ctx = entry.contextWindow ? dim(` ${Math.round(entry.contextWindow / 1024)}k ctx`) : '';
    console.log(`  ${dim(String(idx).padStart(4))}  ${entry.modelName}${ctx}${cost}`);
  }
}

async function interactiveAdd() {
  header('Add Provider — models.dev registry');
  info('Fetching model registry...');

  let registry;
  try {
    registry = await fetchModelsRegistry();
  } catch (err) {
    fail(`Could not fetch models.dev: ${err instanceof Error ? err.message : String(err)}`);
    console.log('');
    info('Fallback: agon provider add <id> <baseUrl> <API_KEY_ENV> <model>');
    process.exit(1);
  }

  const allEntries = buildModelEntries(registry);
  info(`${allEntries.length} models from ${new Set(allEntries.map(e => e.providerId)).size} providers`);
  console.log('');

  // Search loop
  while (true) {
    const query = await prompt(bold('Search') + ' (or "q" to quit): ');
    if (query === 'q' || query === 'quit' || query === 'exit') {
      return;
    }

    const results = searchModels(allEntries, query);
    if (results.length === 0) {
      console.log(red('  No matches. Try a different search term.'));
      continue;
    }

    const showLimit = Math.min(results.length, 20);
    printResults(results, 0, showLimit);
    if (results.length > showLimit) {
      console.log(dim(`  ... and ${results.length - showLimit} more. Narrow your search.`));
    }
    console.log('');

    const pick = await prompt('Enter number to add (or press Enter to search again): ');
    if (!pick) continue;

    const num = parseInt(pick, 10);
    if (isNaN(num) || num < 1 || num > results.length) {
      console.log(red('  Invalid selection.'));
      continue;
    }

    const selected = results[num - 1];
    console.log('');
    console.log(`  Provider: ${bold(selected.providerName)}`);
    console.log(`  Model:    ${bold(selected.modelName)} (${selected.modelId})`);
    console.log(`  API:      ${selected.baseUrl}`);
    console.log(`  Format:   ${selected.format}`);
    console.log(`  Auth:     ${selected.apiKeyEnv}`);

    const hasKey = !!getAuthKey(selected.apiKeyEnv);
    if (!hasKey) {
      console.log('');
      const key = await prompt(`  Enter ${selected.apiKeyEnv}: `);
      if (key) {
        setAuthKey(selected.apiKeyEnv, key, selected.providerName);
        console.log(green('  Key saved to ~/.agon/auth.json'));
      } else {
        console.log(yellow('  Skipped. Add later: agon provider login'));
      }
    } else {
      console.log(green(`  Key:      ${selected.apiKeyEnv} (saved)`));
    }

    // Write engine definition
    const def = modelEntryToEngineDef(selected);
    const dir = enginesDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${def.id}.json`), JSON.stringify(def, null, 2) + '\n');

    console.log('');
    success(`Added: ${bold(def.id)}`);
    if (!process.env[selected.apiKeyEnv]) {
      info(`Set your key: export ${selected.apiKeyEnv}=your_key`);
    }
    return;
  }
}

export const providerCommand = defineCommand({
  meta: {
    name: 'provider',
    description: 'Add, remove, or list API providers; connect/disconnect and manage API keys',
  },
  args: {
    action: {
      type: 'positional',
      description: 'Action: add | remove | list | browse | login | logout | key',
      required: true,
    },
  },
  async run({ args }) {
    let action = args.action;
    const providerIdx = process.argv.indexOf('provider');
    const extra = providerIdx >= 0 ? process.argv.slice(providerIdx + 2) : [];

    switch (action) {
      case 'add': {
        // No args → interactive mode with models.dev registry
        if (extra.length === 0) {
          await interactiveAdd();
          return;
        }

        // With args → manual mode: agon provider add <id> <baseUrl> <apiKeyEnv> <model>
        if (extra.length < 4) {
          fail('Usage: agon provider add <id> <baseUrl> <API_KEY_ENV> <model>');
          console.log('');
          info('Or run without args for interactive model browser:');
          console.log('  agon provider add');
          process.exit(1);
        }

        const [id, baseUrl, apiKeyEnv, ...modelParts] = extra;
        if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
          fail('Provider ID must contain only letters, numbers, dots, hyphens, and underscores');
          process.exit(1);
        }
        const model = modelParts.join(' ');

        const def = {
          schemaVersion: 3,
          id,
          displayName: id.charAt(0).toUpperCase() + id.slice(1),
          isLocal: false,
          tier: 'user',
          timeout: 180,
          exec: { args: [] },
          review: { args: [] },
          api: { baseUrl, apiKeyEnv, model, maxTokens: 4096 },
        };

        const dir = enginesDir();
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${id}.json`), JSON.stringify(def, null, 2) + '\n');

        const hasKey = !!process.env[apiKeyEnv];
        success(`Provider added: ${bold(id)}`);
        console.log(`  Model:  ${model}`);
        console.log(`  API:    ${baseUrl}`);
        console.log(`  Key:    ${apiKeyEnv} ${hasKey ? green('(set)') : red('(not set)')}`);
        if (!hasKey) {
          console.log('');
          info(`Set your API key: export ${apiKeyEnv}=your_key`);
        }
        break;
      }

      case 'remove': {
        const id = extra[0];
        if (!id) {
          fail('Usage: agon provider remove <id>');
          process.exit(1);
        }
        if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
          fail('Provider ID must contain only letters, numbers, dots, hyphens, and underscores');
          process.exit(1);
        }
        const path = join(enginesDir(), `${id}.json`);
        if (!existsSync(path)) {
          fail(`Provider "${id}" not found in ~/.agon/engines/`);
          process.exit(1);
        }
        unlinkSync(path);
        success(`Removed provider: ${id}`);
        break;
      }

      case 'login': {
        // agon provider login — interactive key entry for any provider
        header('Provider Login');
        loadAllAuthKeys();

        let registry;
        try {
          registry = await fetchModelsRegistry();
        } catch (err) {
          fail(`Could not fetch models.dev: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }

        // Show providers grouped, let user pick
        const providers = Object.values(registry)
          .filter((p: any) => p.api && p.env?.length > 0)
          .sort((a: any, b: any) => a.name.localeCompare(b.name));

        const query = extra[0] || await prompt('Search provider: ');
        const q = query.toLowerCase();
        const matches = providers.filter((p: any) =>
          p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
        );

        if (matches.length === 0) {
          fail('No matching providers.');
          break;
        }

        for (let i = 0; i < Math.min(matches.length, 20); i++) {
          const p = matches[i] as any;
          const envVar = p.env[0];
          const hasKey = !!getAuthKey(envVar);
          console.log(`  ${dim(String(i + 1).padStart(3))}  ${hasKey ? green(p.name) : p.name}${hasKey ? green(' (connected)') : ''}`);
        }
        console.log('');

        const pick = await prompt('Select provider number: ');
        const num = parseInt(pick, 10);
        if (isNaN(num) || num < 1 || num > matches.length) {
          fail('Invalid selection.');
          break;
        }

        const selected = matches[num - 1] as any;
        const envVar = selected.env[0];
        const existing = getAuthKey(envVar);
        if (existing) {
          console.log(green(`  ${selected.name} is already connected.`));
          const overwrite = await prompt('  Overwrite? (y/N): ');
          if (overwrite.toLowerCase() !== 'y') break;
        }

        const key = await prompt(`  Enter ${envVar}: `);
        if (!key) {
          fail('No key entered.');
          break;
        }

        setAuthKey(envVar, key, selected.name);
        success(`${selected.name} connected! Key saved to ~/.agon/auth.json`);
        break;
      }

      case 'logout': {
        const providerQuery = extra[0];
        if (!providerQuery) {
          fail('Usage: agon provider logout <provider-name>');
          process.exit(1);
        }
        // Find matching stored key
        const stored = listStoredProviders();
        const match = stored.find(s =>
          s.envVar.toLowerCase().includes(providerQuery.toLowerCase()) ||
          (s.provider && s.provider.toLowerCase().includes(providerQuery.toLowerCase()))
        );
        if (!match) {
          fail(`No stored credentials matching "${providerQuery}"`);
          break;
        }
        removeAuthKey(match.envVar);
        delete (process.env as Record<string, string | undefined>)[match.envVar];
        success(`Removed credentials for ${match.provider ?? match.envVar}`);
        break;
      }

      case 'key': {
        // Scriptable key management: agon provider key set <ENV> [value] | clear <ENV> | list
        // Keys are stored by env-var name and shared across every engine pointing at
        // that env var, so `set` changes the key for all of them at once.
        loadAllAuthKeys();
        const sub = (extra[0] ?? '').toLowerCase();
        if (sub === '' || sub === 'list') {
          const stored = listStoredProviders();
          header('Saved API keys');
          if (stored.length === 0) {
            info('No saved keys. Add one with: agon provider key set <ENV_VAR>');
            break;
          }
          table(['Env var', 'Provider'], stored.map((s) => [green(s.envVar), s.provider ?? dim('—')]));
          break;
        }
        const envVar = extra[1];
        if (!envVar || !/^[A-Za-z0-9_]+$/.test(envVar)) {
          fail('Usage: agon provider key set <ENV_VAR> | clear <ENV_VAR> | list');
          process.exit(1);
        }
        if (sub === 'clear' || sub === 'remove' || sub === 'rm') {
          // Existence check against the STORE only — getAuthKey() also returns
          // shell-exported vars, so using it here would falsely report success and
          // clobber a live env-only key that was never saved.
          const inStore = listStoredProviders().some((s) => s.envVar === envVar);
          if (!inStore) {
            info(`${envVar} is not saved in the auth store${process.env[envVar] ? ' (it is set via your shell environment — unset it there).' : '.'}`);
            break;
          }
          removeAuthKey(envVar);
          delete (process.env as Record<string, string | undefined>)[envVar];
          success(`Cleared ${envVar} from ~/.agon/auth.json`);
          break;
        }
        if (sub === 'set') {
          // Prefer the prompt form — passing the key as an argv token leaks it into
          // shell history and process listings. The inline value still works for
          // automation but is intentionally not advertised.
          let value = extra.slice(2).join(' ');
          if (!value) value = await prompt(`Enter value for ${envVar}: `);
          if (!value) {
            fail('No value provided.');
            process.exit(1);
          }
          const existed = listStoredProviders().some((s) => s.envVar === envVar);
          setAuthKey(envVar, value, undefined);
          success(`${existed ? 'Replaced' : 'Saved'} ${envVar} in ~/.agon/auth.json`);
          break;
        }
        fail('Usage: agon provider key set <ENV_VAR> | clear <ENV_VAR> | list');
        process.exit(1);
      }

      case 'browse': {
        // Show full registry grouped by provider
        header('Available Models — models.dev');
        info('Fetching...');

        try {
          const registry = await fetchModelsRegistry();
          const entries = buildModelEntries(registry);
          printResults(entries, 0, 100);
          console.log('');
          info(`${entries.length} models total. Use "agon provider add" to add one interactively.`);
        } catch (err) {
          fail(`Could not fetch models.dev: ${err instanceof Error ? err.message : String(err)}`);
        }
        break;
      }

      case 'list':
      default: {
        loadAllAuthKeys();
        const dir = enginesDir();
        header('Providers');

        // Show stored credentials
        const stored = listStoredProviders();
        if (stored.length > 0) {
          console.log(bold('  Connected:'));
          for (const s of stored) {
            console.log(`    ${green('●')} ${s.provider ?? s.envVar}`);
          }
          console.log('');
        }

        // Show configured engines
        if (existsSync(dir)) {
          const files = readdirSync(dir).filter((f: string) => f.endsWith('.json'));
          if (files.length > 0) {
            const rows: string[][] = [];
            for (const file of files) {
              try {
                const def = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
                if (def.api) {
                  const hasKey = !!getAuthKey(def.api.apiKeyEnv);
                  rows.push([
                    hasKey ? green(def.id) : red(def.id),
                    def.api.model,
                    dim(def.api.baseUrl),
                    hasKey ? green('ready') : red('no key'),
                  ]);
                }
              } catch (_e) { /* skip malformed */ }
            }
            if (rows.length > 0) {
              table(['ID', 'Model', 'API', 'Status'], rows);
            }
          }
        }

        if (stored.length === 0) {
          info('No providers connected yet.');
        }
        console.log('');
        info('agon provider add        — add model from registry');
        info('agon provider login      — connect a provider (set/overwrite its key)');
        info('agon provider logout     — disconnect a provider (remove its key)');
        info('agon provider key set    — set/replace a key: key set <ENV_VAR> <value>');
        info('agon provider key clear  — remove a saved key: key clear <ENV_VAR>');
        break;
      }
    }
  },
});
