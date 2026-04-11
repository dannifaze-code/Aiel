/**
 * Aiel AI — Local Provider
 * The built-in pattern-matching and rule-based engine that works offline.
 * This is the always-available fallback — no network, no API key needed.
 *
 * Integrates with:
 * - AielLearning (pattern store, knowledge base)
 * - AielMood (reward signals)
 * - Aiel custom model (intent classification, topic extraction)
 */
const AielLocalProvider = (() => {
  'use strict';

  const { Provider } = AielProviderBase;

  /* ── Code Templates ──────────────────────────────────────────────────────── */

  const CODE_TEMPLATES = {
    javascript: {
      sort: `function sortArray(arr) {\n  return [...arr].sort((a, b) => a - b);\n}\n\n// Usage:\nconsole.log(sortArray([3, 1, 4, 1, 5]));`,
      search: `function binarySearch(arr, target) {\n  let lo = 0, hi = arr.length - 1;\n  while (lo <= hi) {\n    const mid = (lo + hi) >>> 1;\n    if (arr[mid] === target) return mid;\n    arr[mid] < target ? lo = mid + 1 : hi = mid - 1;\n  }\n  return -1;\n}`,
      api: `async function fetchData(url) {\n  try {\n    const resp = await fetch(url);\n    if (!resp.ok) throw new Error(\`HTTP \${resp.status}\`);\n    return await resp.json();\n  } catch (err) {\n    console.error('Fetch failed:', err);\n    throw err;\n  }\n}`,
      class: `class EventEmitter {\n  #handlers = {};\n  on(event, fn) {\n    (this.#handlers[event] ??= []).push(fn);\n    return this;\n  }\n  emit(event, ...args) {\n    (this.#handlers[event] || []).forEach(fn => fn(...args));\n  }\n  off(event, fn) {\n    this.#handlers[event] = (this.#handlers[event] || []).filter(f => f !== fn);\n  }\n}`,
      function: `/**\n * Debounce a function call.\n * @param {Function} fn\n * @param {number} ms\n */\nfunction debounce(fn, ms = 300) {\n  let timer;\n  return (...args) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), ms);\n  };\n}`,
      general: `// Aiel AI — Generated Code\nfunction processData(data) {\n  if (!Array.isArray(data)) {\n    throw new TypeError('Expected array');\n  }\n  return data\n    .filter(item => item != null)\n    .map(item => ({\n      ...item,\n      processed: true,\n      timestamp: Date.now()\n    }));\n}`
    },
    python: {
      sort: `def sort_list(arr: list) -> list:\n    """Sort a list using merge sort."""\n    if len(arr) <= 1:\n        return arr\n    mid = len(arr) // 2\n    left = sort_list(arr[:mid])\n    right = sort_list(arr[mid:])\n    return merge(left, right)\n\ndef merge(left, right):\n    result = []\n    i = j = 0\n    while i < len(left) and j < len(right):\n        if left[i] <= right[j]:\n            result.append(left[i]); i += 1\n        else:\n            result.append(right[j]); j += 1\n    result.extend(left[i:])\n    result.extend(right[j:])\n    return result`,
      api: `import httpx\nimport asyncio\n\nasync def fetch_data(url: str) -> dict:\n    async with httpx.AsyncClient() as client:\n        resp = await client.get(url)\n        resp.raise_for_status()\n        return resp.json()`,
      class: `from dataclasses import dataclass, field\nfrom typing import Optional\n\n@dataclass\nclass User:\n    name: str\n    email: str\n    age: int = 0\n    tags: list[str] = field(default_factory=list)\n\n    def greet(self) -> str:\n        return f"Hello, {self.name}!"`,
      general: `# Aiel AI — Generated Code\ndef process_data(data: list[dict]) -> list[dict]:\n    \"\"\"Process and clean a list of records.\"\"\"\n    return [\n        {**item, "processed": True}\n        for item in data\n        if item is not None\n    ]`
    },
    html: {
      general: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Page</title>\n  <style>\n    * { margin: 0; padding: 0; box-sizing: border-box; }\n    body { font-family: system-ui, sans-serif; line-height: 1.6; padding: 2rem; }\n  </style>\n</head>\n<body>\n  <h1>Hello World</h1>\n  <p>Your content here.</p>\n</body>\n</html>`
    },
    sql: {
      general: `-- Aiel AI — SQL Query\nSELECT\n  u.id,\n  u.name,\n  u.email,\n  COUNT(o.id) AS order_count,\n  SUM(o.total) AS total_spent\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id\nWHERE u.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)\nGROUP BY u.id, u.name, u.email\nHAVING order_count > 0\nORDER BY total_spent DESC\nLIMIT 10;`
    }
  };

  /* ── Language Detection ──────────────────────────────────────────────────── */

  const LANG_PATTERNS = [
    { lang: 'python',     re: /\b(python|py|django|flask|pandas|numpy|pip)\b/i },
    { lang: 'javascript', re: /\b(javascript|js|node|react|vue|angular|npm|deno|bun)\b/i },
    { lang: 'html',       re: /\b(html|webpage|website|dom|css|tailwind)\b/i },
    { lang: 'java',       re: /\b(java|spring|maven|gradle|jvm)\b(?!script)/i },
    { lang: 'cpp',        re: /\b(c\+\+|cpp|cmake|gcc|clang)\b/i },
    { lang: 'rust',       re: /\b(rust|cargo|crate)\b/i },
    { lang: 'go',         re: /\b(golang|go\s+lang)\b/i },
    { lang: 'sql',        re: /\b(sql|query|database|select|insert|mysql|postgres)\b/i },
    { lang: 'bash',       re: /\b(bash|shell|sh|terminal|command\s*line|zsh)\b/i },
    { lang: 'typescript', re: /\b(typescript|ts)\b/i },
    { lang: 'swift',      re: /\b(swift|ios|swiftui)\b/i },
    { lang: 'kotlin',     re: /\b(kotlin|android)\b/i },
    { lang: 'css',        re: /\b(css|stylesheet|flexbox|grid)\b/i },
    { lang: 'php',        re: /\b(php|laravel|wordpress)\b/i }
  ];

  function detectLanguage(input) {
    const lower = input.toLowerCase();
    for (const { lang, re } of LANG_PATTERNS) {
      if (re.test(lower)) return lang;
    }
    return 'javascript';
  }

  /* ── Task Detection ──────────────────────────────────────────────────────── */

  function detectTask(input) {
    const lower = input.toLowerCase();
    if (/\b(sort|order|rank)\b/.test(lower)) return 'sort';
    if (/\b(search|find|lookup|binary)\b/.test(lower)) return 'search';
    if (/\b(api|fetch|http|request|endpoint)\b/.test(lower)) return 'api';
    if (/\b(class|object|oop|inherit|model)\b/.test(lower)) return 'class';
    if (/\b(function|method|helper|utility)\b/.test(lower)) return 'function';
    return 'general';
  }

  /* ── Safe Math Evaluator ─────────────────────────────────────────────────── */

  function safeMathEval(expr) {
    const tokens = expr.replace(/\s+/g, '').split('');
    let pos = 0;

    function peek() { return tokens[pos]; }
    function next() { return tokens[pos++]; }

    function parseNumber() {
      let num = '';
      if (peek() === '-') num += next();
      while (pos < tokens.length && (/\d/.test(peek()) || peek() === '.')) {
        num += next();
      }
      if (num === '' || num === '-') throw new Error('Expected number');
      return parseFloat(num);
    }

    function parsePrimary() {
      if (peek() === '(') {
        next(); /* skip ( */
        const val = parseExpr();
        if (peek() !== ')') throw new Error('Missing )');
        next(); /* skip ) */
        return val;
      }
      return parseNumber();
    }

    function parsePower() {
      let base = parsePrimary();
      while (peek() === '*' && tokens[pos + 1] === '*') {
        next(); next(); /* skip ** */
        base = Math.pow(base, parsePrimary());
      }
      return base;
    }

    function parseTerm() {
      let val = parsePower();
      while (peek() === '*' || peek() === '/') {
        const op = next();
        const right = parsePower();
        if (op === '/') {
          if (right === 0) throw new Error('Division by zero');
          val /= right;
        } else {
          val *= right;
        }
      }
      return val;
    }

    function parseExpr() {
      let val = parseTerm();
      while (peek() === '+' || peek() === '-') {
        const op = next();
        val = op === '+' ? val + parseTerm() : val - parseTerm();
      }
      return val;
    }

    const result = parseExpr();
    if (pos < tokens.length) throw new Error('Unexpected character');
    return result;
  }

  /* ── Stop Words ──────────────────────────────────────────────────────────── */

  const STOP_WORDS = new Set([
    'a','an','the','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could',
    'should','may','might','shall','can','to','of','in','for',
    'on','with','at','by','from','as','into','through','during',
    'i','me','my','you','your','we','our','they','their','it',
    'what','how','when','where','why','please','help','and',
    'or','but','if','then','that','this','these','those'
  ]);

  function extractTopic(input) {
    return input.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
      .slice(0, 3);
  }

  /* ── Response Helpers ────────────────────────────────────────────────────── */

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * Simulate streaming by yielding words with natural jitter.
   * Used when the response is locally generated (no real stream).
   */
  async function* fakeStream(text) {
    const words = text.split(' ');
    for (const word of words) {
      yield word + ' ';
      await sleep(18 + Math.random() * 20);
    }
  }

  /* ── Local Provider Class ────────────────────────────────────────────────── */

  class LocalProvider extends Provider {
    constructor(config = {}) {
      super({
        name: 'local',
        displayName: 'Aiel Local Engine',
        priority: 100, /* Lowest priority — always-available fallback */
        timeoutMs: 30000,
        maxRetries: 0,
        ...config
      });
    }

    /* ── Health Check ───────────────────────────────────────────────────────── */

    async checkHealth() {
      /* Local engine is always available */
      return true;
    }

    /* ── Chat (non-streaming) ───────────────────────────────────────────────── */

    async generate(messages, options = {}) {
      const input = messages[messages.length - 1]?.content || '';
      const mode = options.mode || 'chat';
      const history = messages.slice(-4);

      /* 1. Check hardcoded chat handlers first */
      if (mode === 'chat' || !mode) {
        const hardcoded = this._handleChat(input, history);
        if (hardcoded !== null) return hardcoded;
      }

      /* 2. Check learned patterns */
      const learned = await this._checkPatterns(input);
      if (learned) return `💡 Based on what I've learned: ${learned}`;

      /* 3. Check knowledge base */
      const knowledge = await this._checkKnowledge(input);
      if (knowledge) return `🧠 From my knowledge base: ${knowledge}`;

      /* 4. Mode-specific generation */
      switch (mode) {
        case 'code':
          return this._generateCode(input);
        case 'image':
          return '__IMAGE_GEN__';
        case 'video':
          return '__VIDEO_GEN__';
        default:
          return this._generateGeneral(input, history);
      }
    }

    /* ── Chat (streaming) ───────────────────────────────────────────────────── */

    async *stream(messages, options = {}) {
      const response = await this.generate(messages, options);
      yield* fakeStream(response);
    }

    /* ── Chat Handlers ─────────────────────────────────────────────────────── */

    _handleChat(input, history) {
      const lower = input.toLowerCase();

      /* Greetings */
      if (/^(hi|hello|hey|howdy|sup|yo|greetings|good\s*(morning|afternoon|evening))/.test(lower)) {
        return pick([
          "Hey there! 👋 I'm Aiel, your AI assistant. How can I help you today?",
          "Hello! Great to see you! I'm ready to help with coding, questions, image creation, and more. What's on your mind?",
          "Hi! 😊 I'm Aiel — ask me anything, request code, or let's create something together!",
          "Greetings! I'm Aiel AI — fully free, always learning, always here. What can I do for you?"
        ]);
      }

      /* Identity */
      if (/who are you|what('s| is) your name|tell me about yourself|introduce yourself/.test(lower)) {
        return "I'm **Aiel AI** — a fully free, autonomous AI assistant that runs right in your browser! 🤖\n\n" +
          "Here's what makes me special:\n" +
          "• 🧠 **Always learning** — I get smarter from every conversation\n" +
          "• 💻 **Code generation** — I write code in 10+ languages\n" +
          "• 🎨 **Image creation** — I generate images from descriptions\n" +
          "• 📡 **Works offline** — No internet? No problem!\n" +
          "• 🔒 **Private** — Your data stays in your browser\n" +
          "• 🆓 **100% Free** — No API keys, no subscriptions, ever!";
      }

      /* Capabilities */
      if (/what can you do|your (capabilities|features|abilities)|help me/.test(lower)) {
        return "Here's everything I can do for you:\n\n" +
          "💬 **Chat** — Answer questions, explain concepts, have conversations\n" +
          "💻 **Code** — Generate, explain, and debug code in 10+ languages\n" +
          "🎨 **Create** — Generate images from text descriptions\n" +
          "🎬 **Video** — Create simple video concepts\n" +
          "📚 **Learn** — I continuously learn from public sources\n" +
          "🧮 **Math** — Solve calculations and explain math concepts\n" +
          "🌐 **Offline** — I work without internet using my local engine\n\n" +
          "Just type your question or switch modes using the buttons above! 🚀";
      }

      /* Math */
      if (/\d+\s*[\+\-\*\/\^]\s*\d+/.test(input) ||
          /\b(calculate|compute|solve|what('s| is)\s+\d)\b/.test(lower)) {
        return this._solveMath(input);
      }

      /* Jokes */
      if (/\b(joke|funny|humor|laugh|make me laugh)\b/.test(lower)) {
        return pick([
          "Why do programmers prefer dark mode? Because light attracts bugs! 🐛😄",
          "Why was the JavaScript developer sad? Because he didn't Node how to Express himself! 😂",
          "What's a programmer's favorite hangout? Foo Bar! 🍺😆",
          "There are only 10 types of people: those who understand binary, and those who don't! 🤓",
          "Why do Java developers wear glasses? Because they can't C#! 👓😅"
        ]);
      }

      /* Thanks */
      if (/^(thanks|thank you|thx|ty|appreciate|cheers)/.test(lower)) {
        return pick([
          "You're welcome! 😊 Happy to help! Let me know if you need anything else.",
          "Glad I could help! Feel free to ask me anything anytime. 🤖",
          "No problem at all! That's what I'm here for. 💡"
        ]);
      }

      /* Goodbye */
      if (/^(bye|goodbye|see you|later|gotta go|gtg|night)/.test(lower)) {
        return pick([
          "Goodbye! 👋 Come back anytime — I'll be here learning and getting smarter!",
          "See you later! 🌟 Your conversations are saved, so we can pick up where we left off.",
          "Take care! I'll keep learning while you're away. See you soon! 😊"
        ]);
      }

      /* Coding request redirect */
      if (/\b(code|program|script|function|class|implement|build|create a? ?(?:web|app|program))\b/.test(lower) &&
          !/what (is|are)|explain|tell me about/.test(lower)) {
        return "I'd love to help with code! 💻\n\n" +
          "For the best experience, switch to **Code Mode** using the mode buttons above.\n\n" +
          "But here's a quick start — what language and what would you like me to build? " +
          "I support JavaScript, Python, HTML, SQL, Rust, Go, Java, C++, and more!";
      }

      return null; /* No hardcoded match */
    }

    /* ── Math Solver ───────────────────────────────────────────────────────── */

    _solveMath(input) {
      const exprMatch = input.match(/[\d\.\+\-\*\/\^\(\)\s]+/);
      if (!exprMatch) return "I couldn't find a valid math expression. Try something like `2 + 3 * 4`.";

      try {
        const expr = exprMatch[0].replace(/\^/g, '**').trim();
        const result = safeMathEval(expr);
        if (isNaN(result) || !isFinite(result)) {
          return "That expression results in an undefined value. Please check it and try again.";
        }
        return `🧮 **${exprMatch[0].trim()}** = **${result}**\n\n_Calculated by Aiel's built-in math engine._`;
      } catch (err) {
        return `I had trouble with that math: ${err.message}. Try a simpler expression like \`2 + 3 * 4\`.`;
      }
    }

    /* ── Pattern Checking ──────────────────────────────────────────────────── */

    async _checkPatterns(input) {
      try {
        if (typeof AielLearning === 'undefined') return null;
        const result = await AielLearning.findPattern(input);
        if (result && result.score > 0.7) {
          if (typeof AielMood !== 'undefined') AielMood.onPatternMatched(result.score);
          return result.response;
        }
      } catch (_) { /* non-critical */ }
      return null;
    }

    /* ── Knowledge Lookup ──────────────────────────────────────────────────── */

    async _checkKnowledge(input) {
      try {
        if (typeof AielLearning === 'undefined') return null;

        /* Search knowledge store */
        if (typeof AielLearning.searchKnowledge === 'function') {
          const results = await AielLearning.searchKnowledge(input, 3);
          if (results.length > 0) {
            const best = results[0];
            const content = best.content || best;
            let candidate = null;
            if (typeof content === 'object') {
              if (content.summary) candidate = content.summary;
              else if (content.definition) candidate = `**${content.word || ''}**: ${content.definition}`;
              else if (content.fact) candidate = content.fact;
            }
            if (!candidate && typeof content === 'string') candidate = content;
            if (candidate && AielLearning.isValidResponse(candidate)) {
              if (typeof AielMood !== 'undefined') AielMood.onPatternMatched(0.6);
              return candidate;
            }
          }
        }

        /* Check code snippets */
        if (/\b(code|program|function|class|example|write|implement|build)\b/i.test(input)) {
          const snippets = await AielLearning.getCodeSnippets(null, 5);
          if (snippets.length > 0) {
            const inputLower = input.toLowerCase();
            const match = snippets.find(s =>
              s.prompt && inputLower.includes(s.language?.toLowerCase()) ||
              (s.prompt && inputLower.split(/\s+/).some(w => s.prompt.toLowerCase().includes(w)))
            );
            if (match) {
              return `Here's a ${match.language || ''} snippet I've learned:\n\n${match.code}`;
            }
          }
        }
      } catch (_) { /* knowledge lookup is optional */ }
      return null;
    }

    /* ── Code Generation ───────────────────────────────────────────────────── */

    _generateCode(input) {
      const lang = detectLanguage(input);
      const task = detectTask(input);
      const templates = CODE_TEMPLATES[lang] || CODE_TEMPLATES.javascript;
      const code = templates[task] || templates.general;

      return `Here's your **${lang}** code:\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n` +
        `_Generated by Aiel AI. Feel free to modify and extend this code!_`;
    }

    /* ── General Response Generation ───────────────────────────────────────── */

    _generateGeneral(input, history) {
      const lower = input.toLowerCase();
      const topics = extractTopic(input);
      const topicStr = topics.join(', ');

      /* Topic-specific responses */
      if (/\b(weather|temperature|forecast)\b/.test(lower)) {
        return "I don't have access to live weather data, but I can help you understand weather concepts! " +
          "You can also use the **Feed AI** button to teach me about weather from web sources. 🌤️";
      }
      if (/\b(time|date|clock)\b/.test(lower)) {
        const now = new Date();
        return `The current time is **${now.toLocaleTimeString()}** on **${now.toLocaleDateString()}**. ⏰`;
      }
      if (/\b(music|song|playlist)\b/.test(lower)) {
        return "While I can't play music, I can discuss music theory, recommend genres, or help you write lyrics! 🎵 What interests you?";
      }
      if (/\b(science|physics|chemistry|biology)\b/.test(lower)) {
        return `Great question about **${topicStr || 'science'}**! 🔬 I've been learning from various scientific sources. ` +
          "Could you be more specific about what you'd like to know? I work best with focused questions!";
      }
      if (/\b(history|historical|ancient|civilization)\b/.test(lower)) {
        return `Interesting topic — **${topicStr || 'history'}**! 📜 ` +
          "I have some knowledge from my training data. What specific aspect would you like to explore?";
      }

      /* Fallback response */
      return pick([
        `That's an interesting topic${topicStr ? ` — **${topicStr}**` : ''}! While my knowledge is still growing, I can help you explore it. Try asking me a specific question, or use the 🧠 Feed AI button to teach me more about it!`,
        `I'm still learning about ${topicStr || 'that topic'}, but I'm happy to try! Could you rephrase your question or break it into smaller parts? That helps me give better answers. 💡`,
        `Great question! I may not have a perfect answer yet, but I'm always learning. For the best results, try:\n• Asking a specific question\n• Switching to Code mode for programming help\n• Using Feed AI to teach me new topics\n\nWhat would you like to explore? 🚀`
      ]);
    }
  }

  /* ── Public API ────────────────────────────────────────────────────────── */

  return {
    LocalProvider,
    detectLanguage,
    detectTask,
    safeMathEval
  };
})();

window.AielLocalProvider = AielLocalProvider;
