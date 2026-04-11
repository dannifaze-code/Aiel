/**
 * Aiel AI — Open Data Fetcher
 * Fetches open-source, free, unlicensed data from public APIs.
 * All sources are free, require no API key, and provide open/public-domain content.
 */
const AielDataFetcher = (() => {
  'use strict';

  /* ── Rate limiting ──────────────────────────────────────────────────────── */

  const lastFetch = {};
  const MIN_INTERVAL_MS = 2000; /* minimum ms between requests to same domain */

  async function rateLimitedFetch(url, category) {
    const now = Date.now();
    const last = lastFetch[category] || 0;
    const wait = Math.max(0, MIN_INTERVAL_MS - (now - last));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastFetch[category] = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  /* ── Data sources ───────────────────────────────────────────────────────── */

  /**
   * Fetch a random word definition from Free Dictionary API.
   * Uses a curated list of common English words to look up.
   */
  async function fetchRandomWords(count = 3) {
    const wordBank = [
      'algorithm','binary','compile','data','encrypt','function','graph',
      'hash','iterate','kernel','lambda','memory','node','object','parse',
      'query','recursion','stack','thread','variable','abstract','buffer',
      'cache','debug','element','framework','gateway','handler','index',
      'json','keystone','library','module','network','operator','protocol',
      'queue','runtime','socket','token','unicode','vector','widget',
      'xenon','yield','zenith','array','boolean','closure','delegate',
      'exception','filter','generic','heap','interface','join','loop',
      'mutex','namespace','overflow','pointer','register','schema',
      'tuple','union','virtual','wrapper','entropy','fractal','gradient',
      'hypothesis','inference','juxtapose','kinetic','logarithm','matrix',
      'neural','optimise','paradigm','quantum','resilience','syntax',
      'theorem','utility','velocity','wavelength','axiom','calculus',
      'derivative','exponent','fibonacci','geometry','integral','jacobian'
    ];

    const results = [];
    const chosen = shuffle(wordBank).slice(0, count);

    for (const word of chosen) {
      try {
        const data = await rateLimitedFetch(
          `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
          'dictionary'
        );
        if (data && data[0]) {
          const entry = data[0];
          const meanings = entry.meanings || [];
          const definitions = meanings.flatMap((m) =>
            (m.definitions || []).slice(0, 2).map((d) => ({
              partOfSpeech: m.partOfSpeech,
              definition: d.definition,
              example: d.example || null
            }))
          );
          results.push(normalise({
            type: 'definition',
            content: {
              word: entry.word,
              phonetic: entry.phonetic || '',
              definitions
            },
            source: 'Free Dictionary API (dictionaryapi.dev)',
            license: 'Public / Open',
            keywords: [entry.word, ...meanings.map((m) => m.partOfSpeech)].filter(Boolean)
          }));
        }
      } catch (_) { /* skip failed words */ }
    }
    return results;
  }

  /**
   * Fetch a Wikipedia article summary.
   */
  async function fetchWikipediaSummary(topic) {
    if (!topic) topic = 'random';
    const url = topic === 'random'
      ? 'https://en.wikipedia.org/api/rest_v1/page/random/summary'
      : `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;

    const data = await rateLimitedFetch(url, 'wikipedia');
    if (!data || !data.extract) return null;

    return normalise({
      type: 'article',
      content: {
        title: data.title,
        summary: data.extract,
        description: data.description || ''
      },
      source: `Wikipedia (${data.content_urls?.desktop?.page || 'en.wikipedia.org'})`,
      license: 'CC BY-SA 3.0',
      keywords: extractKeywordsFromText(`${data.title} ${data.description || ''} ${data.extract}`)
    });
  }

  /**
   * Fetch trivia Q&A pairs from Open Trivia Database.
   */
  async function fetchTrivia(category, count = 5) {
    let url = `https://opentdb.com/api.php?amount=${count}&type=multiple`;
    if (category) url += `&category=${category}`;

    const data = await rateLimitedFetch(url, 'trivia');
    if (!data || !data.results) return [];

    return data.results.map((q) => normalise({
      type: 'trivia',
      content: {
        question: decodeEntities(q.question),
        correctAnswer: decodeEntities(q.correct_answer),
        incorrectAnswers: q.incorrect_answers.map(decodeEntities),
        category: q.category,
        difficulty: q.difficulty
      },
      source: 'Open Trivia Database (opentdb.com)',
      license: 'CC BY-SA 4.0',
      keywords: extractKeywordsFromText(`${q.category} ${q.question}`)
    }));
  }

  /**
   * Fetch a random number/math fact from Numbers API.
   */
  async function fetchNumberFact() {
    const num = Math.floor(Math.random() * 1000);
    const types = ['trivia', 'math'];
    const type = types[Math.floor(Math.random() * types.length)];

    /* Numbers API returns plain text */
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const resp = await fetch(`http://numbersapi.com/${num}/${type}`, { signal: controller.signal });
      if (!resp.ok) return null;
      const text = await resp.text();
      lastFetch['numbers'] = Date.now();
      return normalise({
        type: 'fact',
        content: { fact: text, number: num, category: type },
        source: 'Numbers API (numbersapi.com)',
        license: 'Public Domain',
        keywords: ['math', 'number', type, String(num)]
      });
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fetch book information from Open Library.
   */
  async function fetchBookInfo(topic) {
    if (!topic) topic = shuffle(['programming', 'science', 'mathematics', 'philosophy', 'history', 'art'])[0];
    const data = await rateLimitedFetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(topic)}&limit=3&fields=title,author_name,subject,first_sentence,first_publish_year`,
      'openlibrary'
    );
    if (!data || !data.docs) return [];

    return data.docs.filter((d) => d.first_sentence).map((doc) => normalise({
      type: 'book',
      content: {
        title: doc.title,
        author: (doc.author_name || []).join(', '),
        firstSentence: Array.isArray(doc.first_sentence) ? doc.first_sentence[0] : doc.first_sentence,
        year: doc.first_publish_year,
        subjects: (doc.subject || []).slice(0, 5)
      },
      source: 'Open Library (openlibrary.org)',
      license: 'Open Data',
      keywords: extractKeywordsFromText(`${doc.title} ${(doc.subject || []).slice(0, 5).join(' ')}`)
    }));
  }

  /**
   * Fetch image metadata from Lorem Picsum (open/free images).
   */
  async function fetchRandomImage() {
    const page = Math.floor(Math.random() * 10) + 1;
    const data = await rateLimitedFetch(
      `https://picsum.photos/v2/list?page=${page}&limit=3`,
      'picsum'
    );
    if (!data || !data.length) return [];

    return data.map((img) => normalise({
      type: 'image_meta',
      content: {
        author: img.author,
        width: img.width,
        height: img.height,
        url: img.download_url,
        id: img.id
      },
      source: 'Lorem Picsum (picsum.photos)',
      license: 'Unsplash License (free for all uses)',
      keywords: ['image', 'photo', img.author.toLowerCase()]
    }));
  }

  /* ── Helpers ────────────────────────────────────────────────────────────── */

  function normalise(item) {
    return {
      ...item,
      timestamp: Date.now(),
      hash: simpleHash(JSON.stringify(item.content))
    };
  }

  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return hash;
  }

  function extractKeywordsFromText(text) {
    const stopWords = new Set([
      'a','an','the','is','are','was','were','be','been','being','have','has','had',
      'do','does','did','will','would','could','should','may','might','shall','can',
      'to','of','in','for','on','with','at','by','from','as','into','through','during',
      'and','or','but','if','then','that','this','these','those','it','its','not','no'
    ]);
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w))
      .filter((w, i, arr) => arr.indexOf(w) === i)
      .slice(0, 10);
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function decodeEntities(str) {
    const textarea = typeof document !== 'undefined' ? document.createElement('textarea') : null;
    if (textarea) { textarea.innerHTML = str; return textarea.value; }
    return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"').replace(/&#039;/g, "'");
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */

  return {
    fetchRandomWords,
    fetchWikipediaSummary,
    fetchTrivia,
    fetchNumberFact,
    fetchBookInfo,
    fetchRandomImage,
    /* Expose helper for use by other modules */
    simpleHash,
    extractKeywordsFromText
  };
})();

window.AielDataFetcher = AielDataFetcher;
