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

// @kern-source: intent-types:66

// @kern-source: intent-types:69

// @kern-source: intent-types:71

// @kern-source: intent-types:73

// @kern-source: intent-types:75

// @kern-source: intent-types:76

// @kern-source: intent-types:77

// @kern-source: intent-types:79

// @kern-source: intent-types:80

// @kern-source: intent-types:81

// @kern-source: intent-types:83

// @kern-source: intent-types:86

// @kern-source: intent-types:89

// @kern-source: intent-types:93

// @kern-source: intent-types:94

// @kern-source: intent-types:95

// @kern-source: intent-types:96

// @kern-source: intent-types:97

// @kern-source: intent-types:100

// @kern-source: intent-types:103

// @kern-source: intent-types:105

// @kern-source: intent-types:106

// @kern-source: intent-types:109

