// @kern-source: agent-guide:8
import { defineCommand } from 'citty';

// @kern-source: agent-guide:9
import { agentGuideMarkdown } from './agent-guide-text.js';

// @kern-source: agent-guide:11
export const agentGuideCommand: any = defineCommand({
  meta: {
    name: 'agent-guide',
    description: 'Print how to call agon — a compact overview for any external engine (Codex, Antigravity, Claude, OpenCode)',
  },
  args: {
    json: {
      type: 'boolean',
      description: 'Emit the mode list as JSON instead of markdown.',
    },
  },
  run({ args }) {
    if (args.json) {
      process.stdout.write(JSON.stringify({
        modes: [
          { name: 'forge', cmd: 'agon forge "<task>" -t "<test cmd>"', use: 'multiple valid approaches + a runnable test' },
          { name: 'brainstorm', cmd: 'agon brainstorm "<question>"', use: 'cheap second opinion / ideas' },
          { name: 'tribunal', cmd: 'agon tribunal "<question>" --mode adversarial', use: 'decisions with real tradeoffs' },
          { name: 'campfire', cmd: 'agon campfire "<topic>"', use: 'open exploration, no winner' },
          { name: 'review', cmd: 'agon review uncommitted', use: 'multi-engine code review' },
          { name: 'goal', cmd: 'agon goal "<intent>" --queue <dir|.jsonl> --gate "<test cmd>"', use: 'autonomously drive a task queue to completion (build->review->fix->commit per task); long-running' },
        ],
        flags: ['--engines claude,codex,agy', '--timeout <sec>'],
        machineReadable: 'agon call <mode> "<input>" [flags] --jsonl',
        results: { lastDir: 'agon last', summary: 'cat "$(agon last)/summary.json"', status: 'agon last --status' },
      }, null, 2) + '\n');
      return;
    }
    process.stdout.write(agentGuideMarkdown() + '\n');
  },
});

