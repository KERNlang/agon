/** Internal queue metadata is never included in transcript or engine text. */
export type QueuedInput = string | { readonly kind: 'telemetry-retry'; readonly input: string };

export function queuedInputText(value: QueuedInput): string {
  return typeof value === 'string' ? value : value.input;
}
