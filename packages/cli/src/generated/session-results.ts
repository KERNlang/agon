// @kern-source: session-results:1
import type { SessionResult } from '@agon/core';

// @kern-source: session-results:3
export class SessionResultStore {
  results: SessionResult[] = [];

  add(result: SessionResult): void {
    this.results.push(result);
  }

  getResults(): SessionResult[] {
    return [...this.results];
  }

  hasResults(): boolean {
    return this.results.length > 0;
  }

  clear(): void {
    this.results = [];
  }
}

export const sessionResultStore = new SessionResultStore();

