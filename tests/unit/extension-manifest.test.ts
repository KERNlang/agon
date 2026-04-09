import { describe, it, expect } from 'vitest';
import { validateManifest } from '../../packages/core/src/extension-manifest.js';

describe('Extension Manifest', () => {
  describe('validateManifest', () => {
    it('accepts valid minimal manifest', () => {
      const result = validateManifest({
        id: 'test-ext',
        name: 'Test Extension',
        version: '1.0.0',
        description: 'A test extension',
      }, 'test.json');
      expect(result.ok).toBe(true);
      expect(result.data?.id).toBe('test-ext');
    });

    it('accepts manifest with contributes', () => {
      const result = validateManifest({
        id: 'test-ext',
        name: 'Test',
        version: '1.0.0',
        description: 'Test',
        contributes: {
          commands: [{ name: 'foo', description: 'does foo', handler: './foo.js' }],
          skills: [{ name: 'bar', trigger: '/bar', description: 'does bar', prompt: 'Do {input}' }],
          systemPromptFragments: ['Be nice.'],
        },
      }, 'test.json');
      expect(result.ok).toBe(true);
      expect(result.data?.contributes?.commands).toHaveLength(1);
      expect(result.data?.contributes?.skills).toHaveLength(1);
    });

    it('rejects null input', () => {
      const result = validateManifest(null, 'test.json');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not an object');
    });

    it('rejects missing id', () => {
      const result = validateManifest({ name: 'Test', version: '1.0.0', description: 'x' }, 'test.json');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('id');
    });

    it('rejects missing name', () => {
      const result = validateManifest({ id: 'test', version: '1.0.0', description: 'x' }, 'test.json');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('name');
    });

    it('rejects missing version', () => {
      const result = validateManifest({ id: 'test', name: 'Test', description: 'x' }, 'test.json');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('version');
    });

    it('rejects command without handler', () => {
      const result = validateManifest({
        id: 'test', name: 'Test', version: '1.0.0', description: 'x',
        contributes: { commands: [{ name: 'foo', description: 'x' }] },
      }, 'test.json');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('handler');
    });

    it('rejects skill without trigger', () => {
      const result = validateManifest({
        id: 'test', name: 'Test', version: '1.0.0', description: 'x',
        contributes: { skills: [{ name: 'foo' }] },
      }, 'test.json');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('trigger');
    });

    it('accepts manifest with no contributes', () => {
      const result = validateManifest({
        id: 'empty', name: 'Empty', version: '0.0.1', description: 'No contributions',
      }, 'test.json');
      expect(result.ok).toBe(true);
    });
  });
});
