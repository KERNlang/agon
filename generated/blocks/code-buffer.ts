// @kern-source: code-buffer:1
export interface CodeBlock {
  index: number;
  language: string;
  code: string;
}

// @kern-source: code-buffer:6
export class CodeBlockBuffer {
  blocks: CodeBlock[] = [];

  push(language: string, code: string): number {
    const index = this.blocks.length + 1;
    this.blocks.push({ index: index, language: language, code: code });
    return index;
  }

  get(index: number): CodeBlock|null {
    return this.blocks.find(b => b.index === index) ?? null;
  }

  clear(): void {
    this.blocks = [];
  }

  recordFromSegments(segments: Array<{type:string, language?:string, code?:string}>): void {
    for (const seg of segments) {
      if (seg.type === 'code' && seg.code) {
        this.push(seg.language ?? '', seg.code);
      }
    }
  }
}

