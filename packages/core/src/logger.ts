import { writeFileSync, statSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const MAX_LOG_SIZE = 1_048_576; // 1MB

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export function createLogger(opts: {
  enabled: boolean;
  logDir: string;
}): Logger {
  const logFile = join(opts.logDir, 'debug.log');

  function write(level: string, message: string, data?: Record<string, unknown>): void {
    if (!opts.enabled) return;

    try {
      mkdirSync(opts.logDir, { recursive: true });
    } catch {
      // ignore
    }

    // Rotate if over max size
    try {
      const stat = statSync(logFile);
      if (stat.size > MAX_LOG_SIZE) {
        renameSync(logFile, logFile + '.old');
      }
    } catch {
      // file doesn't exist yet
    }

    const ts = new Date().toISOString();
    const line = data
      ? `[${ts}] ${level}: ${message} ${JSON.stringify(data)}\n`
      : `[${ts}] ${level}: ${message}\n`;

    try {
      writeFileSync(logFile, line, { flag: 'a' });
    } catch {
      // ignore write errors
    }
  }

  return {
    debug: (msg, data) => write('DEBUG', msg, data),
    info: (msg, data) => write('INFO', msg, data),
    warn: (msg, data) => write('WARN', msg, data),
    error: (msg, data) => write('ERROR', msg, data),
  };
}
