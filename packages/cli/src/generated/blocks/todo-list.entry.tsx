#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { TodoList } from './todo-list.js';

const app = render(<TodoList />);
await app.waitUntilExit();