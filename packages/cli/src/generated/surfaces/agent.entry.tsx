#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { AgentProgressView } from './agent.js';

const app = render(<AgentProgressView />);
await app.waitUntilExit();