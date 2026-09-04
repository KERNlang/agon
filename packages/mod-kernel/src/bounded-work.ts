/** Deterministic, resource-bounded parallel work. Results retain input order. */
export async function mapSettledBounded<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  task: (value: Input, index: number) => Promise<Output>,
): Promise<readonly PromiseSettledResult<Output>[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new RangeError('bounded work concurrency must be a positive safe integer');
  const results = new Array<PromiseSettledResult<Output>>(values.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      try { results[index] = { status: 'fulfilled', value: await task(values[index]!, index) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return Object.freeze(results);
}
