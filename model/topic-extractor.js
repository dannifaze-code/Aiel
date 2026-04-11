/**
 * Aiel AI — Topic Extractor
 * Enhanced keyword extraction using TF-IDF scoring.
 * Extracts meaningful topics and entities from user input.
 */
const AielTopicExtractor = (() => {
  'use strict';

  /* ── Stop Words ──────────────────────────────────────────────────────────── */

  const STOP_WORDS = new Set([
    'a','about','above','after','again','against','all','am','an','and','any',
    'are','aren\'t','as','at','be','because','been','before','being','below',
    'between','both','but','by','can','can\'t','cannot','could','couldn\'t',
    'did','didn\'t','do','does','doesn\'t','doing','don\'t','down','during',
    'each','few','for','from','further','get','got','had','hadn\'t','has',
    'hasn\'t','have','haven\'t','having','he','her','here','hers','herself',
    'him','himself','his','how','i','if','in','into','is','isn\'t','it',
    'its','itself','just','let','let\'s','like','me','might','more','most',
    'mustn\'t','my','myself','need','no','nor','not','now','of','off','on',
    'once','only','or','other','ought','our','ours','ourselves','out','over',
    'own','please','really','same','shall','shan\'t','she','should','shouldn\'t',
    'so','some','such','than','that','the','their','theirs','them','themselves',
    'then','there','these','they','this','those','through','to','too','under',
    'until','up','us','very','want','was','wasn\'t','we','well','were',
    'weren\'t','what','when','where','which','while','who','whom','why',
    'will','with','won\'t','would','wouldn\'t','you','your','yours',
    'yourself','yourselves','also','help','tell','explain','make','give',
    'write','create','show','know'
  ]);

  /* ── Document Frequency Approximation ────────────────────────────────────── */

  /**
   * Approximate IDF values based on word commonality.
   * Higher value = rarer/more important term.
   */
  const DOMAIN_IDF = {
    /* Very common terms (low IDF) */
    'code': 1.5, 'data': 1.5, 'program': 1.5, 'function': 1.5,
    'file': 1.5, 'system': 1.5, 'work': 1.3, 'example': 1.3,

    /* Moderately specific terms */
    'algorithm': 3.0, 'database': 2.8, 'network': 2.5, 'security': 2.8,
    'machine': 2.0, 'learning': 2.0, 'interface': 2.5, 'protocol': 3.0,
    'architecture': 3.0, 'framework': 2.5, 'library': 2.5, 'component': 2.5,

    /* Highly specific / domain terms */
    'tensorflow': 5.0, 'pytorch': 5.0, 'kubernetes': 5.0, 'docker': 4.5,
    'blockchain': 4.5, 'cryptography': 5.0, 'quantum': 5.0,
    'photosynthesis': 5.0, 'mitochondria': 5.0, 'fibonacci': 4.5,

    /* Language names (high specificity) */
    'javascript': 4.0, 'python': 4.0, 'typescript': 4.0, 'rust': 4.0,
    'golang': 4.5, 'kotlin': 4.5, 'swift': 4.0, 'java': 3.5,
    'html': 3.0, 'css': 3.0, 'sql': 3.5, 'php': 3.5,

    /* Technology terms */
    'react': 4.0, 'vue': 4.0, 'angular': 4.0, 'django': 4.5,
    'flask': 4.5, 'express': 3.5, 'node': 3.0, 'webpack': 4.5,
    'api': 2.5, 'rest': 3.0, 'graphql': 4.5, 'websocket': 4.0
  };

  /* ── Tokenization ────────────────────────────────────────────────────────── */

  /**
   * Tokenize input into clean words.
   * @param {string} text
   * @returns {string[]}
   */
  function tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s\+\#\.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(w => w.length > 1);
  }

  /* ── TF-IDF Extraction ──────────────────────────────────────────────────── */

  /**
   * Extract topics from text using TF-IDF scoring.
   *
   * @param {string} text — Input text
   * @param {object} [options]
   * @param {number} [options.maxTopics=5] — Maximum topics to return
   * @param {number} [options.minScore=0.5] — Minimum TF-IDF score
   * @returns {Array<{term: string, score: number}>}
   */
  function extract(text, options = {}) {
    const maxTopics = options.maxTopics || 5;
    const minScore = options.minScore || 0.5;

    const tokens = tokenize(text);
    if (tokens.length === 0) return [];

    /* Compute term frequency */
    const tf = {};
    for (const token of tokens) {
      if (STOP_WORDS.has(token)) continue;
      tf[token] = (tf[token] || 0) + 1;
    }

    /* Normalize TF */
    const maxTf = Math.max(...Object.values(tf), 1);

    /* Score each term */
    const scored = [];
    for (const [term, count] of Object.entries(tf)) {
      const normalizedTf = count / maxTf;
      const idf = DOMAIN_IDF[term] || estimateIDF(term);
      const score = normalizedTf * idf;
      scored.push({ term, score, tf: count, idf });
    }

    /* Sort by score, return top N */
    scored.sort((a, b) => b.score - a.score);
    return scored
      .filter(s => s.score >= minScore)
      .slice(0, maxTopics);
  }

  /**
   * Estimate IDF for unknown words based on heuristics.
   * @param {string} word
   * @returns {number}
   */
  function estimateIDF(word) {
    /* Longer words tend to be more specific */
    if (word.length >= 10) return 4.0;
    if (word.length >= 7) return 3.0;
    if (word.length >= 5) return 2.5;
    if (word.length >= 3) return 2.0;
    return 1.5;
  }

  /* ── N-gram Extraction ───────────────────────────────────────────────────── */

  /**
   * Extract meaningful n-grams (bigrams) from text.
   * @param {string} text
   * @returns {string[]}
   */
  function extractBigrams(text) {
    const tokens = tokenize(text).filter(t => !STOP_WORDS.has(t));
    if (tokens.length < 2) return [];

    const bigrams = [];
    for (let i = 0; i < tokens.length - 1; i++) {
      bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
    return bigrams;
  }

  /* ── Entity Extraction ───────────────────────────────────────────────────── */

  /**
   * Extract named entities (rough heuristic-based).
   * @param {string} text
   * @returns {{languages: string[], technologies: string[], concepts: string[]}}
   */
  function extractEntities(text) {
    const lower = text.toLowerCase();

    const LANGUAGE_MAP = {
      'javascript': 'JavaScript', 'js': 'JavaScript', 'python': 'Python',
      'py': 'Python', 'typescript': 'TypeScript', 'ts': 'TypeScript',
      'java': 'Java', 'rust': 'Rust', 'go': 'Go', 'golang': 'Go',
      'html': 'HTML', 'css': 'CSS', 'sql': 'SQL', 'php': 'PHP',
      'swift': 'Swift', 'kotlin': 'Kotlin', 'c++': 'C++', 'cpp': 'C++',
      'ruby': 'Ruby', 'bash': 'Bash', 'shell': 'Shell'
    };

    const TECH_MAP = {
      'react': 'React', 'vue': 'Vue.js', 'angular': 'Angular',
      'django': 'Django', 'flask': 'Flask', 'express': 'Express.js',
      'node': 'Node.js', 'deno': 'Deno', 'docker': 'Docker',
      'kubernetes': 'Kubernetes', 'aws': 'AWS', 'tensorflow': 'TensorFlow',
      'pytorch': 'PyTorch', 'mongodb': 'MongoDB', 'postgres': 'PostgreSQL',
      'redis': 'Redis', 'graphql': 'GraphQL', 'webpack': 'Webpack',
      'tailwind': 'Tailwind CSS', 'next': 'Next.js', 'nuxt': 'Nuxt.js'
    };

    const languages = [];
    const technologies = [];

    for (const [key, name] of Object.entries(LANGUAGE_MAP)) {
      if (lower.includes(key) && !languages.includes(name)) {
        languages.push(name);
      }
    }

    for (const [key, name] of Object.entries(TECH_MAP)) {
      if (lower.includes(key) && !technologies.includes(name)) {
        technologies.push(name);
      }
    }

    /* Extract general concepts from TF-IDF */
    const topics = extract(text, { maxTopics: 5, minScore: 1.0 });
    const concepts = topics
      .map(t => t.term)
      .filter(t => !Object.keys(LANGUAGE_MAP).includes(t) && !Object.keys(TECH_MAP).includes(t));

    return { languages, technologies, concepts };
  }

  /* ── Simple Keyword Extraction (backward-compatible) ─────────────────────── */

  /**
   * Extract simple keywords (similar to old AielLearning.extractKeywords).
   * @param {string} text
   * @returns {string[]}
   */
  function extractKeywords(text) {
    return tokenize(text)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
      .filter((w, i, arr) => arr.indexOf(w) === i)
      .slice(0, 10);
  }

  /* ── Public API ────────────────────────────────────────────────────────── */

  return {
    extract,
    extractBigrams,
    extractEntities,
    extractKeywords,
    tokenize,
    STOP_WORDS
  };
})();

window.AielTopicExtractor = AielTopicExtractor;
