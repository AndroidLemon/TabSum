/**
 * TabSum - Multi-Tier Summarization Engine
 * Tier 0: Algorithmic Heuristics (Instant, 0ms, 100% offline, zero-config)
 * Tier 1: Chrome Built-in Prompt API (Gemini Nano on-device, via LanguageModel)
 * Tier 2: Gemini Flash BYOK (Optional cloud API)
 */

import { withTimeout } from '../shared/with-timeout.js';

// Bound every AI call so a hung tier can't stall a sweep.
const TIER_TIMEOUT_MS = 20000;
// Local models on modest hardware can need minutes; that tier streams and keeps the worker alive.
const LOCAL_TIMEOUT_MS = 120000;

// https://ai.google.dev/gemini-api/docs/models - current stable Flash model.
// gemini-1.5-flash was retired; this is the id to bump when Google deprecates it again.
const GEMINI_MODEL = 'gemini-3.8-flash';

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    tldr: { type: 'string' },
    bullets: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } }
  },
  required: ['tldr', 'bullets', 'tags']
};

const SYSTEM_PROMPT =
  'You are an executive knowledge assistant. Given an article, respond with JSON: ' +
  '{ "tldr": "1-2 sentence overview", "bullets": ["takeaway 1", "takeaway 2", "takeaway 3"], "tags": ["tag1", "tag2"] }';

/**
 * Main summarization dispatcher
 * @param {Object} extractedData { title, cleanText, meta, domain, wordCount, isLowConfidence }
 * @param {Object} settings { aiProvider, geminiApiKey }
 * @returns {Promise<{ tldr: string, bullets: string[], tags: string[], source: 'gemini-api'|'openai-compatible'|'prompt-api'|'heuristic' }>}
 *   `source` says which tier wrote it; auto-close only trusts AI-written summaries.
 *   Only AI tiers produce tags; the heuristic tier returns `tags: []`.
 */
export async function summarizeContent(extractedData, settings = {}) {
  const { cleanText, meta, title, domain, isLowConfidence } = extractedData;

  // Handle low-confidence pages (short landing pages, quick links)
  if (isLowConfidence || !cleanText || cleanText.length < 100) {
    const desc = meta?.description || '';
    return {
      ...normalizeSummary({
        tldr: desc || `Quick bookmark saved from ${domain}.`,
        bullets: [],
        tags: []
      }),
      source: 'heuristic'
    };
  }

  const provider = settings.aiProvider || 'auto';
  const tiers = [];

  if (provider === 'gemini-api' && settings.geminiApiKey) {
    tiers.push({ source: 'gemini-api', run: () => summarizeWithGeminiAPI(extractedData, settings.geminiApiKey) });
  }
  if (provider === 'openai-compatible' && settings.openaiBaseUrl && settings.openaiModel) {
    tiers.push({
      source: 'openai-compatible',
      timeoutMs: LOCAL_TIMEOUT_MS,
      run: () => summarizeWithOpenAICompatible(extractedData, settings)
    });
  }
  if (provider === 'auto' || provider === 'prompt-api') {
    tiers.push({ source: 'prompt-api', run: () => summarizeWithChromePromptAPI(extractedData) });
  }

  for (const { source, run, timeoutMs = TIER_TIMEOUT_MS } of tiers) {
    try {
      const raw = await withTimeout(run(), timeoutMs, 'AI tier');
      const normalized = raw && normalizeSummary(raw);
      if (normalized?.tldr) return { ...normalized, source };
    } catch (err) {
      console.warn('AI tier failed, falling back:', err?.message || err);
    }
  }

  // Fallback: Tier 0 Algorithmic Heuristic Distillation
  return { ...normalizeSummary(summarizeWithHeuristics(extractedData)), source: 'heuristic' };
}

/**
 * Validate and coerce a raw summary (from any tier) into the canonical shape.
 */
export function normalizeSummary(raw) {
  if (!raw || typeof raw !== 'object') {
    return { tldr: '', bullets: [], tags: [] };
  }

  const tldr = typeof raw.tldr === 'string' ? raw.tldr.trim() : '';

  const bullets = Array.isArray(raw.bullets)
    ? raw.bullets.filter(b => typeof b === 'string').map(b => b.trim()).filter(Boolean).slice(0, 5)
    : [];

  const tags = [];
  const seen = new Set();
  if (Array.isArray(raw.tags)) {
    for (const t of raw.tags) {
      if (typeof t !== 'string') continue;
      const clean = t.trim().replace(/^#+\s*/, '');
      if (!clean || seen.has(clean.toLowerCase())) continue;
      seen.add(clean.toLowerCase());
      tags.push(clean);
      if (tags.length === 4) break;
    }
  }

  return { tldr, bullets, tags };
}

/**
 * Tier 0: Heuristic Extractive Summarizer
 */
export function summarizeWithHeuristics({ title, cleanText, meta, domain }) {
  const paragraphs = cleanText.split('\n\n').map(p => p.trim()).filter(Boolean);
  const sentences = [];

  // Split into sentences
  for (const para of paragraphs) {
    const rawSentences = para.match(/[^.!?]+[.!?]+/g) || [para];
    for (const s of rawSentences) {
      const clean = s.trim();
      if (clean.length > 25 && clean.length < 350) {
        sentences.push(clean);
      }
    }
  }

  // Score sentences
  const titleWords = (title || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const scored = sentences.map((sentence, index) => {
    let score = 0;
    const lower = sentence.toLowerCase();

    // Position score (earlier sentences in articles have higher information density)
    if (index === 0) score += 4;
    else if (index < 3) score += 2.5;
    else if (index < 8) score += 1.5;

    // Title word overlap
    for (const tw of titleWords) {
      if (lower.includes(tw)) score += 2;
    }

    // Key insight indicators
    if (/(in conclusion|importantly|crucially|demonstrates|reveals|results show|key takeaway|proves that|leads to)/i.test(sentence)) {
      score += 3;
    }

    // Length penalty: too short or run-on
    const wordCount = sentence.split(/\s+/).length;
    if (wordCount >= 14 && wordCount <= 35) {
      score += 1.5;
    }

    return { sentence, score, index };
  });

  // Pick top sentences for bullets
  scored.sort((a, b) => b.score - a.score);
  const topSentences = scored.slice(0, 4)
    .sort((a, b) => a.index - b.index)
    .map(item => item.sentence);

  // TL;DR: use meta description if clean and informative, else highest-scoring sentence
  let tldr = meta?.description;
  if (!tldr || tldr.length < 30 || tldr.includes('...')) {
    tldr = topSentences[0] || paragraphs[0] || title;
  }

  // Filter bullets to exclude the exact TL;DR sentence
  const bullets = topSentences
    .filter(s => s !== tldr)
    .slice(0, 3)
    .map(s => s.replace(/^[•\-\*]\s*/, ''));

  if (bullets.length === 0 && topSentences.length > 0) {
    bullets.push(topSentences[0]);
  }

  return {
    tldr: cleanUpSummaryText(tldr),
    bullets: bullets.map(b => cleanUpSummaryText(b)),
    tags: [] // tags come only from AI tiers
  };
}

/**
 * Prompt window by block, not by character. The harvest walks the DOM in order, so any
 * pre-article chrome the noise list misses sits ahead of the article; start one block
 * before the first real paragraph (>= 200 chars) so its heading survives, and take whole
 * blocks from there. With no real paragraph (HN front page) start at 0.
 */
export function excerpt(cleanText, maxChars) {
  const blocks = cleanText.split('\n\n');
  const first = blocks.findIndex(b => b.length >= 200);
  let text = '';
  for (const b of blocks.slice(Math.max(0, first - 1))) {
    if (text && text.length + 2 + b.length > maxChars) break;
    text += (text ? '\n\n' : '') + b;
  }
  return text.slice(0, maxChars);
}

/**
 * Tier 1: Chrome built-in Prompt API (Gemini Nano on-device)
 * https://developer.chrome.com/docs/ai/prompt-api
 */
async function summarizeWithChromePromptAPI({ title, cleanText }) {
  if (typeof LanguageModel === 'undefined') return null;

  let availability;
  try {
    availability = await LanguageModel.availability();
  } catch {
    return null;
  }
  // Only proceed when the model is already on-device; never kick off a
  // multi-gigabyte download from a background service worker.
  if (availability !== 'available') return null;

  const signal = AbortSignal.timeout(TIER_TIMEOUT_MS);
  let session;
  try {
    session = await LanguageModel.create({
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
      signal
    });

    const prompt = `Title: ${title}\n\nArticle excerpt:\n${excerpt(cleanText, 3000)}`;
    const response = await session.prompt(prompt, {
      responseConstraint: SUMMARY_SCHEMA,
      signal
    });

    return JSON.parse(response);
  } catch (err) {
    console.debug('Chrome Prompt API execution error:', err);
    return null;
  } finally {
    if (session && typeof session.destroy === 'function') {
      try { session.destroy(); } catch {}
    }
  }
}

/**
 * Tier 2: Cloud Gemini API (Optional BYOK)
 * https://ai.google.dev/api/generate-content
 */
async function summarizeWithGeminiAPI({ title, cleanText }, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const prompt = `Summarize this web page into structured JSON with fields:
  "tldr": 1-2 sentence core message
  "bullets": array of up to 5 distinct key takeaways
  "tags": array of up to 4 topic tags

  Title: ${title}
  Content:
  ${excerpt(cleanText, 6000)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Header-based key delivery instead of URL query parameter to avoid logging exposure
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        // responseSchema wants Gemini's uppercase OpenAPI types; this field takes plain JSON Schema
        responseJsonSchema: SUMMARY_SCHEMA
      }
    }),
    signal: AbortSignal.timeout(TIER_TIMEOUT_MS)
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.warn(`Gemini API error: ${res.status} ${errBody.slice(0, 300)}`);
    return null;
  }

  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) return null;

  return JSON.parse(rawText);
}

/**
 * Tier 3: any OpenAI-compatible /chat/completions endpoint (Ollama, LM Studio, llama.cpp
 * server, vLLM, ...). Two service-worker constraints shape this:
 *  - Chrome kills an extension worker whose fetch() takes >30s to start responding, so we
 *    stream (headers arrive immediately) instead of waiting for the full completion.
 *  - The worker also idles out after 30s without extension events/API calls, so we make a
 *    cheap API call every 20s while generating.
 * ponytail: no response_format - json_object/json_schema support varies across local
 * servers, so we prompt for JSON and extract it from the reply.
 */
async function summarizeWithOpenAICompatible({ title, cleanText }, settings) {
  const url = `${settings.openaiBaseUrl.trim().replace(/\/+$/, '')}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (settings.openaiApiKey) headers.Authorization = `Bearer ${settings.openaiApiKey}`;

  const keepAlive = setInterval(() => globalThis.chrome?.runtime?.getPlatformInfo?.(), 20000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: settings.openaiModel,
        stream: true,
        temperature: 0.2,
        messages: [
          { role: 'system', content: `${SYSTEM_PROMPT} Reply with the JSON object only.` },
          { role: 'user', content: `Title: ${title}\n\nArticle excerpt:\n${excerpt(cleanText, 6000)}` }
        ]
      }),
      signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS)
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`OpenAI-compatible endpoint error: ${res.status} ${errBody.slice(0, 300)}`);
      return null;
    }
    return parseJsonObject(await readChatCompletion(res));
  } finally {
    clearInterval(keepAlive);
  }
}

/**
 * Assistant text from a chat completion: an SSE stream of delta chunks, or a plain JSON
 * body from servers that ignore `stream: true`.
 */
async function readChatCompletion(res) {
  if (!(res.headers.get('content-type') || '').includes('text/event-stream')) {
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += done ? '\n' : value; // at EOF, flush a final event that had no trailing newline
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep a partial line for the next chunk
    for (const line of lines) {
      if (!line.startsWith('data:')) continue; // comments / keep-alives
      const data = line.slice(5).trim();
      if (data === '[DONE]') return text;
      try {
        text += JSON.parse(data).choices?.[0]?.delta?.content || '';
      } catch {
        // malformed chunk; skip it
      }
    }
    if (done) return text;
  }
}

/**
 * First {...} object in a model reply, ignoring <think> blocks from reasoning models.
 */
function parseJsonObject(text) {
  const match = text.replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : null;
}

function cleanUpSummaryText(text) {
  if (!text) return '';
  return text.trim().replace(/^["']|["']$/g, '');
}
