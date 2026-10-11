import type { Json } from '@kernlang/agon-mod-api';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function snapshot(value: unknown, depth = 0): Json {
  if (depth > 32) throw new TypeError('mod settings exceed the maximum depth');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    const items: Json[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new TypeError('mod settings array must contain own values at every index');
      items.push(snapshot(value[index], depth + 1));
    }
    Object.freeze(items);
    return items;
  }
  if (!record(value)) throw new TypeError('mod settings must contain only JSON values');
  const entries = Object.entries(value).map(([key, child]) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new TypeError('mod settings contain a forbidden key');
    return [key, snapshot(child, depth + 1)];
  });
  return Object.freeze(Object.fromEntries(entries));
}

/** Select data only. The caller must authorize the owner before invoking it. */
export function selectModSettings(config: unknown, ownerId: string | undefined): Readonly<Record<string, Json>> {
  if (!ownerId) return Object.freeze({});
  if (!record(config)) throw new TypeError('mod settings require a configuration object');
  if (!Object.hasOwn(config, 'mods')) return Object.freeze({});
  const mods = config.mods;
  if (!record(mods)) throw new TypeError('mod settings namespaces must be an object');
  if (!Object.hasOwn(mods, ownerId)) return Object.freeze({});
  const selected = mods[ownerId];
  if (!record(selected)) throw new TypeError('mod settings namespace must be an object');
  return snapshot(selected) as Readonly<Record<string, Json>>;
}
