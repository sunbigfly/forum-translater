/** Scan only appended text; completed objects are parsed once, not on every token. */
export class JsonArrayStream {
  private source = '';
  private cursor = 0;
  private opened = false;
  private stopped = false;
  private depth = 0;
  private start = -1;
  private quoted = false;
  private escaped = false;
  private objects: unknown[] = [];
  push(chunk: string): readonly unknown[] {
    if (this.stopped) return this.objects;
    this.source += chunk;
    for (; this.cursor < this.source.length; this.cursor++) {
      const char = this.source[this.cursor];
      if (!this.opened) {
        if (/\s/.test(char ?? '')) continue;
        if (char !== '[') { this.stopped = true; break; }
        this.opened = true; continue;
      }
      if (this.quoted) { if (this.escaped) this.escaped = false; else if (char === '\\') this.escaped = true; else if (char === '"') this.quoted = false; continue; }
      if (char === '"') { this.quoted = true; continue; }
      if (char === '{') { if (this.depth++ === 0) this.start = this.cursor; }
      else if (char === '}' && this.depth > 0 && --this.depth === 0) {
        try { this.objects.push(JSON.parse(this.source.slice(this.start, this.cursor + 1)) as unknown); }
        catch { this.stopped = true; break; }
      } else if (char === ']' && this.depth === 0) { this.stopped = true; break; }
    }
    return this.objects;
  }
}
