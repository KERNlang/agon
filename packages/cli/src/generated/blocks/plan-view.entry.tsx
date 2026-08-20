#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { PlanExecutionView } from './plan-view.js';

const app = render(<PlanExecutionView />);
await app.waitUntilExit();