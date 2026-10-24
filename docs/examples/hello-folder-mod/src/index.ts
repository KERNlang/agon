import type { AgonModFactory } from '@kernlang/agon-mod-api';

const createHelloFolderMod: AgonModFactory = async () => ({
  apiVersion: '1',
  async activate(registrar) {
    registrar.command('cli', {
      id: 'hello-folder',
      aliases: [],
      description: 'Say hello from an external folder mod',
      inputSchema: { type: 'object', additionalProperties: false },
      async run() { return { exitCode: 0, result: { message: 'hello from a verified folder mod' } }; },
    });
  },
});

export default createHelloFolderMod;
