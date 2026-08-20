#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { PromptTextInput } from './prompt-input.js';

const app = render(<PromptTextInput />);
await app.waitUntilExit();