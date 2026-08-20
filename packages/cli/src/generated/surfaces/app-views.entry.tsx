#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { BottomChromeSection } from './app-views.js';

const app = render(<BottomChromeSection />);
await app.waitUntilExit();