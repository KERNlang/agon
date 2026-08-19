export function countdown(n: number): number {
  let steps = 0;
  let i = n;
  while (i > 0) {
    i = i - 1;
    steps = steps + 1;
  }
  return steps;
}
