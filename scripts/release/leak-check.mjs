import { readFileSync } from 'node:fs';

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
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic key'],
  [/\bsk-(?!ant-)[A-Za-z0-9_-]{32,}/, 'sk- API key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/, 'private key'],
];

// Placeholders (`/Users/you`, `/home/user`) are documentation, not leaks.
const PERSONAL_PATH = /(?:(?<![\w.~-])(?:\/mnt\/[a-z]|\/var|\/Volumes\/[^\\/\s"']+)?\/(?:Users|home)|\b[a-z]:[\\/]+Users)[\\/]+(?!(?:you|user|name|me|runner|example|alice|bob|foo|test|dev|agent)(?![a-z0-9._-]))[a-z][a-z0-9._-]{2,}(?![a-z0-9._-])/i;

const ARCHIVE_EXTENSION = /\.(?:tgz|tar|gz|bz2|xz|zst|zip|7z|rar|jar|whl|vsix|asar)$/i;
const ARCHIVE_SIGNATURES = ['\x1f\x8b', 'PK\x03\x04', 'PK\x05\x06', '7z\xbc\xaf\x27\x1c', 'BZh', '\xfd7zXZ\x00', 'Rar!\x1a\x07', '\x28\xb5\x2f\xfd'];
const TAR_SIGNATURE_OFFSET = 257;

function isArchive(path, text) {
  return ARCHIVE_EXTENSION.test(path)
    || ARCHIVE_SIGNATURES.some((signature) => text.startsWith(signature))
    || text.startsWith('ustar', TAR_SIGNATURE_OFFSET);
}

export function checkPackedFile(path, text) {
  const findings = [];
  for (const [pattern, label] of FORBIDDEN_PATHS) if (pattern.test(path)) findings.push(`${path}: ${label}`);
  if (isArchive(path, text)) findings.push(`${path}: nested archive`);
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
  // latin1 maps every byte to one char, so ASCII secrets and archive signatures survive in binary files.
  return paths.flatMap((path) => checkPackedFile(path, readFileSync(`${packageRoot}/${path}`, 'latin1')));
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
