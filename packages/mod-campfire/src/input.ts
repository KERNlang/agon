/** Match positional topic assembly across command and session entry points. */
export function campfireTopic(input: Record<string, unknown>): string {
  const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
  const extra = Array.isArray(input._) ? input._.map(String).filter(part => part !== input.topic) : [];
  return [topic, ...extra].filter(Boolean).join(' ').trim();
}
