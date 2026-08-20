// ── Module: CoreHostPrimitives ──

export function hostNowMs(): number {
  return Date.now();
}

export function hostNowIso(): string {
  return new Date().toISOString();
}

export function hostEpochFrom(value: string|number): number {
  return new Date(value).getTime();
}

export function hostCreateSet(values?: Iterable<any>): Set<any> {
  return new Set(values);
}

export function hostWarn(message: string): void {
  console.warn(message);
}

export function hostLog(message: string): void {
  console.log(message);
}

export function hostEnv(name: string): string|undefined {
  return process.env[name];
}


// ── Module: CoreHostOperations ──

export function hostPrettyJson(value: any): string {
  return JSON.stringify(value, null, 2);
}

export function hostObjectValues(value: Record<string,any>): any[] {
  return Object.values(value);
}

export function hostRegexSplit(value: string, pattern: RegExp): string[] {
  return value.split(pattern);
}

export function hostRegexReplace(value: string, pattern: RegExp, replacement: string): string {
  return value.replace(pattern, replacement);
}

export function hostRegexTest(value: string, pattern: RegExp): boolean {
  return pattern.test(value);
}

export function hostUrlHost(value: string): string {
  return new URL(value).host;
}

export function hostSqrt(value: number): number {
  return Math.sqrt(value);
}
