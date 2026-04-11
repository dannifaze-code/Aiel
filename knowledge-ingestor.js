/**
 * Aiel AI — Knowledge Ingestor
 * Parses, normalises, and stores fetched data into the AielLearning
 * IndexedDB stores so the AI engine can use it for responses.
 */
const AielKnowledgeIngestor = (() => {
  'use strict';

  /* ── Deduplication set (in-memory cache of hashes seen this session) ──── */
  const seenHashes = new Set();

  /* ── Initialise from persisted hashes ──────────────────────────────────── */

  async function init() {
    try {
      const saved = await AielLearning.getPreference('ingestedHashes', []);
      if (Array.isArray(saved)) saved.forEach((h) => seenHashes.add(h));
    } catch (_) { /* first run */ }
  }

  /* ── Deduplication ──────────────────────────────────────────────────────── */

  function isDuplicate(hash) {
    return seenHashes.has(hash);
  }

  async function markIngested(hash) {
    seenHashes.add(hash);
    /* Persist — keep only the last 5000 hashes to limit storage */
    const arr = [...seenHashes].slice(-5000);
    await AielLearning.setPreference('ingestedHashes', arr);
  }

  /* ── Text Ingestor (definitions, articles, facts) ──────────────────────── */

  async function ingestText(item) {
    if (!item || isDuplicate(item.hash)) return false;

    const content = item.content;
    let input = '';
    let response = '';
    let keywords = item.keywords || [];

    switch (item.type) {
      case 'definition': {
        const word = content.word;
        const defs = content.definitions || [];
        input = `what is ${word}`;
        response = `**${word}**`;
        if (content.phonetic) response += ` (${content.phonetic})`;
        response += '\n\n';
        defs.forEach((d) => {
          response += `*${d.partOfSpeech}*: ${d.definition}\n`;
          if (d.example) response += `  _Example: "${d.example}"_\n`;
        });
        response += `\n_Source: ${item.source}_`;
        keywords = [word, ...keywords];
        break;
      }
      case 'article': {
        input = `tell me about ${content.title.toLowerCase()}`;
        response = `**${content.title}**\n\n${content.summary}`;
        if (content.description) response += `\n\n_${content.description}_`;
        response += `\n\n_Source: ${item.source} (CC BY-SA 3.0)_`;
        keywords = [content.title.toLowerCase(), ...keywords];
        break;
      }
      case 'fact': {
        input = `tell me a fact about ${content.number}`;
        response = content.fact;
        response += `\n\n_Source: ${item.source}_`;
        break;
      }
      case 'book': {
        input = `tell me about the book ${content.title.toLowerCase()}`;
        response = `**${content.title}**`;
        if (content.author) response += ` by ${content.author}`;
        if (content.year) response += ` (${content.year})`;
        response += '\n\n';
        if (content.firstSentence) response += content.firstSentence + '\n\n';
        if (content.subjects && content.subjects.length) {
          response += `Topics: ${content.subjects.join(', ')}`;
        }
        response += `\n\n_Source: ${item.source}_`;
        keywords = [content.title.toLowerCase(), ...(content.subjects || []).map((s) => s.toLowerCase()), ...keywords];
        break;
      }
      default:
        /* Generic text */
        if (typeof content === 'string') {
          input = content.slice(0, 100);
          response = content;
        } else {
          return false;
        }
    }

    /* Deduplicate keywords */
    keywords = [...new Set(keywords.map((k) => k.toLowerCase()))].slice(0, 10);

    try {
      await AielLearning.learnPattern(input, response, keywords);
      await markIngested(item.hash);
      await incrementStat('text');
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ── Q&A Ingestor (trivia) ─────────────────────────────────────────────── */

  async function ingestQA(item) {
    if (!item || isDuplicate(item.hash)) return false;

    const content = item.content;
    const input = content.question;
    const allAnswers = [content.correctAnswer, ...(content.incorrectAnswers || [])];
    const response = `${content.correctAnswer}\n\n` +
      `_Category: ${content.category || 'General'} | Difficulty: ${content.difficulty || 'medium'}_\n` +
      `_Source: ${item.source}_`;

    const keywords = [
      ...(item.keywords || []),
      (content.category || '').toLowerCase()
    ].filter(Boolean);

    try {
      await AielLearning.learnPattern(input, response, keywords);
      await markIngested(item.hash);
      await incrementStat('qa');
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ── Code Ingestor ─────────────────────────────────────────────────────── */

  async function ingestCode(item) {
    if (!item || isDuplicate(item.hash)) return false;

    const content = item.content;
    const language = content.language || 'javascript';
    const code = content.code || '';
    const prompt = content.prompt || content.description || `${language} code example`;

    try {
      await AielLearning.saveCodeSnippet(prompt, code, language);

      /* Also create a pattern for code questions */
      const response = `\`\`\`${language}\n${code}\n\`\`\`\n\n_Source: ${item.source || 'Open Source'}_`;
      const keywords = [language, ...(item.keywords || [])];
      await AielLearning.learnPattern(
        `write ${language} code for ${prompt}`,
        response,
        keywords
      );

      await markIngested(item.hash);
      await incrementStat('code');
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ── Image Metadata Ingestor ───────────────────────────────────────────── */

  async function ingestImageMeta(item) {
    if (!item || isDuplicate(item.hash)) return false;

    const content = item.content;
    const input = `photo by ${content.author}`;
    const response = `📷 **Photo by ${content.author}**\n` +
      `Resolution: ${content.width}×${content.height}\n` +
      `_Source: ${item.source}_`;

    const keywords = ['image', 'photo', ...(item.keywords || [])];

    try {
      await AielLearning.learnPattern(input, response, keywords);
      await markIngested(item.hash);
      await incrementStat('image');
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ── Batch ingestor ────────────────────────────────────────────────────── */

  /**
   * Ingest an array of normalised data items, routing each to the correct handler.
   * @param {Array} items — normalised data items from AielDataFetcher
   * @returns {Promise<number>} — count of successfully ingested items
   */
  async function ingestBatch(items) {
    if (!Array.isArray(items)) return 0;

    let count = 0;
    for (const item of items) {
      if (!item || isDuplicate(item.hash)) continue;

      let success = false;
      switch (item.type) {
        case 'definition':
        case 'article':
        case 'fact':
        case 'book':
          success = await ingestText(item);
          break;
        case 'trivia':
          success = await ingestQA(item);
          break;
        case 'code':
          success = await ingestCode(item);
          break;
        case 'image_meta':
          success = await ingestImageMeta(item);
          break;
        default:
          /* Try as generic text */
          success = await ingestText(item);
      }
      if (success) count++;
    }
    return count;
  }

  /* ── Stats helpers ─────────────────────────────────────────────────────── */

  async function incrementStat(category) {
    const stats = await AielLearning.getPreference('trainingStats', {
      total: 0, text: 0, qa: 0, code: 0, image: 0, aiGenerated: 0,
      lastRun: null, sessions: 0
    });
    stats.total = (stats.total || 0) + 1;
    stats[category] = (stats[category] || 0) + 1;
    stats.lastRun = Date.now();
    await AielLearning.setPreference('trainingStats', stats);
  }

  async function getStats() {
    return AielLearning.getPreference('trainingStats', {
      total: 0, text: 0, qa: 0, code: 0, image: 0, aiGenerated: 0,
      lastRun: null, sessions: 0
    });
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */

  return {
    init,
    isDuplicate,
    ingestText,
    ingestQA,
    ingestCode,
    ingestImageMeta,
    ingestBatch,
    getStats
  };
})();

window.AielKnowledgeIngestor = AielKnowledgeIngestor;
