// NOTE: no `#!/usr/bin/env node` shebang here on purpose. This entry is bundled
// into the cli package (cli/dist/mcp/index.js) by cli's tsup, whose `banner`
// already prepends the shebang — a second one here lands on line 2 of the bundle
// and is a hard SyntaxError. The server is always spawned via `node <path>`
// (see resolveAgonMcpServerPath / the agon-orchestration mcpServer config), so it
// never needs to be directly executable.
// Agon Orchestration MCP Server — entry point
// Spawned by companion engines (Codex, Gemini, OpenCode) to expose
// Tribunal, Brainstorm, Campfire, Forge, etc. as MCP tools.

import { startMcpServer } from './generated/agon-orchestration.js';

startMcpServer();
