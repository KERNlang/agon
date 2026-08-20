// Ink runtime components vendored from @kernlang/terminal v4.5.0 when Agon
// stopped depending on the KERN toolchain. Hand-maintained here from now on.

export { AlternateScreen } from './alternate-screen.js';
export type { AlternateScreenProps } from './alternate-screen.js';
export { ScrollBox } from './scroll-box.js';
export type { ScrollBoxHandle, ScrollBoxProps } from './scroll-box.js';
export { acquireAltScreen, acquireRawMode, getAltScreenActiveCount } from './terminal-mode.js';
export type { AltScreenOps } from './terminal-mode.js';
