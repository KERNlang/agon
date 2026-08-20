#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { TribunalCourt } from './arena.js';

const app = render(<TribunalCourt />);
await app.waitUntilExit();