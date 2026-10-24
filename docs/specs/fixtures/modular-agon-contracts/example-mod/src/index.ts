import type { AgonModFactory } from '@kernlang/agon-mod-api';

const createMod: AgonModFactory = async () => ({
  apiVersion: '1',
  activate(registrar) {
    return registrar.command('cli', {
      id: 'hello',
      description: 'Compile-only external example',
      async run(input, context) {
        return { exitCode: 0, result: { input, cwd: context.cwd } };
      },
    });
  },
});

export default createMod;
