// @kern-source: skill-loader:1
import { readFileSync, readdirSync, existsSync } from 'node:fs';

// @kern-source: skill-loader:2
import { join } from 'node:path';

// @kern-source: skill-loader:3
import { AGON_HOME } from './config.js';

// @kern-source: skill-loader:5
export interface Skill {
  name: string;
  trigger: string;
  description: string;
  prompt: string;
  engines?: string[];
  source: string;
  handler?: ((args: string, ctx: any) => Promise<{ handled: boolean }>);
  tools?: string[];
}

// @kern-source: skill-loader:15
export function parseFrontmatter(content: string): {meta:Record<string,string>, body:string} {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      meta[key] = val;
    }
  }
  return { meta, body: match[2].trim() };
}

// @kern-source: skill-loader:31
export function loadSkillFile(filePath: string): Skill|null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const { meta, body } = parseFrontmatter(content);
    if (!meta.name || !meta.trigger) return null;
    return {
      name: meta.name,
      trigger: meta.trigger.startsWith('/') ? meta.trigger : `/${meta.trigger}`,
      description: meta.description ?? '',
      prompt: body,
      engines: meta.engines ? meta.engines.split(',').map((e: string) => e.trim()) : undefined,
      source: filePath,
    };
  } catch (err) {
    console.warn(`[agon] failed to load skill ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// @kern-source: skill-loader:51
export function loadSkills(): Skill[] {
  const skillsDir = join(AGON_HOME, 'skills');
  const skills: Skill[] = [];
  
  if (!existsSync(skillsDir)) return skills;
  
  try {
    const files = readdirSync(skillsDir).filter((f: string) => f.endsWith('.md'));
    for (const file of files) {
      const skill = loadSkillFile(join(skillsDir, file));
      if (skill) skills.push(skill);
    }
  } catch (err) {
    console.warn(`[agon] failed to scan skills dir: ${err instanceof Error ? err.message : String(err)}`);
  }
  
  return skills;
}

// @kern-source: skill-loader:71
export function findSkill(trigger: string, skills: Skill[]): Skill|null {
  const normalized = trigger.startsWith('/') ? trigger : `/${trigger}`;
  return skills.find((s) => s.trigger === normalized) ?? null;
}

// @kern-source: skill-loader:77
export function renderSkillPrompt(skill: Skill, input: string): string {
  return skill.prompt
    .replace(/\{input\}/g, input)
    .replace(/\{trigger\}/g, skill.trigger)
    .replace(/\{name\}/g, skill.name);
}

