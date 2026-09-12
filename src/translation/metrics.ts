type Metric = { kind: string; durationMs: number; firstContentMs?: number; success: boolean; inputTokens?: number; outputTokens?: number; cachedTokens?: number; cacheWriteTokens?: number };
type Summary = { count: number; failures: number; p50Ms: number; p95Ms: number; reportedUsage: number;
  firstContentCount: number; firstContentP50Ms?: number; firstContentP95Ms?: number };
const samples: Metric[] = [];
const hits: Record<string, number> = {};
let sequence = 0;
const traceNames: string[] = [];
export function cacheHit(kind: string): void { hits[kind] = (hits[kind] ?? 0) + 1; }
export function readTranslationMetrics(): { samples: Metric[]; cacheHits: Record<string, number>; summary: Record<string, Summary> } {
  const summary: Record<string, Summary> = {};
  for (const kind of new Set(samples.map(sample => sample.kind))) {
    const group = samples.filter(sample => sample.kind === kind);
    const times = group.map(sample => sample.durationMs).sort((a, b) => a - b);
    const first = group.flatMap(sample => sample.firstContentMs === undefined ? [] : [sample.firstContentMs]).sort((a, b) => a - b);
    summary[kind] = { count: group.length, failures: group.filter(sample => !sample.success).length, p50Ms: times[Math.max(0, Math.ceil(times.length * .5) - 1)] ?? 0, p95Ms: times[Math.max(0, Math.ceil(times.length * .95) - 1)] ?? 0, reportedUsage: group.filter(sample => sample.inputTokens !== undefined).length,
      firstContentCount: first.length, ...(first.length ? { firstContentP50Ms: first[Math.ceil(first.length * .5) - 1] ?? 0, firstContentP95Ms: first[Math.ceil(first.length * .95) - 1] ?? 0 } : {}) };
  }
  return { samples: samples.map(value => ({ ...value })), cacheHits: { ...hits }, summary };
}
export function measureRequest(kind: string, info: Record<string, string | number | boolean> = {}): { content(): void; milestone(stage: string): void; usage(value: unknown): void; finish(success: boolean): void } {
  const start = Date.now(); let done = false;
  const clockStart = performance.now(); const id = ++sequence; const stages = new Set<string>();
  const milestone = (stage: string): void => {
    if (stages.has(stage)) return; stages.add(stage);
    const name = `forum-translater:${kind}:${id}:${stage}`;
    try {
      performance.measure(name, { start: clockStart, end: performance.now(), detail: info });
      traceNames.push(name); if (traceNames.length > 300) performance.clearMeasures(traceNames.shift());
    } catch { /* Timing visibility must not affect translation. */ }
  };
  milestone('start');
  const sample: Metric = { kind, durationMs: 0, success: false };
  const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  return {
    content: () => { sample.firstContentMs ??= Date.now() - start; milestone('first-content'); },
    milestone,
    usage: value => {
      if (!value || typeof value !== 'object') return;
      const usage = value as Record<string, unknown>;
      if (number(usage.input_tokens)) sample.inputTokens = usage.input_tokens;
      if (number(usage.output_tokens)) sample.outputTokens = usage.output_tokens;
      const details = usage.input_tokens_details;
      if (details && typeof details === 'object') {
        const record = details as Record<string, unknown>;
        if (number(record.cached_tokens)) sample.cachedTokens = record.cached_tokens;
        if (number(record.cache_write_tokens)) sample.cacheWriteTokens = record.cache_write_tokens;
      }
    },
    finish: success => {
      if (done) return; done = true; sample.success = success; sample.durationMs = Date.now() - start;
      milestone(success ? 'complete' : 'failed');
      samples.push(sample); if (samples.length > 200) samples.shift();
    },
  };
}
