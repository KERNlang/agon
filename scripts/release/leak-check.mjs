import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

const FORBIDDEN_PATHS = [
  [/(^|\/)\.env(\.|$)/i, 'dotenv file'],
  [/(^|\/)(\.git|\.github|\.claude|node_modules|__tests__|tests?|coverage)(\/|$)/i, 'development directory'],
  [/(^|\/)src\/.*\.tsx?$/i, 'TypeScript source'],
  [/\.(test|spec)(\.d)?\.[cm]?[jt]sx?(\.map)?$/i, 'test file'],
  [/\.(pem|key|p12|pfx|tsbuildinfo|log)$/i, 'key, build-info or log file'],
  [/(^|\/)(\.npmrc|id_rsa|id_ed25519|credentials(\.json)?)$/i, 'credential file'],
];

const SECRET_PATTERNS = [
  [/\bnpm_[A-Za-z0-9]{36}\b/, 'npm token'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/, 'GitHub token'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}\b/, 'Anthropic key'],
  [/\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/, 'OpenAI-style key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/, 'private key'],
];

// Placeholders (`/Users/you`, `/home/user`) are documentation, not leaks.
const PERSONAL_PATH = /(?:\/Users|\/home)\/(?!you\b|user\b|name\b|me\b|runner\b|example\b|alice\b|bob\b|foo\b|test\b|dev\b|agent\b)[a-z][a-z0-9._-]{2,}\//;

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.map', '.json', '.md', '.txt', '.py', '.yml', '.yaml', '.sh', '.toml', '.patch', '']);

export function checkPackedFile(path, text) {
  const findings = [];
  for (const [pattern, label] of FORBIDDEN_PATHS) if (pattern.test(path)) findings.push(`${path}: ${label}`);
  if (text === null) return findings;
  for (const [pattern, label] of SECRET_PATTERNS) if (pattern.test(text)) findings.push(`${path}: ${label} pattern`);
  const personal = PERSONAL_PATH.exec(text);
  if (personal) findings.push(`${path}: personal path ${personal[0]}`);
  if (path.endsWith('.map')) {
    try {
      if (Array.isArray(JSON.parse(text).sourcesContent)) findings.push(`${path}: source map embeds sourcesContent`);
    } catch {
      findings.push(`${path}: unreadable source map`);
    }
  }
  return findings;
}

export function checkPackedTree(packageRoot, paths) {
  return paths.flatMap((path) => {
    const textual = TEXT_EXTENSIONS.has(extname(basename(path)));
    return checkPackedFile(path, textual ? readFileSync(`${packageRoot}/${path}`, 'utf8') : null);
  });
}

export function checkManifestShape(manifest, paths) {
  const problems = [];
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) problems.push('missing files allowlist');
  const hasEntry = manifest.main || manifest.exports || manifest.bin;
  const isPythonSidecar = paths.some((path) => path.endsWith('.py'));
  if (!hasEntry && !isPythonSidecar) problems.push('missing main, exports and bin');
  if (manifest.license !== 'MIT') problems.push('license is not MIT');
  for (const hook of ['preinstall', 'install', 'postinstall']) {
    if (manifest.scripts?.[hook]) problems.push(`declares lifecycle script ${hook}`);
  }
  return problems;
}
