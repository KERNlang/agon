#!/usr/bin/env node
// Agon Orchestration MCP Server — entry point
// Spawned by companion engines (Codex, Gemini, OpenCode) to expose
// Tribunal, Brainstorm, Campfire, Forge, etc. as MCP tools.

import { startMcpServer } from './generated/agon-orchestration.js';

startMcpServer();
