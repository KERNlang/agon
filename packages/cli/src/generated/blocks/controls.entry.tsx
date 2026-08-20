#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { CesarPicker } from './controls.js';

const app = render(<CesarPicker />);
await app.waitUntilExit();