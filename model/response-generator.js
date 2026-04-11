/**
 * Aiel AI — Response Generator
 * Template-based + retrieval-based response generation.
 * Generates context-aware responses using patterns, knowledge, and templates.
 */
const AielResponseGenerator = (() => {
  'use strict';

  /* ── Response Templates by Intent ────────────────────────────────────────── */

  const TEMPLATES = {
    question_fallback: [
      "That's a great question about **{topic}**! While I'm still learning about this, I can offer some thoughts:\n\n{content}\n\nWant me to look deeper into this? Try the 🧠 Feed AI button to teach me more!",
      "Interesting question! Here's what I know about **{topic}**:\n\n{content}\n\nI'm always learning — ask me again later for updated info! 📚",
      "Let me share what I've gathered about **{topic}**:\n\n{content}\n\nFor more detailed answers, you can teach me by using the Feed AI feature!"
    ],

    knowledge_response: [
      "🧠 From my knowledge base:\n\n{content}\n\n_Source: {source}_",
      "Here's what I've learned about **{topic}**:\n\n{content}\n\n_Sourced from my training data._",
      "📚 Based on my training:\n\n**{topic}**\n\n{content}"
    ],

    pattern_response: [
      "💡 Based on what I've learned:\n\n{content}",
      "From my experience:\n\n{content}",
      "Here's what I know:\n\n{content}"
    ],

    code_response: [
      "Here's your **{language}** code:\n\n```{language}\n{code}\n```\n\n{explanation}",
      "Here you go! 💻\n\n```{language}\n{code}\n```\n\n{explanation}",
      "**{language}** implementation:\n\n```{language}\n{code}\n```\n\n{explanation}"
    ],

    creative_response: [
      "{content}\n\n_✨ Created by Aiel AI_",
      "{content}\n\n---\n_Generated creatively by Aiel_"
    ],

    no_answer: [
      "I don't have a confident answer for that yet, but I'm always learning! 📖 You can:\n• Rephrase your question\n• Use the 🧠 Feed AI button to teach me about this topic\n• Try a more specific question\n\nWhat would you like to try?",
      "That's outside my current knowledge, but I love learning new things! 🚀 Try:\n• Breaking your question into smaller parts\n• Using Feed AI to expand my knowledge\n• Asking in a different way\n\nI'm here to help!",
      "I'm not sure about that one yet. My knowledge is growing every day! 💡 Here's what might help:\n• Ask me something more specific\n• Teach me with the Feed AI feature\n• Switch to Code mode for programming questions"
    ]
  };

  /* ── Response Generation ─────────────────────────────────────────────────── */

  /**
   * Generate a response using templates and available data.
   *
   * @param {object} params
   * @param {string} params.input — User input
   * @param {{intent: string, confidence: number}} params.intentResult
   * @param {{term: string, score: number}[]} params.topics — Extracted topics
   * @param {object} [params.pattern] — Matched pattern {response, score}
   * @param {string} [params.knowledge] — Knowledge base result
   * @param {string} [params.mode] — Current mode
   * @returns {string}
   */
  function generate(params) {
    const { input, intentResult, topics, pattern, knowledge, mode } = params;
    const topicStr = topics.map(t => t.term).join(', ') || 'your topic';

    /* Priority 1: Strong pattern match */
    if (pattern && pattern.score > 0.7) {
      return fillTemplate(pick(TEMPLATES.pattern_response), {
        content: pattern.response,
        topic: topicStr
      });
    }

    /* Priority 2: Knowledge base match */
    if (knowledge) {
      return fillTemplate(pick(TEMPLATES.knowledge_response), {
        content: knowledge,
        topic: topicStr,
        source: 'Aiel Knowledge Base'
      });
    }

    /* Priority 3: Intent-specific generation */
    switch (intentResult.intent) {
      case 'code_request':
      case 'code_explain':
      case 'code_debug':
        return generateCodeResponse(input, topics, mode);
      case 'creative':
        return generateCreativeResponse(input, topics);
      case 'question':
        return generateQuestionResponse(input, topics);
      default:
        return generateFallbackResponse(input, topics);
    }
  }

  /* ── Specialized Generators ──────────────────────────────────────────────── */

  function generateCodeResponse(input, topics, mode) {
    const entities = AielTopicExtractor.extractEntities(input);
    const lang = entities.languages[0] || 'JavaScript';
    const concept = topics[0]?.term || 'your request';

    return `I'd love to help with **${lang}** code for **${concept}**! 💻\n\n` +
      `For the best code generation experience:\n` +
      `• Switch to **Code Mode** using the mode buttons\n` +
      `• Be specific about what you need (e.g., "write a function that sorts an array")\n` +
      `• Mention the language if it's not ${lang}\n\n` +
      `I can generate code in JavaScript, Python, HTML, SQL, Rust, Go, Java, C++, and more!`;
  }

  function generateCreativeResponse(input, topics) {
    const topicStr = topics.map(t => t.term).join(' and ') || 'something wonderful';

    const creativeStarters = [
      `Here's a creative take on **${topicStr}**:\n\n`,
      `Let my imagination run with **${topicStr}**:\n\n`,
      `🎨 Getting creative with **${topicStr}**:\n\n`
    ];

    return pick(creativeStarters) +
      `*I'm better at this with external AI providers connected. ` +
      `For now, here's my best local attempt:*\n\n` +
      `The concept of ${topicStr} inspires endless possibilities. ` +
      `It connects to ideas about innovation, human creativity, and the pursuit of knowledge. ` +
      `Every great creation starts with a simple thought, much like this conversation.\n\n` +
      `_For richer creative content, try connecting a local Ollama model!_`;
  }

  function generateQuestionResponse(input, topics) {
    const topicStr = topics.map(t => t.term).join(', ') || 'that';

    return fillTemplate(pick(TEMPLATES.question_fallback), {
      topic: topicStr,
      content: `I have some knowledge about this topic from my training data and self-learning. ` +
        `The key concepts involve ${topicStr}, which is a fascinating area. ` +
        `For a more detailed and accurate answer, consider connecting a local AI model like Ollama.`
    });
  }

  function generateFallbackResponse(input, topics) {
    return pick(TEMPLATES.no_answer);
  }

  /* ── Template Helpers ────────────────────────────────────────────────────── */

  function fillTemplate(template, vars) {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      return vars[key] !== undefined ? vars[key] : match;
    });
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /* ── Batch Response Enhancement ──────────────────────────────────────────── */

  /**
   * Enhance a response with additional context.
   * @param {string} response — Base response
   * @param {object} context — {intent, topics, mode}
   * @returns {string}
   */
  function enhance(response, context = {}) {
    /* Add mode-specific tips */
    if (context.mode === 'code' && !/```/.test(response)) {
      response += '\n\n💡 _Tip: I work best with specific code requests like "write a function that..." or "create a class for..."_';
    }

    return response;
  }

  /* ── Public API ────────────────────────────────────────────────────────── */

  return {
    generate,
    enhance,
    TEMPLATES,
    fillTemplate
  };
})();

window.AielResponseGenerator = AielResponseGenerator;
