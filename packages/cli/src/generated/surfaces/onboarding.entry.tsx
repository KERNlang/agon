#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { Onboarding } from './onboarding.js';

const app = render(<Onboarding />);
await app.waitUntilExit();