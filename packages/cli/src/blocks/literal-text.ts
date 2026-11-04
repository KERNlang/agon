/** Escape untrusted text for literal terminal display, not for storage or
 * execution. Preserve line boundaries and distinguish real escapes from
 * backslash text. Non-ASCII spaces and invisible format characters stay visible. */
export function escapeLiteralText(content: string): string {
  return Array.from(content, char => {
    if (char === '\n' || char === ' ') return char;
    if (char === '\\') return '\\\\';
    if (char === '\t') return '\\t';
    const point = char.codePointAt(0)!;
    if (point < 32 || (point >= 127 && point <= 159)) return `\\x${point.toString(16).padStart(2, '0')}`;
    if (point === 0x2800 || /[\p{C}\p{M}\p{Default_Ignorable_Code_Point}\p{Z}]/u.test(char)) {
      return point <= 0xffff ? `\\u${point.toString(16).padStart(4, '0')}` : `\\u{${point.toString(16)}}`;
    }
    return char;
  }).join('');
}
