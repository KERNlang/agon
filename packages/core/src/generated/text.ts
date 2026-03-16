export function wordWrap(text: string, width: number): string[] {
  const result: string[] = [];
  for (const line of text.split('\n')) {
    if (line.length <= width) { result.push(line); continue; }
    let remaining = line;
    while (remaining.length > width) {
      let breakAt = remaining.lastIndexOf(' ', width);
      if (breakAt <= 0) breakAt = width;
      result.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt).trimStart();
    }
    if (remaining) result.push(remaining);
  }
  return result;
  
}

