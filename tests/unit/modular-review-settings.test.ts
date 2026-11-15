import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadConfig } from '@kernlang/agon-core';
import { selectModSettings } from '../../packages/mod-kernel/src/mod-settings.js';

const previousHome = process.env.AGON_HOME;
const dirs: string[] = [];
afterEach(() => {
  if (previousHome === undefined) delete process.env.AGON_HOME;
  else process.env.AGON_HOME = previousHome;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('reviewFileContext=false reaches the review mod instead of being dropped by namespace selection', () => {
  const home = mkdtempSync(join(tmpdir(), 'agon-review-settings-home-'));
  const project = mkdtempSync(join(tmpdir(), 'agon-review-settings-project-'));
  dirs.push(home, project);
  process.env.AGON_HOME = home;
  writeFileSync(join(home, 'config.json'), JSON.stringify({ reviewFileContext: false }));
  expect(selectModSettings(loadConfig(project), 'agon.review')).toMatchObject({ reviewFileContext: false });
});

it('drops the reviewMaxTrees and reviewContextMaxChars budgets on the way to the review mod', () => {
  const home = mkdtempSync(join(tmpdir(), 'agon-review-settings-home-'));
  const project = mkdtempSync(join(tmpdir(), 'agon-review-settings-project-'));
  dirs.push(home, project);
  process.env.AGON_HOME = home;
  writeFileSync(join(home, 'config.json'), JSON.stringify({ reviewMaxTrees: 3, reviewContextMaxChars: 500 }));
  expect(selectModSettings(loadConfig(project), 'agon.review')).toMatchObject({ reviewMaxTrees: 3, reviewContextMaxChars: 500 });
});
