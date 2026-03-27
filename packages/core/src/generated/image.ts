import { existsSync } from 'node:fs';

import { resolve, basename, extname } from 'node:path';

import { homedir } from 'node:os';

import type { ImageAttachment } from './types.js';

export const IMAGE_EXTENSIONS: Set<string> = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);

export const MIME_MAP: Record<string,string> = ({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
});

export const IMAGE_PATH_REGEX: RegExp = /(?:^|\s)((?:\/[\w.\-]+)+\.(?:png|jpe?g|gif|webp|svg|bmp)|~\/[\w.\-\/]+\.(?:png|jpe?g|gif|webp|svg|bmp)|\.{1,2}\/[\w.\-\/]+\.(?:png|jpe?g|gif|webp|svg|bmp))/gi;

export const IMG_CMD_REGEX: RegExp = /^\/img\s+(.+)$/i;

export function isImagePath(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
  
}

export function mimeFromExt(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
  
}

export function resolveImagePath(rawPath: string, cwd: string): string|null {
  let resolved: string;
  if (rawPath.startsWith('~/')) {
    resolved = resolve(homedir(), rawPath.slice(2));
  } else if (rawPath.startsWith('/')) {
    resolved = resolve(rawPath);
  } else {
    resolved = resolve(cwd, rawPath);
  }
  return existsSync(resolved) ? resolved : null;
  
}

export function buildImageAttachment(rawPath: string, cwd: string): ImageAttachment|null {
  const resolved = resolveImagePath(rawPath.trim(), cwd);
  if (!resolved) return null;
  return {
    path: resolved,
    filename: basename(resolved),
    mimeType: mimeFromExt(resolved),
  };
  
}

export function extractImagesFromInput(input: string, cwd: string): {text:string, images:ImageAttachment[]} {
  const images: ImageAttachment[] = [];
  
  // Handle /img <path> command
  const imgCmdMatch = IMG_CMD_REGEX.exec(input.trim());
  if (imgCmdMatch) {
    const att = buildImageAttachment(imgCmdMatch[1], cwd);
    if (att) images.push(att);
    return { text: '', images };
  }
  
  // Detect image paths in mixed text
  let text = input;
  const pathRegex = new RegExp(IMAGE_PATH_REGEX.source, 'gi');
  let match: RegExpExecArray | null;
  const paths: string[] = [];
  
  while ((match = pathRegex.exec(input)) !== null) {
    const rawPath = match[1].trim();
    const att = buildImageAttachment(rawPath, cwd);
    if (att) {
      images.push(att);
      paths.push(match[0]);
    }
  }
  
  for (const p of paths) {
    text = text.replace(p, '');
  }
  text = text.replace(/\s{2,}/g, ' ').trim();
  
  return { text, images };
  
}

