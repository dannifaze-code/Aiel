/**
 * Aiel AI — Intent Classifier
 * Categorizes user input into intents for optimal response routing.
 * Uses a combination of keyword matching, regex patterns, and TF-IDF scoring.
 *
 * Intents: question, code_request, chat, creative, math, command, feedback, unknown
 */
const AielIntentClassifier = (() => {
  'use strict';

  /* ── Intent Definitions ──────────────────────────────────────────────────── */

  const INTENTS = {
    GREETING:     'greeting',
    FAREWELL:     'farewell',
    IDENTITY:     'identity',
    QUESTION:     'question',
    CODE_REQUEST: 'code_request',
    CODE_EXPLAIN: 'code_explain',
    CODE_DEBUG:   'code_debug',
    MATH:         'math',
    CREATIVE:     'creative',
    IMAGE:        'image',
    VIDEO:        'video',
    COMMAND:      'command',
    FEEDBACK:     'feedback',
    CHAT:         'chat',
    UNKNOWN:      'unknown'
  };

  /* ── Pattern Rules (ordered by priority) ─────────────────────────────────── */

  const RULES = [
    {
      intent: INTENTS.GREETING,
      patterns: [/^(hi|hello|hey|howdy|sup|yo|greetings|good\s*(morning|afternoon|evening|day))\b/i],
      weight: 1.0
    },
    {
      intent: INTENTS.FAREWELL,
      patterns: [/^(bye|goodbye|see you|later|gotta go|gtg|good\s*night)\b/i],
      weight: 1.0
    },
    {
      intent: INTENTS.IDENTITY,
      patterns: [
        /who are you/i,
        /what('s| is) your name/i,
        /tell me about yourself/i,
        /introduce yourself/i,
        /what (can you|do you) do/i,
        /your (capabilities|features|abilities)/i
      ],
      weight: 0.95
    },
    {
      intent: INTENTS.MATH,
      patterns: [
        /\d+\s*[\+\-\*\/\^]\s*\d+/,
        /\b(calculate|compute|solve|what('s| is)\s+\d)/i,
        /\b(square root|factorial|logarithm|integral|derivative|equation)\b/i,
        /\b(sum|product|average|mean|median|percent)\s+(of|is)/i
      ],
      weight: 0.9
    },
    {
      intent: INTENTS.IMAGE,
      patterns: [
        /\b(generate|create|make|draw|paint|design)\b.*(image|picture|photo|illustration|art|icon|logo|graphic)/i,
        /\b(image|picture|photo)\b.*(of|for|showing|with)/i
      ],
      weight: 0.85
    },
    {
      intent: INTENTS.VIDEO,
      patterns: [
        /\b(generate|create|make)\b.*(video|animation|clip|movie)/i,
        /\b(video|animation)\b.*(of|for|showing|about)/i
      ],
      weight: 0.85
    },
    {
      intent: INTENTS.CODE_DEBUG,
      patterns: [
        /\b(debug|fix|error|bug|issue|broken|not working|doesn'?t work|crash)\b/i,
        /\b(why (does|is|isn'?t)|what'?s wrong)\b/i,
        /\b(stack ?trace|exception|traceback)\b/i
      ],
      keywords: ['code', 'program', 'function', 'script'],
      weight: 0.8
    },
    {
      intent: INTENTS.CODE_REQUEST,
      patterns: [
        /\b(write|create|generate|build|make|implement|code)\b.*(function|class|program|script|app|api|component|module|code|website)/i,
        /\b(write|create|code|build)\b.*\b(in|using|with)\b.*(python|javascript|java|html|css|sql|rust|go|typescript|c\+\+|php|swift|kotlin|ruby)/i,
        /\bcode\b.*(for|to|that)/i,
        /^(write|create|build|make|code|implement|generate)\s/i
      ],
      weight: 0.8
    },
    {
      intent: INTENTS.CODE_EXPLAIN,
      patterns: [
        /\b(explain|how does|how do|what does|what is|describe)\b.*(code|function|class|algorithm|pattern|syntax|concept|loop|recursion)/i,
        /\b(what|how|why)\b.*\b(work|mean|do)\b.*\b(code|programming|function)\b/i
      ],
      weight: 0.75
    },
    {
      intent: INTENTS.CREATIVE,
      patterns: [
        /\b(write|create|compose|generate)\b.*(story|poem|essay|lyrics|haiku|song|joke|riddle|limerick)/i,
        /\b(tell me a|give me a|make up a)\b.*(story|joke|riddle|fact)/i
      ],
      weight: 0.75
    },
    {
      intent: INTENTS.FEEDBACK,
      patterns: [
        /^(thanks|thank you|thx|ty|appreciate|cheers|good job|well done|great|awesome|nice)\b/i,
        /\b(thumb|upvote|downvote|rate|feedback|helpful|unhelpful)\b/i
      ],
      weight: 0.7
    },
    {
      intent: INTENTS.COMMAND,
      patterns: [
        /^\/(help|clear|reset|export|settings|train|learn|status)/i,
        /\b(clear|reset|delete|export|settings|configure)\b.*(chat|history|memory|data|conversation)/i
      ],
      weight: 0.7
    },
    {
      intent: INTENTS.QUESTION,
      patterns: [
        /^(what|who|where|when|why|how|which|can you|could you|do you|is it|are there|tell me)\b/i,
        /\?$/,
        /\b(explain|describe|define|meaning of|difference between)\b/i
      ],
      weight: 0.5
    }
  ];

  /* ── Classification ──────────────────────────────────────────────────────── */

  /**
   * Classify user input into an intent.
   * Returns the best matching intent with confidence score.
   *
   * @param {string} input — User message
   * @param {object} [context] — {mode, history}
   * @returns {{intent: string, confidence: number, secondary: string|null}}
   */
  function classify(input, context = {}) {
    if (!input || typeof input !== 'string') {
      return { intent: INTENTS.UNKNOWN, confidence: 0, secondary: null };
    }

    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return { intent: INTENTS.UNKNOWN, confidence: 0, secondary: null };
    }

    const matches = [];

    for (const rule of RULES) {
      let matched = false;
      let score = 0;

      /* Check patterns */
      for (const pattern of rule.patterns) {
        if (pattern.test(trimmed)) {
          matched = true;
          score = Math.max(score, rule.weight);
          break;
        }
      }

      /* Check keywords (boost if also matched) */
      if (rule.keywords) {
        const lower = trimmed.toLowerCase();
        const keywordHits = rule.keywords.filter(kw => lower.includes(kw)).length;
        if (keywordHits > 0) {
          score += keywordHits * 0.1;
          if (!matched) {
            matched = keywordHits >= 2;
            score = Math.max(score, 0.3 + keywordHits * 0.15);
          }
        }
      }

      if (matched && score > 0) {
        matches.push({ intent: rule.intent, confidence: Math.min(score, 1.0) });
      }
    }

    /* Context-based adjustments */
    if (context.mode === 'code') {
      matches.forEach(m => {
        if (m.intent === INTENTS.CODE_REQUEST || m.intent === INTENTS.CODE_EXPLAIN || m.intent === INTENTS.CODE_DEBUG) {
          m.confidence = Math.min(m.confidence + 0.15, 1.0);
        }
      });
    }

    /* Sort by confidence */
    matches.sort((a, b) => b.confidence - a.confidence);

    if (matches.length === 0) {
      /* Default: if it ends with ?, it's a question; otherwise chat */
      const fallbackIntent = trimmed.endsWith('?') ? INTENTS.QUESTION : INTENTS.CHAT;
      return { intent: fallbackIntent, confidence: 0.3, secondary: null };
    }

    return {
      intent: matches[0].intent,
      confidence: matches[0].confidence,
      secondary: matches[1]?.intent || null
    };
  }

  /**
   * Quick check: is this a code-related intent?
   * @param {string} intent
   * @returns {boolean}
   */
  function isCodeIntent(intent) {
    return intent === INTENTS.CODE_REQUEST ||
           intent === INTENTS.CODE_EXPLAIN ||
           intent === INTENTS.CODE_DEBUG;
  }

  /**
   * Quick check: should this use an external provider?
   * Complex questions and code requests benefit from external AI.
   * @param {{intent: string, confidence: number}} result
   * @returns {boolean}
   */
  function prefersExternalProvider(result) {
    const complexIntents = [
      INTENTS.QUESTION, INTENTS.CODE_REQUEST, INTENTS.CODE_EXPLAIN,
      INTENTS.CODE_DEBUG, INTENTS.CREATIVE
    ];
    return complexIntents.includes(result.intent) && result.confidence < 0.9;
  }

  /* ── Public API ────────────────────────────────────────────────────────── */

  return {
    INTENTS,
    classify,
    isCodeIntent,
    prefersExternalProvider
  };
})();

window.AielIntentClassifier = AielIntentClassifier;
