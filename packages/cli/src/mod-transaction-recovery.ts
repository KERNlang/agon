import { DurableModHost, recoverManagedLifecycle } from '@kernlang/agon-kernel';

export async function recoverModTransactions(hostRoot: string, kernelVersion: string) {
  const host = new DurableModHost(hostRoot, { kernelVersion });
  const result = await recoverManagedLifecycle(host);
  return { action: 'transaction-recovery' as const, ...result, restartRequired: true };
}
