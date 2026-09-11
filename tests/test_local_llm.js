/**
 * TabSum - OpenAI-compatible (local LLM) summarization tier
 * Mocks fetch to verify request shape, SSE stream parsing across chunk boundaries,
 * non-streaming replies with <think> blocks, and fallback on server errors.
 */

import assert from 'node:assert';
import { summarizeContent } from '../src/ai/summarizer.js';

console.log('--- Running TabSum Local LLM (OpenAI-compatible) Tests ---');

const article = {
  title: 'How Bloom Filters Work',
  domain: 'example.com',
  meta: {},
  isLowConfidence: false,
  cleanText: 'A Bloom filter is a probabilistic data structure for set membership. '.repeat(20)
};
const settings = {
  aiProvider: 'openai-compatible',
  openaiBaseUrl: 'http://localhost:11434/v1/',
  openaiModel: 'llama3.2',
  openaiApiKey: 'local-key'
};
const reply = { tldr: 'Bloom filters trade certainty for space.', bullets: ['No false negatives'], tags: ['#Data Structures'] };

function sseResponse(text, tail = ': keep-alive\n\ndata: [DONE]\n\n') {
  // Split the SSE payload at awkward offsets so chunk boundaries fall mid-line
  const events = [...text].map(ch => `data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`).join('')
    + tail;
  const chunks = events.match(/[\s\S]{1,7}/g);
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    }
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

let lastRequest;
const realFetch = globalThis.fetch;
function mockFetch(makeResponse) {
  globalThis.fetch = async (url, init) => {
    lastRequest = { url, init, body: JSON.parse(init.body) };
    return makeResponse();
  };
}

// 1. Streaming reply
mockFetch(() => sseResponse(`Sure! ${JSON.stringify(reply)}`));
let summary = await summarizeContent(article, settings);
assert.strictEqual(lastRequest.url, 'http://localhost:11434/v1/chat/completions', 'Trailing slash normalized');
assert.strictEqual(lastRequest.init.headers.Authorization, 'Bearer local-key');
assert.strictEqual(lastRequest.body.model, 'llama3.2');
assert.strictEqual(lastRequest.body.stream, true);
assert.strictEqual(summary.source, 'openai-compatible', 'Counts as an AI summary');
assert.strictEqual(summary.tldr, reply.tldr);
assert.deepStrictEqual(summary.tags, ['Data Structures'], 'Output normalized');
console.log('✓ Streaming SSE reply parsed across chunk boundaries');

// 1b. Stream closes without [DONE] and without a trailing newline on the last event
mockFetch(() => sseResponse(JSON.stringify(reply), `data: ${JSON.stringify({ choices: [{ delta: { content: ' ' } }] })}`));
summary = await summarizeContent(article, settings);
assert.strictEqual(summary.source, 'openai-compatible', 'Final unterminated event is not dropped');
assert.strictEqual(summary.tldr, reply.tldr);
console.log('✓ Stream ending mid-line is flushed at EOF');

// 2. Server ignores stream:true and returns JSON, reasoning model emits <think>
mockFetch(() => Response.json({
  choices: [{ message: { content: `<think>{"tldr": "wrong"}</think>\n${JSON.stringify(reply)}` } }]
}));
summary = await summarizeContent(article, { ...settings, openaiApiKey: '' });
assert.strictEqual(lastRequest.init.headers.Authorization, undefined, 'No key, no Authorization header');
assert.strictEqual(summary.tldr, reply.tldr, '<think> block ignored');
console.log('✓ Non-streaming reply with <think> block parsed');

// 3. Server error falls back to the heuristic tier
mockFetch(() => new Response('model not found', { status: 404 }));
const warn = console.warn;
console.warn = () => {};
summary = await summarizeContent(article, settings);
console.warn = warn;
assert.strictEqual(summary.source, 'heuristic');
console.log('✓ Endpoint error falls back to heuristics');

// 4. No model configured: the tier is skipped without a request
lastRequest = null;
summary = await summarizeContent(article, { ...settings, openaiModel: '' });
assert.strictEqual(lastRequest, null);
assert.strictEqual(summary.source, 'heuristic');
console.log('✓ Missing model skips the tier');

globalThis.fetch = realFetch;
console.log('--- Local LLM Tests Passed Successfully! ---');
