import { basename } from 'node:path';

const ENV_SECRET_PATTERN = /\b([A-Z][A-Z0-9_]{2,}(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY))[\s:=]+['"]?([^\s'"]{12,})['"]?/g;

export const SECRET_PATTERNS: RegExp[] = [
  // AWS access keys
  /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // AWS secret keys (40-char base64)
  /\b(?:aws_secret_access_key|aws_secret|AWS_SECRET_ACCESS_KEY)[\s:=]+['"]?([A-Za-z0-9/+=]{40})['"]?/g,
  // GitHub / ghp tokens
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{30,}\b/g,
  // GitHub fine-grained PATs
  /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g,
  // OpenAI API keys
  /\bsk-(?:proj-)?[A-Za-z0-9_\-]{30,}\b/g,
  // Anthropic API keys
  /\bsk-ant-(?:api|admin)[0-9]{2}-[A-Za-z0-9_\-]{80,}\b/g,
  // Google API keys
  /\bAIza[0-9A-Za-z_\-]{35}\b/g,
  // Slack tokens
  /\bxox[baprs]-[0-9A-Za-z\-]{10,}\b/g,
  // Generic bearer tokens in env-like lines
  ENV_SECRET_PATTERN,
  // Private key headers
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
] as RegExp[];

export const SECRET_PATH_BLOCKLIST: string[] = ['.env', '.env.local', '.env.production', '.env.staging', '.env.development', 'credentials.json', 'secrets.json', 'auth.json', '.ssh/id_rsa', '.ssh/id_ed25519', '.ssh/id_ecdsa', '.aws/credentials', '.docker/config.json', '.netrc', '.pgpass', '.my.cnf'] as string[];

const SECRET_FILE_NAME = /^(\.npmrc|\.pypirc|\.git-credentials|id_(rsa|dsa|ecdsa|ed25519)(\.(?!pub$).*)?)$|\.env(\.|$)|^(credentials|secrets?)(\.(json|ya?ml|toml|ini|txt|conf|cfg))?$|\.(pem|key|p12|pfx|jks|keystore)$/;
const NOT_A_SECRET_FILE = /\.(example|sample|template|dist|defaults)$|\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|c|h|cc|cpp|cs|swift|sh|md)$/;

/**
 * Check if a file path is known to contain secrets. Used by redactSecrets to replace tool-output of forbidden files with a stub before it ever lands in the thread.
 */
export function isSecretPath(path: string): boolean {
  const lower = path.toLowerCase().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  const name = basename(lower);
  for (const needle of SECRET_PATH_BLOCKLIST) {
    if (name === needle || lower === needle || lower.endsWith('/' + needle)) {
      return true;
    }
  }
  return SECRET_FILE_NAME.test(name) && !NOT_A_SECRET_FILE.test(name);
}

/**
 * Apply the secret-pattern regex set to content, replacing any matches with a '[REDACTED-SECRET]' marker. O(n) per pattern; cheap relative to an LLM call.
 */
export function redactSecrets(content: string): string {
  if (!content) {
    return content;
  }
  let out = content;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, '[REDACTED-SECRET]');
  }
  return out;
}

const ENV_REFERENCE = /^(?:process\.env|import\.meta\.env|os\.environ|Deno\.env|env|config|settings|secrets)\b/;

export function redactSecretsPreservingLines(content: string): string {
  if (!content) return content;
  let out = content;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match, ...groups) =>
      re === ENV_SECRET_PATTERN && ENV_REFERENCE.test(String(groups[1])) ? match : '[REDACTED-SECRET]' + '\n'.repeat(match.split('\n').length - 1));
  }
  return out;
}

export function redactSecretsDeep<T>(value: T): T {
  if (typeof value === 'string') return redactSecretsPreservingLines(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactSecretsDeep(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSecretsDeep(item)])) as T;
  }
  return value;
}
