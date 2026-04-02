import { writeFileSync, mkdirSync } from 'node:fs';

import { join, dirname } from 'node:path';

import type { EngineAdapter, EngineDefinition, DispatchOptions, DispatchResult, AgentDispatchResult } from '@agon/core';

import { EngineRegistry, spawnWithTimeout, spawnStream, EngineNotFoundError, readOnlyDiff, diffLineCount, apiDispatch, apiStreamDispatch, companionDispatch } from '@agon/core';

import { buildCommand, checkEnvVars } from './adapter-helpers.js';

export class CliAdapter implements EngineAdapter {
  private registry: EngineRegistry;

  constructor(registry: EngineRegistry) {
    this.registry = registry;
  }

  async dispatch(options: DispatchOptions): Promise<DispatchResult> {
    // API-based engine: use HTTP instead of spawn
    if (options.engine.api) {
      const result = await apiDispatch(options.engine.api, options.prompt, options.timeout, options.signal);
      const outputPath = join(options.outputDir, `${options.engine.id}-output.txt`);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, result.stdout);
      return result;
    }
    
    const binaryPath = this.registry.findBinary(options.engine);
    if (!binaryPath) {
      throw new EngineNotFoundError(options.engine.id, options.engine.installHint);
    }
    
    const envError = checkEnvVars(options.engine);
    if (envError) {
      throw new EngineNotFoundError(options.engine.id, envError);
    }
    
    // Try companion protocol (JSONRPC app-server) first — faster, more stable
    if (options.engine.companion) {
      const companionResult = await companionDispatch({
        config: options.engine.companion,
        binaryPath,
        prompt: options.prompt,
        cwd: options.cwd,
        timeout: options.timeout,
        mode: options.mode === 'agent' ? 'agent' : options.mode === 'review' ? 'review' : 'exec',
        signal: options.signal,
      });
      // Exit code 2 = companion not available, fall through to CLI spawn
      if (companionResult.exitCode !== 2) {
        const outputPath = join(options.outputDir, `${options.engine.id}-output.txt`);
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, companionResult.stdout);
        return companionResult;
      }
    }
    
    const { command, args } = buildCommand(
      options.engine, options.mode, options.prompt,
      options.cwd, options.timeout, binaryPath, options.images,
    );
    
    const result = await spawnWithTimeout({
      command, args,
      cwd: options.cwd,
      timeout: options.timeout * 1000,
      signal: options.signal,
    });
    
    const outputPath = join(options.outputDir, `${options.engine.id}-output.txt`);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, result.stdout);
    
    return result;
  }

  async *dispatchStream(options: DispatchOptions): AsyncGenerator<string, DispatchResult, void> {
    // API-based engine: stream via HTTP SSE
    if (options.engine.api) {
      const gen = apiStreamDispatch(options.engine.api, options.prompt, options.timeout, options.signal);
      let result: DispatchResult;
      while (true) {
        const { value, done } = await gen.next();
        if (done) { result = value; break; }
        yield value;
      }
      const outputPath = join(options.outputDir, `${options.engine.id}-output.txt`);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, result.stdout);
      return result;
    }
    
    const binaryPath = this.registry.findBinary(options.engine);
    if (!binaryPath) {
      throw new EngineNotFoundError(options.engine.id, options.engine.installHint);
    }
    
    const { command, args } = buildCommand(
      options.engine, options.mode, options.prompt,
      options.cwd, options.timeout, binaryPath, options.images,
    );
    
    const gen = spawnStream({
      command, args,
      cwd: options.cwd,
      timeout: options.timeout * 1000,
      signal: options.signal,
    });
    
    let result: DispatchResult;
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        result = value;
        break;
      }
      yield value;
    }
    
    const outputPath = join(options.outputDir, `${options.engine.id}-output.txt`);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, result.stdout);
    
    return result;
  }

  async dispatchAgent(options: DispatchOptions): Promise<AgentDispatchResult> {
    const binaryPath = this.registry.findBinary(options.engine);
    if (!binaryPath) {
      throw new EngineNotFoundError(options.engine.id, options.engine.installHint);
    }
    
    const envError = checkEnvVars(options.engine);
    if (envError) {
      throw new EngineNotFoundError(options.engine.id, envError);
    }
    
    // Capture baseline diff before agent runs to exclude pre-existing changes
    const baselineDiff = readOnlyDiff(options.cwd);
    
    // Try companion protocol first
    if (options.engine.companion) {
      const companionResult = await companionDispatch({
        config: options.engine.companion,
        binaryPath,
        prompt: options.prompt,
        cwd: options.cwd,
        timeout: options.timeout,
        mode: 'agent',
        signal: options.signal,
      });
      if (companionResult.exitCode !== 2) {
        const outputPath = join(options.outputDir, `${options.engine.id}-output.txt`);
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, companionResult.stdout);
    
        const postDiff = readOnlyDiff(options.cwd);
        const baselineFiles = new Set(baselineDiff.split('\n').filter((l: string) => l.startsWith('diff --git')));
        const postLines = postDiff.split('\n');
        const newDiffLines: string[] = [];
        let inNewFile = false;
        for (const line of postLines) {
          if (line.startsWith('diff --git')) {
            inNewFile = !baselineFiles.has(line);
          }
          if (inNewFile) newDiffLines.push(line);
        }
        const diff = newDiffLines.join('\n');
        const lines = diffLineCount(diff);
        const files = diff ? newDiffLines.filter((l: string) => l.startsWith('diff --git')).length : 0;
        return { ...companionResult, diff, diffLines: lines, filesChanged: files };
      }
    }
    
    const { command, args } = buildCommand(
      options.engine, options.mode, options.prompt,
      options.cwd, options.timeout, binaryPath, options.images,
    );
    
    const result = await spawnWithTimeout({
      command, args,
      cwd: options.cwd,
      timeout: options.timeout * 1000,
      signal: options.signal,
    });
    
    const outputPath = join(options.outputDir, `${options.engine.id}-output.txt`);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, result.stdout);
    
    const postDiff = readOnlyDiff(options.cwd);
    // Only count new changes by excluding baseline
    const baselineFiles = new Set(baselineDiff.split('\n').filter((l: string) => l.startsWith('diff --git')));
    const postLines = postDiff.split('\n');
    const newDiffLines: string[] = [];
    let inNewFile = false;
    for (const line of postLines) {
      if (line.startsWith('diff --git')) {
        inNewFile = !baselineFiles.has(line);
      }
      if (inNewFile) newDiffLines.push(line);
    }
    const diff = newDiffLines.join('\n');
    const lines = diffLineCount(diff);
    const files = diff ? newDiffLines.filter((l: string) => l.startsWith('diff --git')).length : 0;
    
    return { ...result, diff, diffLines: lines, filesChanged: files };
  }

  async *dispatchAgentStream(options: DispatchOptions): AsyncGenerator<string, AgentDispatchResult, void> {
    const binaryPath = this.registry.findBinary(options.engine);
    if (!binaryPath) {
      throw new EngineNotFoundError(options.engine.id, options.engine.installHint);
    }
    
    const { command, args } = buildCommand(
      options.engine, options.mode, options.prompt,
      options.cwd, options.timeout, binaryPath, options.images,
    );
    
    // Capture baseline before agent runs
    const baselineDiff = readOnlyDiff(options.cwd);
    
    const gen = spawnStream({
      command, args,
      cwd: options.cwd,
      timeout: options.timeout * 1000,
      signal: options.signal,
    });
    
    let result: DispatchResult;
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        result = value;
        break;
      }
      yield value;
    }
    
    const outputPath = join(options.outputDir, `${options.engine.id}-output.txt`);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, result.stdout);
    
    const postDiff = readOnlyDiff(options.cwd);
    const baselineFiles = new Set(baselineDiff.split('\n').filter((l: string) => l.startsWith('diff --git')));
    const postLines = postDiff.split('\n');
    const newDiffLines: string[] = [];
    let inNewFile = false;
    for (const line of postLines) {
      if (line.startsWith('diff --git')) {
        inNewFile = !baselineFiles.has(line);
      }
      if (inNewFile) newDiffLines.push(line);
    }
    const diff = newDiffLines.join('\n');
    const lines = diffLineCount(diff);
    const files = diff ? newDiffLines.filter((l: string) => l.startsWith('diff --git')).length : 0;
    
    return { ...result, diff, diffLines: lines, filesChanged: files };
  }

  async isAvailable(engine: EngineDefinition): Promise<boolean> {
    if (engine.api) return !!process.env[engine.api.apiKeyEnv];
    return this.registry.isAvailable(engine);
  }

  async getVersion(engine: EngineDefinition): Promise<string|null> {
    if (engine.api) return engine.api.model;
    const binaryPath = this.registry.findBinary(engine);
    if (!binaryPath) return null;
    
    try {
      const result = await spawnWithTimeout({
        command: binaryPath,
        args: engine.versionCmd,
        cwd: process.cwd(),
        timeout: 5000,
      });
      return result.stdout.trim() || null;
    } catch (err) {
      console.warn(`[agon] failed to get version for ${engine.id}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}

