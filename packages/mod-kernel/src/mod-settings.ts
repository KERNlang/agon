import type { Json } from '@kernlang/agon-mod-api';
import { canonicalJson } from './lock.js';
import { validateContributionInput } from './json-schema-input.js';

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

/** Retain inactive namespaces as data. Validate selected values at invocation. */
export function mergeModSettingsLayers(...layers: readonly unknown[]): Record<string, unknown> | undefined {
  const owners = new Map<string, unknown>();
  let present = false;
  for (const layer of layers) {
    if (!record(layer) || !Object.hasOwn(layer, 'mods')) continue;
    present = true;
    if (!record(layer.mods)) throw new TypeError('mod settings namespaces must be an object');
    for (const [ownerId, value] of Object.entries(layer.mods)) {
      const previous = owners.get(ownerId);
      owners.set(ownerId, record(previous) && record(value) ? { ...previous, ...value } : value);
    }
  }
  return present ? Object.fromEntries(owners) : undefined;
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

function withDefaults(schema: Record<string, unknown>, input: unknown, depth = 0): unknown {
  if (depth > 32) throw new TypeError('mod settings schema exceeds the maximum depth');
  const value = input === undefined && Object.hasOwn(schema, 'default') ? snapshot(schema.default) : input;
  if (record(value)) {
    const properties = record(schema.properties) ? schema.properties : {};
    const result = { ...value };
    for (const key of new Set([...Object.keys(value), ...Object.keys(properties)])) {
      const property = Object.hasOwn(properties, key) ? properties[key] : schema.additionalProperties;
      if (!record(property)) continue;
      const child = withDefaults(property, Object.hasOwn(value, key) ? value[key] : undefined, depth + 1);
      if (child !== undefined) Object.defineProperty(result, key, { value: child, enumerable: true, configurable: true, writable: true });
    }
    return result;
  }
  if (Array.isArray(value) && record(schema.items)) {
    const items = schema.items;
    return value.map(child => withDefaults(items, child, depth + 1));
  }
  return value;
}

function combineDefaults(left: Json, right: Json): Json {
  if (canonicalJson(left) === canonicalJson(right)) return left;
  if (record(left) && record(right)) {
    const combined = { ...left } as Record<string, Json>;
    for (const [key, value] of Object.entries(right)) {
      combined[key] = Object.hasOwn(combined, key) ? combineDefaults(combined[key], value as Json) : value as Json;
    }
    return combined;
  }
  if (Array.isArray(left) && Array.isArray(right) && left.length === right.length) {
    return left.map((value, index) => combineDefaults(value, right[index]));
  }
  throw new TypeError('configuration schemas propose conflicting defaults');
}

/** Apply committed owner schemas without writing configuration or changing authority. */
export function resolveRegisteredModSettings(ownerId: string, settings: unknown, schemas: readonly unknown[]): Readonly<Record<string, Json>> {
  try {
    const selected = selectModSettings({ mods: { [ownerId]: settings } }, ownerId);
    const proposed = new Map<string, Json>();
    for (const schema of schemas) {
      if (!record(schema) || schema.type !== 'object') throw new TypeError('configuration schema must describe an object');
      if (Object.hasOwn(schema, 'default') && !record(schema.default)) throw new TypeError('configuration default must be an object');
      const defaults = record(schema.default) ? { ...snapshot(schema.default) as Record<string, Json>, ...selected } : selected;
      const candidate = snapshot(withDefaults(schema, defaults)) as Record<string, Json>;
      for (const [key, value] of Object.entries(candidate)) {
        if (Object.hasOwn(selected, key) && canonicalJson(selected[key]) === canonicalJson(value)) continue;
        proposed.set(key, proposed.has(key) ? combineDefaults(proposed.get(key)!, value) : value);
      }
    }
    const resolved = { ...selected, ...Object.fromEntries(proposed) };
    for (const schema of schemas) {
      const failure = validateContributionInput(schema as Record<string, unknown>, resolved);
      if (failure) throw new TypeError(failure);
    }
    return snapshot(resolved) as Readonly<Record<string, Json>>;
  } catch (error) {
    throw new TypeError(`mod settings for ${ownerId} are invalid: ${error instanceof Error ? error.message : 'invalid configuration'}`);
  }
}
