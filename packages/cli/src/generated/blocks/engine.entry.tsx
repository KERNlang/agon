#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { BidGroup } from './engine.js';

const app = render(<BidGroup />);
await app.waitUntilExit();