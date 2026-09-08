/** Read completed objects from an unfinished JSON array without repairing model output. */
export function completedArrayObjects(source: string): unknown[] {
  if (!source.trimStart().startsWith('[')) return [];
  const result: unknown[] = []; let depth = 0; let start = -1; let quoted = false; let escaped = false;
  for (let index = source.indexOf('[') + 1; index < source.length; index++) {
    const char = source[index];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') { quoted = true; continue; }
    if (char === '{') { if (depth++ === 0) start = index; }
    else if (char === '}' && depth > 0 && --depth === 0) {
      try { result.push(JSON.parse(source.slice(start, index + 1)) as unknown); } catch { return result; }
    }
  }
  return result;
}
