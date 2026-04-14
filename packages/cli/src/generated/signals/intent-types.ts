// @kern-source: intent-types:1
export type Intent =
  | { type: 'forge'; task: string; fitnessCmd: string | null }
  | { type: 'brainstorm'; question: string }
  | { type: 'tribunal'; question: string; tribunalMode?: string }
  | { type: 'team-tribunal'; question: string; tribunalMode?: string; membersPerSide?: number }
  | { type: 'team-forge'; task: string; fitnessCmd: string | null; membersPerSide?: number }
  | { type: 'team-brainstorm'; question: string; membersPerSide?: number }
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
  | { type: 'review'; target?: string; engineId?: string }
  | { type: 'run'; input: string }
  | { type: 'cesar'; engineIds: string[] }
  | { type: 'commit'; input?: string }
  | { type: 'undo' }
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
  | { type: 'auto'; input: string; taskClass: 'code' | 'question' | 'ambiguous' }
  | { type: 'mcp'; action: 'connect'|'disconnect'|'list'; server?: string }
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

// @kern-source: intent-types:24

// @kern-source: intent-types:25

// @kern-source: intent-types:29

// @kern-source: intent-types:31

// @kern-source: intent-types:34

// @kern-source: intent-types:36

// @kern-source: intent-types:37

// @kern-source: intent-types:38

// @kern-source: intent-types:40

// @kern-source: intent-types:41

// @kern-source: intent-types:42

// @kern-source: intent-types:43

// @kern-source: intent-types:44

// @kern-source: intent-types:46

// @kern-source: intent-types:48

// @kern-source: intent-types:51

// @kern-source: intent-types:52

// @kern-source: intent-types:55

// @kern-source: intent-types:57

// @kern-source: intent-types:58

// @kern-source: intent-types:59

// @kern-source: intent-types:61

// @kern-source: intent-types:63

// @kern-source: intent-types:65

// @kern-source: intent-types:68

// @kern-source: intent-types:72

// @kern-source: intent-types:77

// @kern-source: intent-types:80

// @kern-source: intent-types:83

// @kern-source: intent-types:85

// @kern-source: intent-types:87

// @kern-source: intent-types:89

// @kern-source: intent-types:90

// @kern-source: intent-types:91

// @kern-source: intent-types:93

// @kern-source: intent-types:94

// @kern-source: intent-types:95

// @kern-source: intent-types:97

// @kern-source: intent-types:100

// @kern-source: intent-types:103

// @kern-source: intent-types:107

// @kern-source: intent-types:108

// @kern-source: intent-types:109

// @kern-source: intent-types:110

// @kern-source: intent-types:111

// @kern-source: intent-types:114

// @kern-source: intent-types:117

// @kern-source: intent-types:119

// @kern-source: intent-types:120

// @kern-source: intent-types:123

