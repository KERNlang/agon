/** Engine settings retained across the legacy and modular hosts. */
export interface EngineSettings {
  forgeDispatchTimeout?: number;
  reviewDefaultEngine?: string;
  engineActivationMode?: 'auto'|'explicit';
  forgeEnabledEngines?: string[];
  forgeJudgeEngine?: string;
  cesarEngine?: string;
  hiddenEngines: string[];
  removedEngines: string[];
  engineModels: Record<string,string>;
  engineEfforts: Record<string,string>;
  engineIsolation?: 'workspace-pure'|'inherit';
  ratingsPurgeKeepEngines?: string[];
  commitCoAuthor?: string;
}

export const DEFAULT_ENGINE_SETTINGS: Required<EngineSettings> = {
  forgeDispatchTimeout: 480,
  reviewDefaultEngine: '',
  engineActivationMode: 'auto',
  forgeEnabledEngines: ['claude', 'codex', 'agy'],
  forgeJudgeEngine: '',
  cesarEngine: 'claude',
  hiddenEngines: [],
  removedEngines: [],
  engineModels: {},
  engineEfforts: {},
  engineIsolation: 'workspace-pure',
  ratingsPurgeKeepEngines: [],
  commitCoAuthor: 'agon (KERN) <292465531+KERN-Agon@users.noreply.github.com>',
};

/** Preserve existing normalization; do not add new coercion rules here. */
export function normalizeEngineSettings(settings: EngineSettings): void {
  if (!Array.isArray(settings.forgeEnabledEngines)) settings.forgeEnabledEngines = [];
  if (!Array.isArray(settings.hiddenEngines)) settings.hiddenEngines = [];
  if (!Array.isArray(settings.removedEngines)) settings.removedEngines = [];
  if (!['auto', 'explicit'].includes(String(settings.engineActivationMode))) settings.engineActivationMode = 'auto';
  if (!settings.engineModels || typeof settings.engineModels === 'string') settings.engineModels = {};
}
