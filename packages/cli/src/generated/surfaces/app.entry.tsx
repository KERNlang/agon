#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { App } from './app.js';

const app = render(<App />);
await app.waitUntilExit();