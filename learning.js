/**
 * Aiel AI — Learning System
 * Stores and retrieves patterns from IndexedDB to improve responses over time.
 */
const AielLearning = (() => {
  const DB_NAME = 'AielMemory';
  const DB_VERSION = 2;
  const STORES = {
    PATTERNS: 'patterns',
    CONVERSATIONS: 'conversations',
    PREFERENCES: 'preferences',
    CODE_SNIPPETS: 'code_snippets',
    MEDIA: 'media_history',
    KNOWLEDGE: 'knowledge',
    DEDUP_HASHES: 'dedup_hashes'
  };

  let db = null;

  /* ── Database initialisation ───────────────────────────────────────────── */

  function openDB() {
    return new Promise((resolve, reject) => {
      if (db) { resolve(db); return; }
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORES.PATTERNS)) {
          const patternStore = database.createObjectStore(STORES.PATTERNS, {
            keyPath: 'id', autoIncrement: true
          });
          patternStore.createIndex('keyword', 'keyword', { unique: false });
          patternStore.createIndex('score', 'score', { unique: false });
        }
        if (!database.objectStoreNames.contains(STORES.CONVERSATIONS)) {
          const convStore = database.createObjectStore(STORES.CONVERSATIONS, {
            keyPath: 'id', autoIncrement: true
          });
          convStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!database.objectStoreNames.contains(STORES.PREFERENCES)) {
          database.createObjectStore(STORES.PREFERENCES, { keyPath: 'key' });
        }
        if (!database.objectStoreNames.contains(STORES.CODE_SNIPPETS)) {
          const codeStore = database.createObjectStore(STORES.CODE_SNIPPETS, {
            keyPath: 'id', autoIncrement: true
          });
          codeStore.createIndex('language', 'language', { unique: false });
        }
        if (!database.objectStoreNames.contains(STORES.MEDIA)) {
          database.createObjectStore(STORES.MEDIA, {
            keyPath: 'id', autoIncrement: true
          });
        }
        if (!database.objectStoreNames.contains(STORES.KNOWLEDGE)) {
          const knowledgeStore = database.createObjectStore(STORES.KNOWLEDGE, {
            keyPath: 'id', autoIncrement: true
          });
          knowledgeStore.createIndex('category', 'category', { unique: false });
          knowledgeStore.createIndex('timestamp', 'timestamp', { unique: false });
          knowledgeStore.createIndex('hash', 'hash', { unique: false });
        }
        if (!database.objectStoreNames.contains(STORES.DEDUP_HASHES)) {
          database.createObjectStore(STORES.DEDUP_HASHES, { keyPath: 'hash' });
        }
      };

      request.onsuccess = (e) => { db = e.target.result; resolve(db); };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  function withStore(storeName, mode, callback) {
    return openDB().then((database) => {
      return new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const result = callback(store);
        if (result && typeof result.onsuccess !== 'undefined') {
          result.onsuccess = (e) => resolve(e.target.result);
          result.onerror = (e) => reject(e.target.error);
        } else {
          tx.oncomplete = () => resolve(result);
          tx.onerror = (e) => reject(e.target.error);
        }
      });
    });
  }

  /* ── Pattern learning ──────────────────────────────────────────────────── */

  /**
   * Learn a new input→response pattern.
   * @param {string} input - User input
   * @param {string} response - AI response that was positively received
   * @param {string[]} keywords - Key terms extracted from input
   */
  function learnPattern(input, response, keywords = []) {
    return openDB().then((database) => {
      return new Promise((resolve, reject) => {
        const tx = database.transaction(STORES.PATTERNS, 'readwrite');
        const store = tx.objectStore(STORES.PATTERNS);

        /* Check for an existing pattern with same normalised input */
        const normInput = normalise(input);
        const index = store.index('keyword');

        /* For each keyword, try to update score of existing patterns */
        keywords.forEach((kw) => {
          const req = index.getAll(kw.toLowerCase());
          req.onsuccess = (e) => {
            const matches = e.target.result;
            matches.forEach((pattern) => {
              if (normalise(pattern.input) === normInput) {
                pattern.score = (pattern.score || 1) + 1;
                pattern.lastUsed = Date.now();
                store.put(pattern);
              }
            });
          };
        });

        /* Always add the pattern */
        const record = {
          input: normInput,
          response,
          keywords: keywords.map((k) => k.toLowerCase()),
          keyword: keywords[0] ? keywords[0].toLowerCase() : 'general',
          score: 1,
          timestamp: Date.now(),
          lastUsed: Date.now()
        };

        const addReq = store.add(record);
        addReq.onsuccess = () => resolve(true);
        addReq.onerror = (e) => reject(e.target.error);
      });
    });
  }

  /**
   * Find the best matching learned pattern for a given input.
   * @param {string} input
   * @returns {Promise<{response: string, score: number}|null>}
   */
  function findPattern(input) {
    return openDB().then((database) => {
      return new Promise((resolve) => {
        const tx = database.transaction(STORES.PATTERNS, 'readonly');
        const store = tx.objectStore(STORES.PATTERNS);
        const req = store.getAll();

        req.onsuccess = (e) => {
          const patterns = e.target.result;
          if (!patterns.length) { resolve(null); return; }

          const normInput = normalise(input);
          const inputWords = normInput.split(/\s+/).filter(Boolean);

          let best = null;
          let bestScore = 0;

          patterns.forEach((pattern) => {
            /* Skip patterns whose stored response is garbage */
            if (!isValidResponse(pattern.response)) return;

            const patternWords = pattern.input.split(/\s+/).filter(Boolean);
            const totalWords = inputWords.length + patternWords.length;
          /* Skip patterns where both the user input and the stored pattern have no words
           * — their combined total is 0 — which would cause division by zero in the
           * Sørensen–Dice coefficient calculation below. */
          if (totalWords === 0) return;
            const overlap = inputWords.filter((w) =>
              patternWords.some((pw) => pw.includes(w) || w.includes(pw))
            ).length;
            const similarity = (2 * overlap) / totalWords;
            const finalScore = similarity * (pattern.score || 1);

            if (similarity > 0.55 && finalScore > bestScore) {
              bestScore = finalScore;
              best = pattern;
            }
          });

          resolve(best ? { response: best.response, score: bestScore } : null);
        };

        req.onerror = () => resolve(null);
      });
    });
  }

  /* ── Conversation storage ──────────────────────────────────────────────── */

  function saveConversation(messages) {
    return withStore(STORES.CONVERSATIONS, 'readwrite', (store) => {
      return store.add({
        messages,
        timestamp: Date.now(),
        title: messages.length > 0 ? messages[0].content.slice(0, 50) : 'New Chat'
      });
    });
  }

  function getConversations(limit = 20) {
    return openDB().then((database) => {
      return new Promise((resolve) => {
        const tx = database.transaction(STORES.CONVERSATIONS, 'readonly');
        const store = tx.objectStore(STORES.CONVERSATIONS);
        const index = store.index('timestamp');
        const req = index.openCursor(null, 'prev');
        const results = [];

        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor && results.length < limit) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        req.onerror = () => resolve([]);
      });
    });
  }

  function deleteConversation(id) {
    return withStore(STORES.CONVERSATIONS, 'readwrite', (store) => store.delete(id));
  }

  /* ── Preferences ───────────────────────────────────────────────────────── */

  function setPreference(key, value) {
    return withStore(STORES.PREFERENCES, 'readwrite', (store) =>
      store.put({ key, value, updated: Date.now() })
    );
  }

  function getPreference(key, defaultValue = null) {
    return openDB().then((database) => {
      return new Promise((resolve) => {
        const tx = database.transaction(STORES.PREFERENCES, 'readonly');
        const store = tx.objectStore(STORES.PREFERENCES);
        const req = store.get(key);
        req.onsuccess = (e) =>
          resolve(e.target.result ? e.target.result.value : defaultValue);
        req.onerror = () => resolve(defaultValue);
      });
    });
  }

  /* ── Code snippets ─────────────────────────────────────────────────────── */

  function saveCodeSnippet(prompt, code, language) {
    return withStore(STORES.CODE_SNIPPETS, 'readwrite', (store) =>
      store.add({ prompt, code, language, timestamp: Date.now() })
    );
  }

  function getCodeSnippets(language = null, limit = 50) {
    return openDB().then((database) => {
      return new Promise((resolve) => {
        const tx = database.transaction(STORES.CODE_SNIPPETS, 'readonly');
        const store = tx.objectStore(STORES.CODE_SNIPPETS);

        if (language) {
          const index = store.index('language');
          const req = index.getAll(language);
          req.onsuccess = (e) => resolve(e.target.result.slice(0, limit));
          req.onerror = () => resolve([]);
        } else {
          const req = store.getAll();
          req.onsuccess = (e) => resolve(e.target.result.slice(-limit));
          req.onerror = () => resolve([]);
        }
      });
    });
  }

  /* ── Knowledge store ────────────────────────────────────────────────────── */

  function saveKnowledge(item) {
    return withStore(STORES.KNOWLEDGE, 'readwrite', (store) =>
      store.add({
        ...item,
        timestamp: Date.now()
      })
    );
  }

  function getKnowledge(category, limit = 50) {
    return openDB().then((database) => {
      return new Promise((resolve) => {
        const tx = database.transaction(STORES.KNOWLEDGE, 'readonly');
        const store = tx.objectStore(STORES.KNOWLEDGE);
        if (category) {
          const index = store.index('category');
          const req = index.getAll(category);
          req.onsuccess = (e) => resolve(e.target.result.slice(0, limit));
          req.onerror = () => resolve([]);
        } else {
          const req = store.getAll();
          req.onsuccess = (e) => resolve(e.target.result.slice(-limit));
          req.onerror = () => resolve([]);
        }
      });
    });
  }

  function searchKnowledge(query, limit = 20) {
    return openDB().then((database) => {
      return new Promise((resolve) => {
        const tx = database.transaction(STORES.KNOWLEDGE, 'readonly');
        const store = tx.objectStore(STORES.KNOWLEDGE);
        const req = store.getAll();
        req.onsuccess = (e) => {
          const results = e.target.result;
          const queryLower = query.toLowerCase();
          const queryWords = queryLower.split(/\s+/).filter(Boolean);
          const filtered = results.filter((item) => {
            const text = JSON.stringify(item).toLowerCase();
            return queryWords.some((w) => text.includes(w));
          }).slice(0, limit);
          resolve(filtered);
        };
        req.onerror = () => resolve([]);
      });
    });
  }

  function deleteKnowledge(id) {
    return withStore(STORES.KNOWLEDGE, 'readwrite', (store) => store.delete(id));
  }

  function clearKnowledge() {
    return withStore(STORES.KNOWLEDGE, 'readwrite', (store) => store.clear());
  }

  /* ── Stats ─────────────────────────────────────────────────────────────── */

  function getStats() {
    return openDB().then((database) => {
      return new Promise((resolve) => {
        const patternTx = database.transaction(STORES.PATTERNS, 'readonly');
        const patternCount = patternTx.objectStore(STORES.PATTERNS).count();
        const convTx = database.transaction(STORES.CONVERSATIONS, 'readonly');
        const convCount = convTx.objectStore(STORES.CONVERSATIONS).count();

        const promises = [
          new Promise((r) => { patternCount.onsuccess = (e) => r(e.target.result); patternCount.onerror = () => r(0); }),
          new Promise((r) => { convCount.onsuccess = (e) => r(e.target.result); convCount.onerror = () => r(0); })
        ];

        /* Count knowledge items if the store exists */
        if (database.objectStoreNames.contains(STORES.KNOWLEDGE)) {
          const knowledgeTx = database.transaction(STORES.KNOWLEDGE, 'readonly');
          const knowledgeCount = knowledgeTx.objectStore(STORES.KNOWLEDGE).count();
          promises.push(
            new Promise((r) => { knowledgeCount.onsuccess = (e) => r(e.target.result); knowledgeCount.onerror = () => r(0); })
          );
        } else {
          promises.push(Promise.resolve(0));
        }

        Promise.all(promises).then(([patterns, conversations, knowledge]) => {
          resolve({ patterns, conversations, knowledge });
        });
      });
    });
  }

  /* ── Response quality validation ─────────────────────────────────────── */

  /**
   * Check whether a response string is valid, human-readable text worth
   * storing as a learned pattern.  Rejects raw URLs, JSON fragments,
   * HTML markup, and other non-conversational garbage that models like
   * DistilGPT2 tend to produce.
   *
   * @param {string} text — the AI response to validate
   * @returns {boolean}
   */
  function isValidResponse(text) {
    if (!text || typeof text !== 'string') return false;

    const trimmed = text.trim();

    /* Too short to be useful */
    if (trimmed.length < 15) return false;

    /* Predominantly a URL (possibly with surrounding whitespace) */
    if (/^\s*https?:\/\/\S+\s*$/i.test(trimmed)) return false;

    /* Starts with a URL (garbage completion that leads with a link) */
    if (/^https?:\/\//i.test(trimmed)) return false;

    /* Looks like raw JSON or a JS object literal */
    if (/^\s*[\[{]/.test(trimmed) && /[\]}]\s*$/.test(trimmed)) return false;

    /* Heavy concentration of JSON / code-like tokens */
    const jsonTokens = (trimmed.match(/[{}[\]:,"]/g) || []).length;
    if (jsonTokens > trimmed.length * 0.25) return false;

    /* Mostly HTML tags */
    const htmlTags = (trimmed.match(/<\/?[a-z][^>]*>/gi) || []).length;
    if (htmlTags > 3) return false;

    /* Too many URL-like substrings (more than 3) */
    const urlCount = (trimmed.match(/https?:\/\/\S+/g) || []).length;
    if (urlCount > 3) return false;

    /* High ratio of non-alphabetic characters → likely gibberish / encoded */
    const alpha = (trimmed.match(/[a-zA-Z]/g) || []).length;
    if (alpha < trimmed.length * 0.3) return false;

    return true;
  }

  /* ── Clear patterns ───────────────────────────────────────────────────── */

  /**
   * Remove all learned patterns from the database.
   * @returns {Promise<void>}
   */
  function clearPatterns() {
    return withStore(STORES.PATTERNS, 'readwrite', (store) => store.clear());
  }

  /* ── Helpers ───────────────────────────────────────────────────────────── */

  function normalise(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractKeywords(text) {
    const stopWords = new Set([
      'a','an','the','is','are','was','were','be','been','being',
      'have','has','had','do','does','did','will','would','could',
      'should','may','might','shall','can','to','of','in','for',
      'on','with','at','by','from','as','into','through','during',
      'i','me','my','you','your','we','our','they','their','it',
      'what','how','when','where','why','please','help','me','and',
      'or','but','if','then','that','this','these','those'
    ]);

    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w))
      .slice(0, 10);
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */

  return {
    init: openDB,
    learnPattern,
    findPattern,
    saveConversation,
    getConversations,
    deleteConversation,
    setPreference,
    getPreference,
    saveCodeSnippet,
    getCodeSnippets,
    saveKnowledge,
    getKnowledge,
    searchKnowledge,
    deleteKnowledge,
    clearKnowledge,
    clearPatterns,
    getStats,
    extractKeywords,
    isValidResponse
  };
})();

/* Make available globally */
window.AielLearning = AielLearning;
