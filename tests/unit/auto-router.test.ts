import { describe, it, expect } from 'vitest';
import { classifyTask, detectIntent } from '../../packages/cli/src/intent.js';

describe('Auto-Router', () => {
  describe('classifyTask', () => {
    it('classifies code tasks', () => {
      expect(classifyTask('fix the auth bug')).toBe('code');
      expect(classifyTask('add input validation')).toBe('code');
      expect(classifyTask('implement caching')).toBe('code');
      expect(classifyTask('refactor the login flow')).toBe('code');
      expect(classifyTask('debug the crash')).toBe('code');
      expect(classifyTask('create a new component')).toBe('code');
      expect(classifyTask('update the config')).toBe('code');
      expect(classifyTask('remove dead code')).toBe('code');
      expect(classifyTask('test the API endpoint')).toBe('code');
      expect(classifyTask('deploy to staging')).toBe('code');
      expect(classifyTask('migrate the database')).toBe('code');
    });

    it('classifies questions', () => {
      expect(classifyTask('what is the auth middleware')).toBe('question');
      expect(classifyTask('how does the login flow work')).toBe('question');
      expect(classifyTask('why is this failing')).toBe('question');
      expect(classifyTask('explain the scoring algorithm')).toBe('question');
      expect(classifyTask('where is the config stored')).toBe('question');
      expect(classifyTask('describe the architecture')).toBe('question');
      expect(classifyTask('show me the API endpoints')).toBe('question');
      expect(classifyTask('list all engines')).toBe('question');
      expect(classifyTask('can you explain this error')).toBe('question');
      expect(classifyTask('walk me through the deploy process')).toBe('question');
    });

    it('classifies ambiguous input', () => {
      expect(classifyTask('hello')).toBe('ambiguous');
      expect(classifyTask('the auth is broken')).toBe('ambiguous');
      expect(classifyTask('something is wrong')).toBe('ambiguous');
      expect(classifyTask('check this out')).toBe('ambiguous');
    });

    it('question pattern takes precedence over code verbs', () => {
      // "how do I fix" starts with "how" → question, not code
      expect(classifyTask('how do I fix the auth bug')).toBe('question');
      expect(classifyTask('what should I update')).toBe('question');
      expect(classifyTask('why did the test fail')).toBe('question');
    });

    it('detects code artifacts', () => {
      expect(classifyTask('at AuthMiddleware.validate:42')).toBe('code');
      expect(classifyTask('error in auth.ts:15')).toBe('code');
      expect(classifyTask('--- a/src/auth.ts\n+++ b/src/auth.ts')).toBe('code');
    });
  });

  describe('detectIntent auto-routing', () => {
    it('code tasks return auto with code class', () => {
      const r = detectIntent('fix the login bug');
      expect(r.type).toBe('auto');
      if (r.type === 'auto') {
        expect(r.taskClass).toBe('code');
        expect(r.input).toBe('fix the login bug');
      }
    });

    it('questions return auto with question class', () => {
      const r = detectIntent('what is the auth middleware');
      expect(r.type).toBe('auto');
      if (r.type === 'auto') {
        expect(r.taskClass).toBe('question');
      }
    });

    it('slash commands bypass auto-routing', () => {
      expect(detectIntent('/build fix it').type).toBe('build');
      expect(detectIntent('/forge fix it').type).toBe('forge');
      expect(detectIntent('/chat hello').type).toBe('chat');
    });

    it('keyword shortcuts still work', () => {
      expect(detectIntent('exit').type).toBe('exit');
      expect(detectIntent('help').type).toBe('help');
      expect(detectIntent('leaderboard').type).toBe('leaderboard');
    });
  });
});
