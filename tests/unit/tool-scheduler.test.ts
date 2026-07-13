import { describe, expect, it } from 'vitest';
import { scheduleToolBatch } from '../../packages/core/src/generated/sessions/tool-scheduler.js';

describe('persistent-session tool scheduler', () => {
  it('runs an all-safe read batch concurrently while preserving result order', async () => {
    const pending: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    const promise = scheduleToolBatch([1, 2, 3], () => true, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => pending.push(resolve));
      active -= 1;
      return value * 2;
    });
    await Promise.resolve();
    expect(maxActive).toBe(3);
    pending.forEach((resolve) => resolve());
    await expect(promise).resolves.toEqual([2, 4, 6]);
  });

  it('serializes the whole batch when any call is unsafe', async () => {
    const order: string[] = [];
    const result = await scheduleToolBatch(['Read', 'Bash', 'Read'], (name) => name === 'Read', async (name) => {
      order.push(`start:${name}`);
      await Promise.resolve();
      order.push(`end:${name}`);
      return name;
    });

    expect(result).toEqual(['Read', 'Bash', 'Read']);
    expect(order).toEqual(['start:Read', 'end:Read', 'start:Bash', 'end:Bash', 'start:Read', 'end:Read']);
  });
});
