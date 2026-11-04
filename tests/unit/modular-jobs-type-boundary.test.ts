import { expect, it } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { handleDaemonJobRequest, isDaemonJobRequest, JobService } from '@kernlang/agon-mod-jobs';

it('exposes the daemon router through the built public package', () => {
  expect(isDaemonJobRequest({ type: 'job-list' })).toBe(true);
  expect(handleDaemonJobRequest({ type: 'job-list' }, new JobService(), {
    resolve: () => { throw new Error('Listing must not resolve a workflow'); },
  })).toEqual({ type: 'job-list', jobs: [] });
});

it('narrows validated unions without manufacturing missing payload fields', () => {
  const path = fileURLToPath(new URL('../jobs-compile-only.ts', import.meta.url));
  const source = `
    import { isDaemonJobRequest, handleDaemonJobRequest, JobService } from '@kernlang/agon-mod-jobs';
    import type { DaemonJobRequest, DaemonJobResponse, DaemonJobResolver } from '@kernlang/agon-mod-jobs';
    import type { DaemonRequest, DaemonResponse } from '@kernlang/agon-core';
    import { jobsCapability } from '@kernlang/agon-mod-jobs';
    declare const daemonReply: DaemonResponse | null;
    const supportsJobs: boolean = jobsCapability(daemonReply);
    jobsCapability({ type: 'pong', sessionId: 'fixture', uptime: 1, capabilities: ['jobs-v1'] });
    jobsCapability(null);
    import type { JobCliHost, JobCliRequest, JobCliResponse } from '@kernlang/agon-mod-jobs';
    declare const jobRequest: JobCliRequest;
    const wireRequest: DaemonRequest = jobRequest;
    const jobReply: JobCliResponse | null = daemonReply;
    declare const clientHost: JobCliHost;
    const send: Promise<JobCliResponse | null> = clientHost.sendRequest(jobRequest, 1000);
    // @ts-expect-error A response must have a string discriminator.
    jobsCapability({ type: 42 });
    import { ModularJobService } from '@kernlang/agon-mod-jobs';
    import type { Json } from '@kernlang/agon-mod-api';
    import { runWorkflowCommand, emitChunks } from '@kernlang/agon-mod-jobs';
    declare const oldContext: import('@kernlang/agon-core').JobTaskContext;
    const runningCommand: Promise<number> = runWorkflowCommand(oldContext, 'script', ['arg'], '.', 100, 100);
    emitChunks(oldContext, 'stdout', 'text', 100);
    import { createDaemonWorkflowRuntime } from '@kernlang/agon-mod-jobs';
    import type { DaemonWorkflowHost } from '@kernlang/agon-mod-jobs';
    declare const workflowHost: DaemonWorkflowHost;
    const workflow = createDaemonWorkflowRuntime(workflowHost);
    const plan = workflow.buildDaemonWorkflowPlan('review', { input: 'fixture' });
    const executor: import('@kernlang/agon-core').JobExecutor = workflow.createDaemonWorkflowExecutor(plan, { script: 'cli.js' });
    // @ts-expect-error Workflow planning requires the host's command compiler.
    createDaemonWorkflowRuntime({ defaults: workflowHost.defaults });
    // @ts-expect-error The runner requires a real cancellation signal.
    runWorkflowCommand({ signal: 'invalid', emit() {} }, 'script', [], '.', 100, 100);
    declare const persisted: ModularJobService;
    const storedValue: Json | undefined = persisted.result('id')?.value;
    const storedEvent: Json | undefined = persisted.events('id')?.events[0]?.data;
    persisted.submit('test', 'test', async context => {
      context.emit('result', { value: 'json' });
      // @ts-expect-error Functions cannot be persisted as JSON.
      context.emit('result', () => 'not JSON');
      return { value: 'json' };
    });
    declare const parsed: DaemonRequest;
    declare const resolver: DaemonJobResolver;
    if (isDaemonJobRequest(parsed)) {
      const job: DaemonJobRequest = parsed;
      const response: DaemonJobResponse | null = handleDaemonJobRequest(job, new JobService(), resolver);
      const wire: DaemonResponse | null = response;
    }
    const incomplete = { type: 'job-submit' };
    if (isDaemonJobRequest(incomplete)) {
      const cannotInferPayload: never = incomplete;
    }
  `;
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, types: [],
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => name === path
    ? ts.createSourceFile(name, source, languageVersion, true)
    : original(name, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([path], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  expect(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
});
