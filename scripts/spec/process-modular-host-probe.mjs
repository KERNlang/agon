import { resolve } from 'node:path';
import { DurableModHost } from '../../packages/mod-kernel/dist/index.js';

const root = resolve(process.argv[2]);
const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: `probe-${process.pid}` });
const boot = await host.boot();
if (boot.mode !== 'normal' || boot.pointer?.generation !== 1) process.exitCode = 1;
