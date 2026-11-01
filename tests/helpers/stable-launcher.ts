import { build } from 'esbuild';
import { isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';

let compiled: Promise<string> | undefined;

/** Compile current sources, not an ambient dist artifact. */
export function buildStableLauncherForTest(): Promise<string> {
  return compiled ??= build({ entryPoints: [fileURLToPath(new URL('../../packages/cli/src/stable-launcher-entry.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', target: 'node22', write: false, metafile: true,
  }).then(result => {
    const external = Object.values(result.metafile.outputs).flatMap(output => output.imports)
      .filter(entry => entry.external && !isBuiltin(entry.path));
    if (external.length) throw new Error(`standalone launcher imports external code: ${external.map(entry => entry.path).join(', ')}`);
    if (result.outputFiles.length !== 1) throw new Error('standalone launcher requires exactly one output');
    return result.outputFiles[0]!.text;
  });
}
