export type Intent =
  | { type: 'forge'; task: string; fitnessCmd: string | null }
  | { type: 'brainstorm'; question: string }
  | { type: 'tribunal'; question: string }
  | { type: 'leaderboard' }
  | { type: 'history'; id?: string }
  | { type: 'engines' }
  | { type: 'config'; action?: string; key?: string; value?: string }
  | { type: 'campfire'; topic: string }
  | { type: 'workspace'; action: string; path?: string }
  | { type: 'use'; engineIds: string[] }
  | { type: 'models' }
  | { type: 'tokens' }
  | { type: 'plan'; planId?: string }
  | { type: 'plans' }
  | { type: 'approve' }
  | { type: 'retry' }
  | { type: 'cancel' }
  | { type: 'img'; path: string }
  | { type: 'chat'; input: string }
  | { type: 'discover' }
  | { type: 'apply'; patchPath?: string; force?: boolean }
  | { type: 'cp'; index?: number }
  | { type: 'flow' }
  | { type: 'flows' }
  | { type: 'chats'; sessionId?: string }
  | { type: 'build'; input: string }
  | { type: 'pipeline'; task: string; fitnessCmd: string | null }
  | { type: 'run'; input: string }
  | { type: 'cesar'; input: string }
  | { type: 'clear' }
  | { type: 'slash-list' }
  | { type: 'help' }
  | { type: 'exit' }
  | { type: 'auto'; input: string; taskClass: 'code' | 'question' | 'ambiguous' }
  | { type: 'unknown'; input: string };




































