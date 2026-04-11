/**
 * Aiel AI — Auto-Learner
 * Handles automated link discovery, URL content parsing, and content absorption.
 * Powers the "Feed AI" button with multi-source learning capabilities.
 */
const AielAutoLearner = (() => {
  'use strict';

  /* ── Rate limiting ──────────────────────────────────────────────────────── */

  const lastFetch = {};
  const MIN_INTERVAL_MS = 2500;
  let sessionFetches = 0;
  const MAX_SESSION_FETCHES = 40;

  const FETCH_TIMEOUT_MS = 12000;
  const MAX_ITEMS_PER_URL = 10;
  const REMOVE_SELECTORS = 'script,style,nav,footer,header,aside,iframe,noscript,.ad,.ads,.advertisement,.sidebar,.menu,.nav,[role="navigation"],[role="banner"]';

  /* Module-level stop words for keyword extraction */
  const STOP_WORDS = new Set(['a','an','the','is','are','was','were','to','of','in','for','on','with','at','by','from','and','or','but','it','this','that']);

  async function rateLimitedFetch(url, category) {
    if (sessionFetches >= MAX_SESSION_FETCHES) {
      throw new Error('Session fetch limit reached');
    }
    const now = Date.now();
    const last = lastFetch[category] || 0;
    const wait = Math.max(0, MIN_INTERVAL_MS - (now - last));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastFetch[category] = Date.now();
    sessionFetches++;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp;
    } finally {
      clearTimeout(timeout);
    }
  }

  /* ── Link Discovery Sources ─────────────────────────────────────────────── */

  /**
   * Fetch top stories from Hacker News.
   */
  async function fetchHackerNews(count) {
    count = count || 3;
    try {
      const resp = await rateLimitedFetch(
        'https://hacker-news.firebaseio.com/v0/topstories.json',
        'hackernews'
      );
      const ids = await resp.json();
      const items = [];
      const selected = ids.slice(0, count);

      for (const id of selected) {
        try {
          const storyResp = await rateLimitedFetch(
            `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
            'hackernews-item'
          );
          const story = await storyResp.json();
          if (story && story.title) {
            items.push(normalise({
              type: 'article',
              content: {
                title: story.title,
                summary: story.title + (story.text ? '. ' + stripHtml(story.text).slice(0, 500) : ''),
                description: `Hacker News story with ${story.score || 0} points`
              },
              source: `Hacker News (news.ycombinator.com)`,
              license: 'Public',
              keywords: extractKeywords(`${story.title} technology programming`)
            }));
          }
        } catch (_) { /* skip failed story */ }
      }
      return items;
    } catch (e) {
      emitEvent('error', { source: 'hackernews', error: e.message });
      return [];
    }
  }

  /**
   * Fetch articles from DEV.to.
   */
  async function fetchDevTo(count) {
    count = count || 3;
    try {
      const resp = await rateLimitedFetch(
        `https://dev.to/api/articles?per_page=${count}&top=7`,
        'devto'
      );
      const articles = await resp.json();
      return articles.map(a => normalise({
        type: 'article',
        content: {
          title: a.title,
          summary: a.description || a.title,
          description: `By ${a.user?.name || 'Unknown'} — ${a.readable_publish_date || ''}`
        },
        source: `DEV.to (dev.to)`,
        license: 'Public',
        keywords: extractKeywords(`${a.title} ${(a.tag_list || []).join(' ')} programming`)
      }));
    } catch (e) {
      emitEvent('error', { source: 'devto', error: e.message });
      return [];
    }
  }

  /**
   * Fetch questions from Stack Exchange API.
   */
  async function fetchStackOverflow(count) {
    count = count || 3;
    try {
      const resp = await rateLimitedFetch(
        `https://api.stackexchange.com/2.3/questions?order=desc&sort=hot&site=stackoverflow&pagesize=${count}&filter=withbody`,
        'stackoverflow'
      );
      const data = await resp.json();
      if (!data || !data.items) return [];

      return data.items.map(q => normalise({
        type: 'article',
        content: {
          title: decodeEntities(q.title),
          summary: stripHtml(q.body || '').slice(0, 600),
          description: `Stack Overflow — ${q.answer_count || 0} answers, score ${q.score || 0}`
        },
        source: 'Stack Overflow (stackoverflow.com)',
        license: 'CC BY-SA 4.0',
        keywords: extractKeywords(`${q.title} ${(q.tags || []).join(' ')} programming`)
      }));
    } catch (e) {
      emitEvent('error', { source: 'stackoverflow', error: e.message });
      return [];
    }
  }

  /* ── Browse & Learn (from multiple sources) ─────────────────────────────── */

  /**
   * Fetch from all discovery sources and ingest.
   * @returns {Promise<{total: number, sources: Object}>}
   */
  async function browseAndLearn() {
    emitEvent('started', { mode: 'browse' });

    const results = { total: 0, sources: {} };
    const fetchers = [
      { name: 'Hacker News', fn: () => fetchHackerNews(2) },
      { name: 'DEV.to', fn: () => fetchDevTo(2) },
      { name: 'Stack Overflow', fn: () => fetchStackOverflow(2) },
      { name: 'Wikipedia', fn: () => fetchWikipedia() },
      { name: 'Trivia', fn: () => fetchTrivia() }
    ];

    for (const fetcher of fetchers) {
      try {
        const items = await fetcher.fn();
        if (items && items.length > 0) {
          const ingested = await ingestItems(items);
          results.sources[fetcher.name] = ingested;
          results.total += ingested;
          emitEvent('item', {
            source: fetcher.name,
            count: ingested,
            preview: items[0]?.content?.title || 'Unknown'
          });
        }
      } catch (_) {
        results.sources[fetcher.name] = 0;
      }
    }

    emitEvent('complete', { total: results.total, sources: results.sources });
    return results;
  }

  /* Reuse existing data-fetcher sources */
  async function fetchWikipedia() {
    if (typeof AielDataFetcher === 'undefined') return [];
    try {
      const article = await AielDataFetcher.fetchWikipediaSummary('random');
      return article ? [article] : [];
    } catch (_) { return []; }
  }

  async function fetchTrivia() {
    if (typeof AielDataFetcher === 'undefined') return [];
    try {
      return await AielDataFetcher.fetchTrivia(null, 3);
    } catch (_) { return []; }
  }

  /* ── Learn from URL ─────────────────────────────────────────────────────── */

  /**
   * Attempt to learn from a user-provided URL.
   * @param {string} url
   * @returns {Promise<{success: boolean, count: number, error?: string}>}
   */
  async function learnFromURL(url) {
    if (!url || typeof url !== 'string') {
      return { success: false, count: 0, error: 'Invalid URL' };
    }

    /* Basic URL validation */
    let parsed;
    try {
      parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { success: false, count: 0, error: 'Only HTTP(S) URLs are supported' };
      }
    } catch (_) {
      return { success: false, count: 0, error: 'Invalid URL format' };
    }

    emitEvent('started', { mode: 'url', url });

    try {
      /* Try direct fetch first */
      let html;
      try {
        const resp = await rateLimitedFetch(url, 'user-url');
        html = await resp.text();
      } catch (_) {
        /* Try CORS proxy fallback */
        try {
          const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
          const proxyResp = await rateLimitedFetch(proxyUrl, 'cors-proxy');
          const proxyData = await proxyResp.json();
          if (!proxyData || typeof proxyData.contents !== 'string') {
            return { success: false, count: 0, error: 'CORS proxy returned invalid data' };
          }
          html = proxyData.contents;
        } catch (proxyErr) {
          return { success: false, count: 0, error: 'Cannot access URL (CORS blocked)' };
        }
      }

      /* Parse HTML content */
      const content = parseHtmlContent(html, parsed.hostname);
      if (!content || !content.text || content.text.length < 50) {
        return { success: false, count: 0, error: 'Could not extract meaningful content' };
      }

      /* Generate knowledge items from parsed content */
      const items = generateItemsFromContent(content, url);
      const ingested = await ingestItems(items);

      emitEvent('complete', { total: ingested, url });
      return { success: true, count: ingested };

    } catch (e) {
      emitEvent('error', { source: 'url', error: e.message });
      return { success: false, count: 0, error: e.message };
    }
  }

  /* ── HTML Parsing ───────────────────────────────────────────────────────── */

  function parseHtmlContent(html, hostname) {
    if (!html) return null;

    /* Use DOMParser in a safe way */
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    /* Remove scripts, styles, nav, footer, ads */
    doc.querySelectorAll(REMOVE_SELECTORS).forEach(el => el.remove());

    /* Extract title */
    const title = doc.querySelector('title')?.textContent?.trim()
      || doc.querySelector('h1')?.textContent?.trim()
      || hostname;

    /* Extract headings */
    const headings = [];
    doc.querySelectorAll('h1,h2,h3').forEach(h => {
      const text = h.textContent?.trim();
      if (text && text.length > 3 && text.length < 200) headings.push(text);
    });

    /* Extract paragraphs */
    const paragraphs = [];
    doc.querySelectorAll('p').forEach(p => {
      const text = p.textContent?.trim();
      if (text && text.length > 30) paragraphs.push(text);
    });

    /* Extract list items */
    const listItems = [];
    doc.querySelectorAll('li').forEach(li => {
      const text = li.textContent?.trim();
      if (text && text.length > 10 && text.length < 300) listItems.push(text);
    });

    /* Combine text */
    const allText = [...paragraphs, ...listItems.slice(0, 10)].join('\n\n');

    return {
      title,
      headings: headings.slice(0, 10),
      text: allText.slice(0, 5000),
      paragraphs: paragraphs.slice(0, 20),
      hostname
    };
  }

  function generateItemsFromContent(content, sourceUrl) {
    const items = [];
    const hashFn = typeof AielDataFetcher !== 'undefined'
      ? AielDataFetcher.simpleHash
      : simpleHash;

    /* Main article item */
    if (content.text.length > 50) {
      const summary = content.paragraphs.slice(0, 3).join('\n\n');
      items.push(normalise({
        type: 'article',
        content: {
          title: content.title,
          summary: summary.slice(0, 1500),
          description: `Learned from ${content.hostname}`
        },
        source: sourceUrl,
        license: 'Web Content',
        keywords: extractKeywords(`${content.title} ${content.headings.join(' ')}`)
      }));
    }

    /* Generate Q&A pairs from headings + paragraphs */
    content.headings.forEach((heading, i) => {
      const para = content.paragraphs[i];
      if (para && para.length > 50) {
        items.push(normalise({
          type: 'article',
          content: {
            title: heading,
            summary: para.slice(0, 800),
            description: `Section from ${content.hostname}`
          },
          source: sourceUrl,
          license: 'Web Content',
          keywords: extractKeywords(heading)
        }));
      }
    });

    return items.slice(0, MAX_ITEMS_PER_URL);
  }

  /* ── Ingestion helper ───────────────────────────────────────────────────── */

  async function ingestItems(items) {
    if (!Array.isArray(items) || items.length === 0) return 0;

    if (typeof AielKnowledgeIngestor !== 'undefined') {
      const count = await AielKnowledgeIngestor.ingestBatch(items);

      /* Notify mood system */
      if (typeof AielMood !== 'undefined') {
        for (let i = 0; i < count; i++) {
          AielMood.onItemLearned(items[i] || {});
        }
        if (count === 0 && items.length > 0) {
          AielMood.onDuplicateSkipped();
        }
      }

      return count;
    }
    return 0;
  }

  /* ── Helpers ────────────────────────────────────────────────────────────── */

  function normalise(item) {
    const hashFn = typeof AielDataFetcher !== 'undefined'
      ? AielDataFetcher.simpleHash
      : simpleHash;
    return {
      ...item,
      timestamp: Date.now(),
      hash: hashFn(JSON.stringify(item.content))
    };
  }

  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return hash;
  }

  function extractKeywords(text) {
    if (typeof AielDataFetcher !== 'undefined' && AielDataFetcher.extractKeywordsFromText) {
      return AielDataFetcher.extractKeywordsFromText(text);
    }
    return text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
      .filter((w, i, arr) => arr.indexOf(w) === i)
      .slice(0, 10);
  }

  function stripHtml(html) {
    if (typeof document !== 'undefined') {
      const div = document.createElement('div');
      div.innerHTML = html;
      return div.textContent || div.innerText || '';
    }
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function decodeEntities(str) {
    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.innerHTML = str;
      return textarea.value;
    }
    return str
      .replace(/&#039;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');
  }

  function emitEvent(type, detail) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(`aiel-learning-${type}`, { detail }));
    }
  }

  /* ── Status ─────────────────────────────────────────────────────────────── */

  function getStatus() {
    return {
      sessionFetches,
      maxFetches: MAX_SESSION_FETCHES,
      remaining: MAX_SESSION_FETCHES - sessionFetches
    };
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */

  return {
    fetchHackerNews,
    fetchDevTo,
    fetchStackOverflow,
    browseAndLearn,
    learnFromURL,
    getStatus
  };
})();

window.AielAutoLearner = AielAutoLearner;
