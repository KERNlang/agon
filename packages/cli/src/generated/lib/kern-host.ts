// ── Module: HostPrimitives ──

export function hostNowMs(): number {
  return Date.now();
}

export function hostRandom(): number {
  return Math.random();
}

export function hostDateMs(value: string|number): number {
  return new Date(value).getTime();
}

export function hostNowIso(): string {
  return new Date().toISOString();
}

export function hostDateIso(value: string|number): string {
  return new Date(value).toISOString();
}

export function hostLocaleTime(value: string): string {
  return new Date(value).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function hostWorkingDirectory(): string {
  return process.cwd();
}

export function hostEnvironment(name: string): string|undefined {
  return process.env[name];
}

export function hostStringSet(values?: string[]): Set<string> {
  return new Set(values ?? []);
}

export function hostSet(values?: Iterable<any>): Set<any> {
  return new Set(values ?? []);
}

export function hostObjectValues(value: Record<string,any>): any[] {
  return Object.values(value);
}


// ── Module: CliHostOperations ──

/**
 * Host AbortSignal/Promise arbitration for a REPL choice. Settles with an empty answer on external cancellation and detaches the listener on every completion path.
 */
export async function hostWaitForInteractiveChoice(signal: AbortSignal, ask: (resolve:(answer:string)=>void)=>void): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (answer: string) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(answer);
    };
    const onAbort = () => finish('');
    if (signal.aborted) { finish(''); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    try { ask(finish); }
    catch (err) {
      signal.removeEventListener('abort', onAbort);
      settled = true;
      reject(err);
    }
  });
}

export function hostResolvedVoid(): Promise<void> {
  return Promise.resolve();
}

export async function hostPromiseAll(values: Promise<any>[]): Promise<any[]> {
  return Promise.all(values);
}

export async function hostPromiseAllValues(values: any[]): Promise<any[]> {
  return Promise.all(values.map((value) => Promise.resolve(value)));
}

export function hostConsoleLog(message: string): void {
  console.log(message);
}

export function hostConsoleWarn(message: string): void {
  console.warn(message);
}

export function hostRegexTest(pattern: string, flags: string, value: string): boolean {
  return new RegExp(pattern, flags).test(value);
}

/**
 * Construct a JavaScript RegExp at the explicit host boundary. Use when native KERN's portable ASCII regex lowering would change required ECMAScript Unicode-whitespace semantics.
 */
export function hostEcmaRegex(pattern: string, flags: string): RegExp {
  return new RegExp(pattern, flags);
}

export function hostRegexObjectTest(pattern: RegExp, value: string): boolean {
  return pattern.test(value);
}

export function hostRegexExec(pattern: RegExp, value: string): RegExpExecArray|null {
  return pattern.exec(value);
}

export function hostRegexMatch(pattern: RegExp, value: string): RegExpMatchArray|null {
  return value.match(pattern);
}

export function hostCharFromCode(code: number): string {
  return String.fromCharCode(code);
}

/**
 * Construct an AggregateError at the explicit TypeScript host boundary so portable KERN handlers do not reference an undeclared JavaScript global.
 */
export function hostAggregateError(errors: unknown[], message: string): Error {
  const AggregateErrorCtor = globalThis.AggregateError;
  return new AggregateErrorCtor(errors, message);
}

