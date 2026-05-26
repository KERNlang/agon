// @kern-source: intent-types:1
export type Intent =
  | { type: 'forge'; task: string; fitnessCmd: string | null }
  | { type: 'brainstorm'; question: string }
  | { type: 'tribunal'; question: string; tribunalMode?: string }
  | { type: 'team-tribunal'; question: string; tribunalMode?: string; membersPerSide?: number }
  | { type: 'team-forge'; task: string; fitnessCmd: string | null; membersPerSide?: number }
  | { type: 'team-brainstorm'; question: string; membersPerSide?: number }
  | { type: 'leaderboard' }
  | { type: 'cesar-report' }
  | { type: 'cesar-hints'; input: string }
  | { type: 'history'; id?: string }
  | { type: 'engines' }
  | { type: 'config'; action?: string; key?: string; value?: string }
  | { type: 'campfire'; topic: string }
  | { type: 'workspace'; action: string; path?: string }
  | { type: 'use'; engineIds: string[] }
  | { type: 'models' }
  | { type: 'tokens' }
  | { type: 'doctor'; scope?: string }
  | { type: 'harness-replay'; turnId?: string }
  | { type: 'plan'; planId?: string }
  | { type: 'plans' }
  | { type: 'approve' }
  | { type: 'retry' }
  | { type: 'cancel' }
  | { type: 'img'; path: string }
  | { type: 'chat'; input: string }
  | { type: 'provider'; action: string; args: string }
  | { type: 'discover' }
  | { type: 'apply'; patchPath?: string; force?: boolean }
  | { type: 'cp'; index?: number }
  | { type: 'flow' }
  | { type: 'flows' }
  | { type: 'chats'; sessionId?: string }
  | { type: 'build'; input: string }
  | { type: 'agent'; input: string }
  | { type: 'agent-solo'; input: string; maxTurns?: number }
  | { type: 'speculate'; input: string; engines?: string[]; maxTurns?: number }
  | { type: 'team-agent'; input: string; engines?: string[]; taskKind?: 'edit'|'investigate'; maxTurns?: number }
  | { type: 'pipeline'; task: string; fitnessCmd: string | null }
  | { type: 'review'; target?: string; engineId?: string; engineIds?: string[] }
  | { type: 'run'; input: string }
  | { type: 'cesar'; engineIds: string[] }
  | { type: 'commit'; input?: string }
  | { type: 'undo'; snapshotId?: string }
  | { type: 'checkpoints' }
  | { type: 'jobs' }
  | { type: 'focus'; jobId?: string }
  | { type: 'explore' }
  | { type: 'nero' }
  | { type: 'chats-resume'; sessionId: string }
  | { type: 'suggest-brainstorm'; input: string; question?: string }
  | { type: 'suggest-tribunal'; input: string; question?: string }
  | { type: 'suggest-forge'; input: string; task?: string; fitnessCmd: string | null | undefined }
  | { type: 'clear' }
  | { type: 'slash-list' }
  | { type: 'help' }
  | { type: 'exit' }
  | { type: 'auto'; input: string; taskClass: 'code' | 'question' | 'ambiguous'; autoMode?: boolean }
  | { type: 'mcp'; action: 'connect'|'disconnect'|'list'; server?: string }
  | { type: 'init'; scope?: string | undefined }
  | { type: 'create-skill'; skillName: string }
  | { type: 'extensions' }
  | { type: 'extension-command'; commandName: string; args: string }
  | { type: 'unknown'; input: string };

// @kern-source: intent-types:2

// @kern-source: intent-types:5

// @kern-source: intent-types:7

// @kern-source: intent-types:10

// @kern-source: intent-types:14

// @kern-source: intent-types:18

// @kern-source: intent-types:21

// @kern-source: intent-types:22

// @kern-source: intent-types:23

// @kern-source: intent-types:25

// @kern-source: intent-types:27

// @kern-source: intent-types:28

// @kern-source: intent-types:32

// @kern-source: intent-types:34

// @kern-source: intent-types:37

// @kern-source: intent-types:39

// @kern-source: intent-types:40

// @kern-source: intent-types:41

// @kern-source: intent-types:43

// @kern-source: intent-types:45

// @kern-source: intent-types:47

// @kern-source: intent-types:48

// @kern-source: intent-types:49

// @kern-source: intent-types:50

// @kern-source: intent-types:51

// @kern-source: intent-types:53

// @kern-source: intent-types:55

// @kern-source: intent-types:58

// @kern-source: intent-types:59

// @kern-source: intent-types:62

// @kern-source: intent-types:64

// @kern-source: intent-types:65

// @kern-source: intent-types:66

// @kern-source: intent-types:68

// @kern-source: intent-types:70

// @kern-source: intent-types:72

// @kern-source: intent-types:75

// @kern-source: intent-types:79

// @kern-source: intent-types:84

// @kern-source: intent-types:87

// @kern-source: intent-types:91

// @kern-source: intent-types:93

// @kern-source: intent-types:95

// @kern-source: intent-types:97

// @kern-source: intent-types:99

// @kern-source: intent-types:100

// @kern-source: intent-types:101

// @kern-source: intent-types:103

// @kern-source: intent-types:104

// @kern-source: intent-types:105

// @kern-source: intent-types:107

// @kern-source: intent-types:110

// @kern-source: intent-types:113

// @kern-source: intent-types:117

// @kern-source: intent-types:118

// @kern-source: intent-types:119

// @kern-source: intent-types:120

// @kern-source: intent-types:121

// @kern-source: intent-types:125

// @kern-source: intent-types:128

// @kern-source: intent-types:130

// @kern-source: intent-types:132

// @kern-source: intent-types:133

// @kern-source: intent-types:136

