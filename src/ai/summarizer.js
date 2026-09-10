/**
 * TabSum - Multi-Tier Summarization Engine
 * Tier 0: Algorithmic Heuristics (Instant, 0ms, 100% offline, zero-config)
 * Tier 1: Chrome Built-in Prompt API (Gemini Nano on-device)
 * Tier 2: Gemini 1.5/2.0 Flash BYOK (Optional cloud API)
 */

/**
 * Main summarization dispatcher
 * @param {Object} extractedData { title, cleanText, meta, domain, wordCount }
 * @param {Object} settings { aiProvider, geminiApiKey }
 * @returns {Promise<{ tldr: string, bullets: string[], tags: string[] }>}
 */
export async function summarizeContent(extractedData, settings = {}) {
  const { cleanText, meta, title, domain, isLowConfidence } = extractedData;

  // Handle low-confidence pages (short landing pages, quick links)
  if (isLowConfidence || !cleanText || cleanText.length < 100) {
    const desc = meta?.description || '';
    return {
      tldr: desc || `Quick bookmark saved from ${domain}.`,
      bullets: [
        `Captured from ${domain}`,
        title || 'Untitled page'
      ],
      tags: generateTags(title, cleanText, domain)
    };
  }

  const provider = settings.aiProvider || 'auto';

  // 1. Try Gemini Flash BYOK if explicitly configured
  if (provider === 'gemini-api' && settings.geminiApiKey) {
    try {
      const result = await summarizeWithGeminiAPI(extractedData, settings.geminiApiKey);
      if (result) return result;
    } catch (err) {
      console.warn('Gemini API call failed, falling back to heuristic:', err);
    }
  }

  // 2. Try Chrome Built-in Prompt API if available
  if (provider === 'auto' || provider === 'prompt-api') {
    try {
      const nanoResult = await summarizeWithChromePromptAPI(extractedData);
      if (nanoResult) return nanoResult;
    } catch (err) {
      console.warn('Chrome Prompt API not available or failed:', err);
    }
  }

  // 3. Fallback: Tier 0 Algorithmic Heuristic Distillation
  return summarizeWithHeuristics(extractedData);
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

  // Tags
  const tags = generateTags(title, cleanText, domain);

  return {
    tldr: cleanUpSummaryText(tldr),
    bullets: bullets.map(b => cleanUpSummaryText(b)),
    tags
  };
}

/**
 * Generate semantic category tags using topic keyword clustering
 */
function generateTags(title = '', text = '', domain = '') {
  const tags = new Set();
  const corpus = `${title} ${domain} ${text.slice(0, 1500)}`.toLowerCase();

  const domainMap = {
    'github.com': 'Engineering',
    'stackoverflow.com': 'Dev',
    'medium.com': 'Articles',
    'nytimes.com': 'News',
    'theverge.com': 'Tech',
    'techcrunch.com': 'Startups',
    'arxiv.org': 'Research',
    'wikipedia.org': 'Reference',
    'youtube.com': 'Media'
  };

  if (domainMap[domain]) {
    tags.add(domainMap[domain]);
  }

  const topicKeywords = [
    { tag: 'AI', regex: /\b(ai|llm|gpt|machine learning|neural network|transformer|deep learning|agent)\b/i },
    { tag: 'Engineering', regex: /\b(architecture|api|database|backend|frontend|rust|python|typescript|golang|react|docker|kubernetes)\b/i },
    { tag: 'Design', regex: /\b(ui|ux|typography|design system|figma|css|layout|wireframe)\b/i },
    { tag: 'Productivity', regex: /\b(workflow|habit|efficiency|focus|time management|organization)\b/i },
    { tag: 'Business', regex: /\b(startup|revenue|growth|market|pricing|saas|venture|funding)\b/i },
    { tag: 'Science', regex: /\b(biology|physics|climate|genetics|astronomy|medicine|neuroscience)\b/i },
    { tag: 'Security', regex: /\b(vulnerability|encryption|auth|malware|cve|zero-day|privacy)\b/i }
  ];

  for (const item of topicKeywords) {
    if (item.regex.test(corpus)) {
      tags.add(item.tag);
    }
  }

  if (tags.size === 0) {
    tags.add('Reading');
  }

  return Array.from(tags).slice(0, 4);
}

/**
 * Tier 1: Chrome Prompt API (Gemini Nano)
 */
async function summarizeWithChromePromptAPI({ title, cleanText }) {
  const ai = globalThis.ai || globalThis.LanguageModel;
  if (!ai) return null;

  let session;
  if (ai.languageModel?.create) {
    session = await ai.languageModel.create({
      systemPrompt: 'You are an executive knowledge assistant. Given an article, return a concise JSON object with { "tldr": "1-2 sentence overview", "bullets": ["takeaway 1", "takeaway 2", "takeaway 3"], "tags": ["tag1", "tag2"] }'
    });
  } else if (typeof LanguageModel !== 'undefined') {
    session = await LanguageModel.create();
  }

  if (!session) return null;

  try {
    const prompt = `Title: ${title}\n\nArticle excerpt:\n${cleanText.slice(0, 3000)}\n\nProvide the summary JSON:`;
    const response = await session.prompt(prompt);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.tldr && Array.isArray(parsed.bullets)) {
        return {
          tldr: parsed.tldr,
          bullets: parsed.bullets.slice(0, 4),
          tags: parsed.tags || ['Article']
        };
      }
    }
  } catch (err) {
    console.debug('Chrome Prompt API execution error:', err);
  } finally {
    if (session && typeof session.destroy === 'function') {
      try { session.destroy(); } catch {}
    }
  }

  return null;
}

/**
 * Tier 2: Cloud Gemini API (Optional BYOK)
 */
async function summarizeWithGeminiAPI({ title, cleanText }, apiKey) {
  // Use header-based key delivery instead of URL query parameter to avoid logging exposure
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
  const prompt = `Summarize this web page into structured JSON with fields:
  "tldr": 1-2 sentence core message
  "bullets": array of 3 distinct key takeaways
  "tags": array of 2-3 topic tags

  Title: ${title}
  Content:
  ${cleanText.slice(0, 6000)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json'
      }
    })
  });

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status}`);
  }

  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) return null;

  const parsed = JSON.parse(rawText);
  return {
    tldr: parsed.tldr || '',
    bullets: parsed.bullets || [],
    tags: parsed.tags || []
  };
}

function cleanUpSummaryText(text) {
  if (!text) return '';
  return text.trim().replace(/^["']|["']$/g, '');
}
