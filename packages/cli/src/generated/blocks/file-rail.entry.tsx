#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { FileRail } from './file-rail.js';

const app = render(<FileRail />);
await app.waitUntilExit();