#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { ComposerView } from './composer.js';

const app = render(<ComposerView />);
await app.waitUntilExit();