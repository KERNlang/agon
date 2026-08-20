/**
 * Ensure patch content ends with a trailing newline so git-apply never chokes.
 */
export function normalizePatchContent(patchContent: string): string {
  if (!patchContent.trim()) {
    return patchContent;
  }
  return patchContent.endsWith('\n') ? patchContent : `${patchContent}\n`;
}

/** Ensure patch content ends with a trailing newline so git-apply never chokes. */
