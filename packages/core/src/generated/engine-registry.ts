import { readdirSync, readFileSync, existsSync } from 'node:fs';

import { join, basename } from 'node:path';

import { homedir } from 'node:os';

import { execFileSync } from 'node:child_process';

import type { EngineDefinition } from './types.js';

import { EngineNotFoundError } from './errors.js';

