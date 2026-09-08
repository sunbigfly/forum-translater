import { expect, it } from 'vitest';
import { measureRequest, readTranslationMetrics } from '../src/translation/metrics';
import { ResponseStreamDecoder } from '../src/translation/ai';

it('captures reported usage once and keeps missing usage distinct from zero', () => {
  const metric = measureRequest('metrics-test');
  const decoder = new ResponseStreamDecoder(() => metric.content(), usage => metric.usage(usage));
  decoder.push(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '[]' })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 1200, output_tokens: 40, input_tokens_details: { cached_tokens: 1024, cache_write_tokens: 0 } } } })}\n\n`, true);
  metric.finish(true); metric.finish(false);
  measureRequest('metrics-test').finish(false);
  const records = readTranslationMetrics().samples.filter(sample => sample.kind === 'metrics-test');
  expect(records).toHaveLength(2);
  expect(records[0]).toMatchObject({ success: true, inputTokens: 1200, outputTokens: 40, cachedTokens: 1024, cacheWriteTokens: 0 });
  expect(records[1]).not.toHaveProperty('cachedTokens');
  expect(readTranslationMetrics().summary['metrics-test']).toMatchObject({ count: 2, failures: 1, reportedUsage: 1 });
});
