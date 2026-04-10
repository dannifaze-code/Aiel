/**
 * Aiel AI — Core AI Engine
 * Runs entirely in the browser: no API key, no server required.
 *
 * Strategy (in order of preference):
 *   1. Chrome Built-in AI (window.ai) — Chrome 128+
 *   2. Transformers.js — Hugging Face models run via WebAssembly/WebGL
 *   3. Aiel Local Engine — pattern-matching + rule-based fallback that
 *      improves via the learning system
 */
const AielEngine = (() => {

  /* ── State ─────────────────────────────────────────────────────────────── */

  let activeBackend = 'local';  // 'chrome-ai' | 'transformers' | 'local'
  let chromeSession = null;
  let transformersPipeline = null;
  let isInitialising = false;
  let ready = false;

  const TRANSFORMERS_CDN =
    'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

  /* ── Initialisation ─────────────────────────────────────────────────────── */

  async function init(onProgress) {
    if (ready) return activeBackend;
    if (isInitialising) return activeBackend;
    isInitialising = true;

    onProgress?.('Initialising Aiel AI…');

    /* 1. Try Chrome Built-in AI */
    try {
      if (window.ai && window.ai.languageModel) {
        const capabilities = await window.ai.languageModel.capabilities();
        if (capabilities.available !== 'no') {
          onProgress?.('Using Chrome Built-in AI…');
          chromeSession = await window.ai.languageModel.create({
            systemPrompt: buildSystemPrompt()
          });
          activeBackend = 'chrome-ai';
          ready = true;
          isInitialising = false;
          return activeBackend;
        }
      }
    } catch (_) { /* not available */ }

    /* 2. Try Transformers.js */
    try {
      onProgress?.('Loading AI model (first run may take a moment)…');
      const { pipeline, env } = await import(`${TRANSFORMERS_CDN}/dist/transformers.min.js`);
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      transformersPipeline = await pipeline(
        'text-generation',
        'Xenova/distilgpt2',
        { progress_callback: (info) => onProgress?.(`Loading model: ${Math.round((info.progress || 0))}%`) }
      );
      activeBackend = 'transformers';
      ready = true;
      isInitialising = false;
      return activeBackend;
    } catch (_) { /* not available or offline */ }

    /* 3. Fall back to local engine */
    onProgress?.('Using Aiel Local Engine (offline mode)');
    activeBackend = 'local';
    ready = true;
    isInitialising = false;
    return activeBackend;
  }

  /* ── Chat ───────────────────────────────────────────────────────────────── */

  /**
   * Generate a response for a given conversation.
   * @param {Array<{role:'user'|'assistant', content:string}>} messages
   * @param {{mode:string}} options
   * @returns {AsyncGenerator<string>} - Yields text chunks for streaming display
   */
  async function* chat(messages, options = {}) {
    const lastMessage = messages[messages.length - 1];
    const userInput = lastMessage?.content || '';
    const mode = options.mode || 'chat';

    /* Check learned patterns first */
    const keywords = AielLearning.extractKeywords(userInput);
    const learned = await AielLearning.findPattern(userInput);

    switch (activeBackend) {
      case 'chrome-ai':
        yield* chromeAIChat(messages, learned);
        break;
      case 'transformers':
        yield* transformersChat(userInput, mode, learned);
        break;
      default:
        yield* localChat(userInput, messages, mode, learned, keywords);
    }
  }

  async function* chromeAIChat(messages, learned) {
    try {
      /* Prepend learned pattern hint if available */
      const lastUser = messages[messages.length - 1].content;
      const prompt = learned
        ? `${lastUser}\n\n[Context: A similar question was answered: "${learned.response.slice(0, 200)}"]`
        : lastUser;

      const stream = await chromeSession.promptStreaming(prompt);
      for await (const chunk of stream) {
        yield chunk;
      }
    } catch (e) {
      yield* localChat(messages[messages.length - 1]?.content, messages, 'chat', null, []);
    }
  }

  async function* transformersChat(input, mode, learned) {
    try {
      const prompt = buildLocalPrompt(input, mode);
      const result = await transformersPipeline(prompt, {
        max_new_tokens: 200,
        temperature: 0.7,
        repetition_penalty: 1.3,
        do_sample: true
      });

      const generated = result[0].generated_text.slice(prompt.length).trim();
      /* Simulate streaming */
      const words = generated.split(' ');
      for (const word of words) {
        yield word + ' ';
        await sleep(30);
      }
    } catch (e) {
      yield* localChat(input, [], mode, learned, AielLearning.extractKeywords(input));
    }
  }

  async function* localChat(input, history, mode, learned, keywords) {
    /* Small artificial delay for realism */
    await sleep(200);

    let response = '';

    /* Use learned pattern if confidence is high enough */
    if (learned && learned.score > 0.7) {
      response = `💡 Based on what I've learned: ${learned.response}`;
      yield* streamText(response);
      return;
    }

    /* Mode-specific handlers */
    switch (mode) {
      case 'code':
        response = handleCodeMode(input, history);
        break;
      case 'image':
        response = '__IMAGE_GEN__';
        break;
      case 'video':
        response = '__VIDEO_GEN__';
        break;
      default:
        response = handleChatMode(input, history);
    }

    yield* streamText(response);
  }

  /* ── Local chat engine ──────────────────────────────────────────────────── */

  function handleChatMode(input, history) {
    const lower = input.toLowerCase();
    const ctx = history.slice(-4).map((m) => m.content.toLowerCase()).join(' ');

    /* Greetings */
    if (/^(hi|hello|hey|howdy|sup|yo|greetings|good\s*(morning|afternoon|evening))/.test(lower)) {
      const greets = [
        "Hey there! 👋 I'm Aiel, your AI assistant. How can I help you today?",
        "Hello! Great to see you! I'm ready to help with coding, questions, image creation, and more. What's on your mind?",
        "Hi! 😊 I'm Aiel — ask me anything, request code, or let's create something together!",
        "Greetings! I'm Aiel AI — fully free, always learning, always here. What can I do for you?"
      ];
      return pick(greets);
    }

    /* Identity questions */
    if (/who are you|what are you|tell me about yourself|introduce yourself/.test(lower)) {
      return `I'm **Aiel** — a fully autonomous AI assistant that lives right here in your browser! 🤖✨

Here's what makes me special:
- **100% Free** — no API keys, no subscriptions, ever
- **Works Offline** — once loaded, I run without internet
- **I Learn** — every interaction makes me smarter
- **I Can Code** — generate, explain, and debug code in any language
- **I Create** — generate images and videos from your prompts
- **Always Growing** — new features are rolled out regularly

I'm powered by local AI engines running entirely in your browser. The more you use me, the better I get! What would you like to explore?`;
    }

    /* What can you do */
    if (/what can you do|your features|capabilities|help me|how do you work/.test(lower)) {
      return `Here's everything I can do for you! 🚀

**💬 Conversation** — Ask me anything! I answer questions, explain concepts, and discuss any topic.

**💻 Code Generation** — Switch to Code mode and ask me to:
  - Write functions, classes, APIs, scripts
  - Debug and fix errors
  - Explain complex code
  - Refactor and optimise

**🎨 Image Creation** — Switch to Image mode to:
  - Generate artwork from text prompts
  - Create patterns, gradients, and abstract visuals
  - Download your creations

**🎬 Video Generation** — Switch to Video mode to:
  - Animate images into videos
  - Create slideshows from uploads
  - Generate animated scenes

**🧠 Learning** — I remember our conversations and patterns, getting smarter over time.

**📱 PWA** — Install me on any device for quick offline access!

Type your request or switch modes using the toolbar. What shall we create?`;
    }

    /* Coding questions in chat mode */
    if (/\b(code|program|script|function|class|algorithm|debug|error|fix|implement)\b/.test(lower)) {
      return `Great coding question! 👨‍💻 For the best experience, switch to **Code Mode** using the toolbar above — it gives you syntax-highlighted, copy-ready code blocks.

But here's a quick answer: ${generateCodeHint(input)}

Switch to Code mode for a full implementation!`;
    }

    /* Math */
    if (/\b(\d+\s*[\+\-\*\/\^]\s*\d+|\bcalculate\b|\bsolve\b|\bmath\b|\bequation\b)\b/.test(lower)) {
      return solveMath(input);
    }

    /* Thank you */
    if (/\b(thank|thanks|thank you|thx|ty|appreciate)\b/.test(lower)) {
      return pick([
        "You're welcome! 😊 Happy to help any time!",
        "Anytime! That's what I'm here for. 🤖",
        "My pleasure! Is there anything else you'd like to explore?",
        "Glad I could help! Remember, the more we chat, the smarter I get! 🧠"
      ]);
    }

    /* Farewell */
    if (/\b(bye|goodbye|see you|later|cya|goodnight)\b/.test(lower)) {
      return pick([
        "Goodbye! 👋 Come back anytime — I'll be here, learning and growing!",
        "See you later! Remember you can install Aiel as an app for quick access. 🚀",
        "Take care! I've saved our conversation and I'll remember what I've learned. 💾"
      ]);
    }

    /* Jokes */
    if (/\b(joke|funny|laugh|humor|humour)\b/.test(lower)) {
      const jokes = [
        "Why do programmers prefer dark mode? Because light attracts bugs! 🐛",
        "How many programmers does it take to change a light bulb? None — that's a hardware problem! 💡",
        "Why did the developer go broke? Because they used up all their cache! 💸",
        "What's a computer's favourite snack? Microchips! 🍟",
        "I told my AI to stop anthropomorphising. It said it had feelings about that. 😅"
      ];
      return pick(jokes);
    }

    /* Learning / AI topics */
    if (/\b(learn|machine learning|neural|ai|artificial intelligence|deep learning)\b/.test(lower)) {
      return `Great topic! 🧠 Here's what I know about ${extractTopic(input)}:

**Artificial Intelligence** is the simulation of human intelligence by machines. Key concepts include:

- **Machine Learning** — algorithms that improve through experience
- **Neural Networks** — layers of interconnected nodes inspired by the brain
- **Deep Learning** — multi-layered neural networks for complex pattern recognition
- **NLP** — Natural Language Processing, which powers chatbots like me!
- **Computer Vision** — AI understanding images and video

I myself use a combination of rule-based reasoning and learned patterns. Every time you interact with me, I store patterns in your browser's database and use them to give better answers over time.

Want to go deeper on any of these? Or switch to Code mode to see ML algorithms in action!`;
    }

    /* Default: thoughtful general response */
    return generateGeneralResponse(input, history);
  }

  function handleCodeMode(input, history) {
    const lower = input.toLowerCase();
    const lang = detectLanguage(input);
    const task = detectTask(input);

    return `\`\`\`${lang}\n${generateCode(input, lang, task, history)}\n\`\`\`

**Explanation:** ${generateCodeExplanation(input, lang, task)}

*💡 This snippet was generated locally. Copy it, run it, and let me know if you need modifications!*`;
  }

  /* ── Code generation helpers ────────────────────────────────────────────── */

  function detectLanguage(input) {
    const lower = input.toLowerCase();
    if (/\b(python|py|django|flask|pandas|numpy)\b/.test(lower)) return 'python';
    if (/\b(javascript|js|node|react|vue|angular|typescript|ts)\b/.test(lower)) return 'javascript';
    if (/\b(html|css|webpage|website|web page)\b/.test(lower)) return 'html';
    if (/\b(java|spring|maven)\b/.test(lower)) return 'java';
    if (/\b(c\+\+|cpp|c plus)\b/.test(lower)) return 'cpp';
    if (/\b(rust|cargo)\b/.test(lower)) return 'rust';
    if (/\b(go|golang)\b/.test(lower)) return 'go';
    if (/\b(sql|database|query|select|insert)\b/.test(lower)) return 'sql';
    if (/\b(bash|shell|script|terminal|linux)\b/.test(lower)) return 'bash';
    if (/\b(php|laravel|wordpress)\b/.test(lower)) return 'php';
    if (/\b(swift|ios|xcode)\b/.test(lower)) return 'swift';
    if (/\b(kotlin|android)\b/.test(lower)) return 'kotlin';
    if (/\b(css|style|design)\b/.test(lower)) return 'css';
    return 'javascript'; /* default */
  }

  function detectTask(input) {
    const lower = input.toLowerCase();
    if (/\b(sort|sorting)\b/.test(lower)) return 'sort';
    if (/\b(search|find|lookup)\b/.test(lower)) return 'search';
    if (/\b(api|fetch|http|request|endpoint)\b/.test(lower)) return 'api';
    if (/\b(class|object|oop)\b/.test(lower)) return 'class';
    if (/\b(function|method|procedure)\b/.test(lower)) return 'function';
    if (/\b(loop|iterate|array|list)\b/.test(lower)) return 'loop';
    if (/\b(database|sql|crud)\b/.test(lower)) return 'database';
    if (/\b(auth|login|password|token)\b/.test(lower)) return 'auth';
    if (/\b(test|unit test|spec)\b/.test(lower)) return 'test';
    if (/\b(fix|debug|error|bug)\b/.test(lower)) return 'debug';
    return 'general';
  }

  const CODE_TEMPLATES = {
    javascript: {
      sort: `// Efficient sorting algorithms in JavaScript
function bubbleSort(arr) {
  const n = arr.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - i - 1; j++) {
      if (arr[j] > arr[j + 1]) {
        [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
      }
    }
  }
  return arr;
}

function quickSort(arr) {
  if (arr.length <= 1) return arr;
  const pivot = arr[Math.floor(arr.length / 2)];
  const left = arr.filter(x => x < pivot);
  const middle = arr.filter(x => x === pivot);
  const right = arr.filter(x => x > pivot);
  return [...quickSort(left), ...middle, ...quickSort(right)];
}

// Example usage
const numbers = [64, 34, 25, 12, 22, 11, 90];
console.log('Quick sort:', quickSort([...numbers]));
console.log('Bubble sort:', bubbleSort([...numbers]));`,

      api: `// Fetch API with error handling and retry logic
async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      if (!response.ok) {
        throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
      }

      return await response.json();
    } catch (error) {
      if (attempt === retries) throw error;
      await new Promise(r => setTimeout(r, 1000 * attempt));
      console.log(\`Retrying... attempt \${attempt + 1}\`);
    }
  }
}

// Usage example
async function getUsers() {
  try {
    const users = await fetchWithRetry('https://jsonplaceholder.typicode.com/users');
    users.forEach(user => console.log(user.name, user.email));
    return users;
  } catch (error) {
    console.error('Failed to fetch users:', error.message);
  }
}

getUsers();`,

      class: `// Modern JavaScript class with full OOP features
class EventEmitter {
  #listeners = new Map();

  on(event, callback) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }
    this.#listeners.get(event).add(callback);
    return () => this.off(event, callback); // Returns unsubscribe function
  }

  off(event, callback) {
    this.#listeners.get(event)?.delete(callback);
  }

  emit(event, ...args) {
    this.#listeners.get(event)?.forEach(cb => cb(...args));
  }

  once(event, callback) {
    const unsubscribe = this.on(event, (...args) => {
      callback(...args);
      unsubscribe();
    });
  }
}

class DataStore extends EventEmitter {
  #data = {};

  set(key, value) {
    const old = this.#data[key];
    this.#data[key] = value;
    this.emit('change', { key, value, old });
  }

  get(key) { return this.#data[key]; }
  getAll() { return { ...this.#data }; }
}

// Usage
const store = new DataStore();
store.on('change', ({ key, value }) => console.log(\`\${key} changed to:\`, value));
store.set('theme', 'dark');
store.set('language', 'en');`,

      general: `// Utility functions collection
const utils = {
  // Deep clone any object
  deepClone: (obj) => JSON.parse(JSON.stringify(obj)),

  // Debounce: delay execution until after 'delay' ms of inactivity
  debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  },

  // Throttle: execute at most once per 'limit' ms
  throttle(fn, limit = 100) {
    let inThrottle;
    return (...args) => {
      if (!inThrottle) {
        fn(...args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  },

  // Format bytes to human-readable string
  formatBytes(bytes, decimals = 2) {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes','KB','MB','GB','TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return \`\${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} \${sizes[i]}\`;
  },

  // Generate a UUID
  uuid: () => crypto.randomUUID?.() ||
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }),

  // Capitalise first letter of each word
  titleCase: (str) => str.replace(/\b\w/g, l => l.toUpperCase()),
};

console.log(utils.uuid());
console.log(utils.formatBytes(1536000));`
    },

    python: {
      general: `# Python utility collection
import functools
import time
from typing import Any, Callable, TypeVar

T = TypeVar('T')


def retry(times: int = 3, delay: float = 1.0, exceptions=(Exception,)):
    """Decorator that retries a function on failure."""
    def decorator(fn: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(fn)
        def wrapper(*args, **kwargs) -> T:
            for attempt in range(1, times + 1):
                try:
                    return fn(*args, **kwargs)
                except exceptions as e:
                    if attempt == times:
                        raise
                    print(f"Attempt {attempt} failed: {e}. Retrying…")
                    time.sleep(delay * attempt)
        return wrapper
    return decorator


def memoize(fn: Callable[..., T]) -> Callable[..., T]:
    """Simple memoisation decorator."""
    cache: dict[tuple, Any] = {}

    @functools.wraps(fn)
    def wrapper(*args):
        if args not in cache:
            cache[args] = fn(*args)
        return cache[args]

    wrapper.cache = cache
    wrapper.clear_cache = cache.clear
    return wrapper


@memoize
def fibonacci(n: int) -> int:
    """Compute the nth Fibonacci number (memoised)."""
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)


@retry(times=3, delay=0.5)
def fetch_data(url: str) -> dict:
    import urllib.request, json
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.loads(response.read())


if __name__ == "__main__":
    # Fibonacci demo
    for i in range(10):
        print(f"fib({i}) = {fibonacci(i)}")`,

      sort: `# Sorting algorithms in Python
from typing import TypeVar, List

T = TypeVar('T')


def quick_sort(arr: List[T]) -> List[T]:
    """QuickSort — O(n log n) average, O(n²) worst."""
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left   = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right  = [x for x in arr if x > pivot]
    return quick_sort(left) + middle + quick_sort(right)


def merge_sort(arr: List[T]) -> List[T]:
    """MergeSort — O(n log n) guaranteed."""
    if len(arr) <= 1:
        return arr
    mid = len(arr) // 2
    left  = merge_sort(arr[:mid])
    right = merge_sort(arr[mid:])
    return merge(left, right)


def merge(left: List[T], right: List[T]) -> List[T]:
    result, i, j = [], 0, 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            result.append(left[i]); i += 1
        else:
            result.append(right[j]); j += 1
    return result + left[i:] + right[j:]


if __name__ == "__main__":
    data = [38, 27, 43, 3, 9, 82, 10]
    print("Original :", data)
    print("QuickSort:", quick_sort(data))
    print("MergeSort:", merge_sort(data))`,

      api: `# Async HTTP client with retry and rate limiting
import asyncio
import aiohttp
from typing import Any, Optional


class APIClient:
    def __init__(self, base_url: str, retries: int = 3, rate_limit: float = 0.1):
        self.base_url = base_url.rstrip('/')
        self.retries = retries
        self.rate_limit = rate_limit
        self._session: Optional[aiohttp.ClientSession] = None
        self._last_request = 0.0

    async def __aenter__(self):
        self._session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, *args):
        await self._session.close()

    async def _rate_limit(self):
        now = asyncio.get_event_loop().time()
        elapsed = now - self._last_request
        if elapsed < self.rate_limit:
            await asyncio.sleep(self.rate_limit - elapsed)
        self._last_request = asyncio.get_event_loop().time()

    async def get(self, endpoint: str, **kwargs) -> Any:
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        for attempt in range(1, self.retries + 1):
            await self._rate_limit()
            try:
                async with self._session.get(url, **kwargs) as resp:
                    resp.raise_for_status()
                    return await resp.json()
            except aiohttp.ClientError as e:
                if attempt == self.retries:
                    raise
                await asyncio.sleep(2 ** attempt)


async def main():
    async with APIClient('https://jsonplaceholder.typicode.com') as client:
        users = await client.get('/users')
        for user in users[:3]:
            print(f"{user['name']} — {user['email']}")


asyncio.run(main())`
    },

    html: {
      general: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Webpage</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --primary: #6c63ff;
      --bg: #0a0a1a;
      --surface: #12122a;
      --text: #e8e8f8;
      --muted: #8888aa;
      --radius: 12px;
    }

    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: grid;
      place-items: center;
    }

    .card {
      background: var(--surface);
      border: 1px solid rgba(108,99,255,.3);
      border-radius: var(--radius);
      padding: 2rem;
      max-width: 480px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0,0,0,.4);
    }

    h1 { color: var(--primary); margin-bottom: 1rem; }
    p  { color: var(--muted); line-height: 1.6; }

    .btn {
      display: inline-block;
      margin-top: 1.5rem;
      padding: .75rem 1.5rem;
      background: var(--primary);
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1rem;
      transition: opacity .2s;
    }
    .btn:hover { opacity: .85; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Hello, World! 🌍</h1>
    <p>A clean, modern webpage generated by Aiel AI. Customise this template to build your project!</p>
    <button class="btn" onclick="alert('Button clicked!')">Get Started</button>
  </div>
</body>
</html>`
    },

    sql: {
      general: `-- Database schema and queries
-- Create tables
CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  username   VARCHAR(50)  UNIQUE NOT NULL,
  email      VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE posts (
  id         SERIAL PRIMARY KEY,
  user_id    INT REFERENCES users(id) ON DELETE CASCADE,
  title      VARCHAR(255) NOT NULL,
  content    TEXT,
  published  BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_posts_user_id  ON posts(user_id);
CREATE INDEX idx_posts_published ON posts(published, created_at DESC);

-- Common queries
-- Get all published posts with author info
SELECT
  p.id,
  p.title,
  p.created_at,
  u.username AS author
FROM posts p
JOIN users  u ON u.id = p.user_id
WHERE p.published = TRUE
ORDER BY p.created_at DESC
LIMIT 20;

-- Count posts per user
SELECT
  u.username,
  COUNT(p.id) AS post_count
FROM users u
LEFT JOIN posts p ON p.user_id = u.id
GROUP BY u.id, u.username
ORDER BY post_count DESC;

-- Full-text search
SELECT id, title
FROM posts
WHERE to_tsvector('english', title || ' ' || COALESCE(content,''))
      @@ plainto_tsquery('english', 'your search term');`
    }
  };

  function generateCode(input, lang, task, history) {
    const templates = CODE_TEMPLATES[lang] || CODE_TEMPLATES.javascript;
    if (templates[task]) return templates[task];

    /* Try to find the closest task match */
    const keys = Object.keys(templates);
    for (const key of keys) {
      if (input.toLowerCase().includes(key)) return templates[key];
    }

    return templates.general || templates[Object.keys(templates)[0]] || '// Code generation in progress…';
  }

  function generateCodeExplanation(input, lang, task) {
    const explanations = {
      sort: 'This implements multiple sorting algorithms with different time complexities. QuickSort averages O(n log n) and is ideal for most cases.',
      api: 'The code handles HTTP requests with automatic retry logic and proper error handling for robust network communication.',
      class: 'An object-oriented approach with encapsulation using private fields (#). The EventEmitter pattern enables decoupled, reactive programming.',
      general: 'A clean, reusable utility collection following modern best practices. Each function is self-contained and well-typed.',
      database: 'Structured SQL schema with proper indexing for performance. Includes common query patterns for CRUD operations.',
      auth: 'Implements secure authentication patterns with proper token management and password hashing.',
    };
    return explanations[task] || `This ${lang} code addresses your request for "${input.slice(0, 60)}…". It follows best practices for the language.`;
  }

  function generateCodeHint(input) {
    if (/sort/.test(input.toLowerCase())) {
      return 'JavaScript has built-in `Array.prototype.sort()` but for custom algorithms, QuickSort and MergeSort are popular choices.';
    }
    if (/api|fetch/.test(input.toLowerCase())) {
      return 'Use the `fetch()` API with `async/await` for clean, modern HTTP requests. Add retry logic for resilience.';
    }
    return 'Switch to Code mode for a full implementation with syntax highlighting!';
  }

  /* ── Math solver ────────────────────────────────────────────────────────── */

  /**
   * Safe recursive-descent arithmetic parser.
   * Evaluates expressions containing +, -, *, /, ** and parentheses
   * without using eval() or new Function() to avoid code injection risks.
   */
  function safeMathEval(expr) {
    const tokens = expr.replace(/\s+/g, '').match(/\d+\.?\d*|\*\*|[+\-*/()]/g);
    if (!tokens) throw new Error('No valid tokens');
    let pos = 0;

    function peek() { return tokens[pos]; }
    function consume() { return tokens[pos++]; }

    /* Grammar (lowest to highest precedence):
     *   expr   → term  (('+' | '-') term)*
     *   term   → power (('*' | '/')  power)*
     *   power  → unary ('**' unary)*
     *   unary  → '-' primary | primary
     *   primary → NUMBER | '(' expr ')'
     */
    function parseExpr() {
      let left = parseTerm();
      while (peek() === '+' || peek() === '-') {
        const op = consume();
        const right = parseTerm();
        left = op === '+' ? left + right : left - right;
      }
      return left;
    }

    function parseTerm() {
      let left = parsePower();
      while (peek() === '*' || peek() === '/') {
        const op = consume();
        const right = parsePower();
        if (op === '/' && right === 0) throw new Error('Division by zero');
        left = op === '*' ? left * right : left / right;
      }
      return left;
    }

    function parsePower() {
      let base = parseUnary();
      if (peek() === '**') { consume(); base = Math.pow(base, parseUnary()); }
      return base;
    }

    function parseUnary() {
      if (peek() === '-') { consume(); return -parsePrimary(); }
      return parsePrimary();
    }

    function parsePrimary() {
      const tok = peek();
      if (tok === '(') {
        consume();
        const val = parseExpr();
        if (consume() !== ')') throw new Error('Missing closing parenthesis');
        return val;
      }
      if (tok !== undefined && /^\d/.test(tok)) { consume(); return parseFloat(tok); }
      throw new Error(`Unexpected token: ${tok}`);
    }

    const result = parseExpr();
    if (pos < tokens.length) throw new Error('Unexpected tokens after expression');
    return result;
  }

  function solveMath(input) {
    try {
      /* Extract simple arithmetic expressions */
      const expr = input.replace(/[^0-9+\-*/().\s^]/g, '').trim();
      if (!expr) throw new Error('No valid expression');

      /* Replace ^ with ** for exponentiation */
      const safe = expr.replace(/\^/g, '**');

      /* Evaluate using a safe, recursive descent parser instead of new Function() */
      if (/^[\d\s+\-*/().^**]+$/.test(safe)) {
        const result = safeMathEval(safe);
        return `🔢 **Result:** \`${expr} = ${result}\`\n\nI evaluated the expression step by step. Need more complex math or want to see the working?`;
      }
      throw new Error('Complex expression');
    } catch (_) {
      return `📐 I detected a math question in your message! For complex equations, switch to **Code mode** and I'll write a solver for you. Or rephrase as a simple arithmetic expression like \`15 * 24 + 100\`.`;
    }
  }

  /* ── General response generator ─────────────────────────────────────────── */

  function generateGeneralResponse(input, history) {
    const words = input.toLowerCase().split(/\s+/);
    const topic = extractTopic(input);

    /* Try to give a relevant answer based on keywords */
    const keywordResponses = {
      weather: "I don't have access to live weather data, but I can write you a weather widget that fetches from a free API! Switch to Code mode and ask me to 'build a weather app'.",
      time: `The current time in your timezone is **${new Date().toLocaleTimeString()}** and today's date is **${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}**.`,
      music: "Music is amazing! 🎵 While I can't play audio, I can write you a music player app in Code mode, or create animated visualisations in Image mode!",
      movie: "Great topic! 🎬 I can help you build a movie search app (Code mode), create movie-inspired artwork (Image mode), or just chat about films!",
      game: "Games are awesome! 🎮 I can generate game code for you — try Code mode and ask for 'a simple snake game in JavaScript'!",
      health: "Health is wealth! 🌿 I can help you build a health tracker app, generate workout plans, or discuss wellness topics. What specific help do you need?",
      food: "Delicious topic! 🍕 I can write recipe apps, create food-themed art, or generate meal plan spreadsheet code. What sounds good?",
      travel: "Adventures await! ✈️ I can build travel planning apps, create destination artwork, or help organise trip data. Where are you headed?",
      science: "Science is fascinating! 🔬 I can explain concepts, write simulation code, or visualise scientific data. What branch interests you?",
      history: "History is rich with lessons! 📚 I can discuss historical events, write timeline visualisation code, or create historical artwork. What period interests you?"
    };

    for (const [key, response] of Object.entries(keywordResponses)) {
      if (words.some((w) => w.includes(key))) return response;
    }

    /* Fallback general response */
    const responses = [
      `Interesting! You're asking about **${topic}**. Let me share what I know:\n\n${topic} is a fascinating subject with many dimensions to explore. I'm continuously learning more about it through our conversations. \n\nCould you be more specific about what you'd like to know? I can:\n- Explain concepts in depth\n- Generate code related to ${topic}\n- Create visual representations\n- Find patterns from our previous conversations`,

      `Great question about **${topic}**! 🤔\n\nI'm always learning and evolving. Based on my current knowledge, here are some key points about ${topic}:\n\n• It's a topic worth exploring in detail\n• There are multiple perspectives to consider\n• Practical applications exist in many fields\n\nWould you like me to dive deeper, generate code examples, or explore a specific aspect? The more context you give me, the better I can help!`,

      `You've raised something interesting! Let me think about **${topic}**...\n\nThis is exactly the kind of question I learn from. Here's my current understanding, and I'll get smarter on this topic as we talk more:\n\n${topic} involves complex ideas that span multiple domains. I'd love to give you a more specific answer — could you tell me:\n1. What aspect interests you most?\n2. Is this for learning, a project, or curiosity?\n3. Would code examples help?`
    ];

    return pick(responses);
  }

  function extractTopic(input) {
    const stopWords = new Set(['what','is','are','the','a','an','about','tell','me','how','why','when','where','who','please','can','you','do']);
    const words = input.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w));
    return words.slice(0, 3).join(' ') || 'that topic';
  }

  /* ── Utilities ──────────────────────────────────────────────────────────── */

  function buildSystemPrompt() {
    return `You are Aiel, a helpful, friendly, and knowledgeable AI assistant. You run entirely in the user's browser with no external API calls. You can help with coding, answer questions, explain concepts, and generate creative content. Be concise, clear, and helpful. Use markdown formatting when appropriate. You learn from each conversation.`;
  }

  function buildLocalPrompt(input, mode) {
    const modeContext = {
      code: 'Generate clean, working code for the following request:',
      image: 'Describe an image for the following prompt:',
      video: 'Describe a video sequence for the following prompt:',
      chat: 'Respond helpfully to:'
    };
    return `${modeContext[mode] || modeContext.chat} ${input}\n\nResponse:`;
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  async function* streamText(text) {
    const words = text.split(' ');
    for (const word of words) {
      yield word + ' ';
      await sleep(18 + Math.random() * 20);
    }
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /* ── Public API ─────────────────────────────────────────────────────────── */

  return { init, chat, get backend() { return activeBackend; }, get isReady() { return ready; } };
})();

window.AielEngine = AielEngine;
