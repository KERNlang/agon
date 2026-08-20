#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { CesarStatusStrip } from './status.js';

const app = render(<CesarStatusStrip />);
await app.waitUntilExit();