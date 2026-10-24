/** Settings owned by @kernlang/agon-support-browser-bridge. */
export interface BrowserSettings {
  browserExtensionIds: string[];
}

export const DEFAULT_BROWSER_SETTINGS: Required<BrowserSettings> = {
  browserExtensionIds: [],
};

export function normalizeBrowserSettings(settings: BrowserSettings): void {
  if (!Array.isArray(settings.browserExtensionIds)) settings.browserExtensionIds = [];
}
