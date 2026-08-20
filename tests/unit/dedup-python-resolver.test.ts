import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSidecarPython } from '../../packages/core/src/blocks/dedup-resolver.js';
import { EXPECTED_SIDECARS, formatPythonSidecarInstallCommand } from '../../packages/cli/src/commands/doctor.js';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

let agonHome: string;
const originalPython = process.env.AGON_PYTHON;

beforeEach(() => {
  agonHome = setupTestAgonHome('dedup-python-resolver');
  delete process.env.AGON_PYTHON;
});

afterEach(() => {
  if (originalPython === undefined) delete process.env.AGON_PYTHON;
  else process.env.AGON_PYTHON = originalPython;
  cleanupTestAgonHome(agonHome);
});

describe('resolveSidecarPython', () => {
  it('prefers an explicit AGON_PYTHON override', () => {
    process.env.AGON_PYTHON = '/explicit/python';
    expect(resolveSidecarPython()).toBe('/explicit/python');
  });

  it('discovers the managed Agon virtualenv before system python3', () => {
    const managed = process.platform === 'win32'
      ? join(agonHome, 'python-sidecar', 'Scripts', 'python.exe')
      : join(agonHome, 'python-sidecar', 'bin', 'python');
    mkdirSync(join(managed, '..'), { recursive: true });
    writeFileSync(managed, '');
    expect(resolveSidecarPython()).toBe(managed);
  });

  it('falls back to python3 when no override or managed environment exists', () => {
    expect(resolveSidecarPython()).toBe('python3');
  });
});

describe('Python sidecar packaging and repair', () => {
  it('checks the RAG embedder and publishes the managed installer', () => {
    expect(EXPECTED_SIDECARS).toContain('embedder.py');
    const packageJson = JSON.parse(readFileSync(new URL('../../packages/dedup/package.json', import.meta.url), 'utf8'));
    expect(packageJson.files).toContain('install-python.mjs');
  });

  it('returns an executable cwd-independent installer command', () => {
    expect(formatPythonSidecarInstallCommand('/tmp/path with spaces/install-python.mjs'))
      .toBe("node '/tmp/path with spaces/install-python.mjs'");
    expect(formatPythonSidecarInstallCommand("/tmp/it's/$(unsafe)/`unsafe`/install-python.mjs"))
      .toBe("node '/tmp/it'\\''s/$(unsafe)/`unsafe`/install-python.mjs'");
    expect(formatPythonSidecarInstallCommand('/tmp/line\nbreak/install-python.mjs'))
      .toBe("node '/tmp/line\nbreak/install-python.mjs'");
  });

  it('omits the repair command when the installer is unavailable', () => {
    expect(formatPythonSidecarInstallCommand(null)).toBe('');
  });

  it('reports a missing Python bootstrap command', () => {
    const installer = fileURLToPath(new URL('../../packages/dedup/install-python.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [installer], {
      encoding: 'utf8',
      env: {
        ...process.env,
        AGON_HOME: join(agonHome, 'isolated-installer'),
        AGON_BOOTSTRAP_PYTHON: join(agonHome, 'missing-python'),
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[agon] could not start Python bootstrap');
  });
});
