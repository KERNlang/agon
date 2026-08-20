#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { AnsiLine } from './rendering.js';

const app = render(<AnsiLine />);
await app.waitUntilExit();