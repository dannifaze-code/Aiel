/**
 * Aiel AI — AI-to-AI Learning Bridge
 * Lets Aiel learn from other available AI backends by generating questions,
 * querying them, and ingesting the responses into its knowledge base.
 */
const AielLearningBridge = (() => {
  'use strict';

  /* ── Topic question templates ──────────────────────────────────────────── */

  const QUESTION_TEMPLATES = [
    'What is {topic}?',
    'Explain {topic} in simple terms.',
    'What are the key concepts of {topic}?',
    'How does {topic} work?',
    'What are practical applications of {topic}?',
    'Give me an example of {topic}.',
    'What is the history of {topic}?',
    'Why is {topic} important?'
  ];

  const TOPIC_POOL = [
    /* Computer Science */
    'binary search', 'hash table', 'linked list', 'graph theory',
    'dynamic programming', 'recursion', 'big O notation', 'sorting algorithms',
    'tree data structure', 'REST API', 'web sockets', 'HTTP protocol',
    'TCP/IP', 'DNS', 'encryption', 'public key cryptography',
    /* Programming */
    'closures in JavaScript', 'Python decorators', 'async await',
    'object oriented programming', 'functional programming',
    'design patterns', 'MVC architecture', 'microservices',
    'version control with git', 'unit testing', 'continuous integration',
    /* Science */
    'photosynthesis', 'evolution', 'DNA replication', 'quantum mechanics',
    'theory of relativity', 'electromagnetic spectrum', 'periodic table',
    'chemical bonding', 'cell biology', 'ecosystems',
    /* Mathematics */
    'calculus derivatives', 'linear algebra', 'probability theory',
    'prime numbers', 'fibonacci sequence', 'set theory', 'boolean algebra',
    'statistics', 'geometry theorems', 'trigonometry',
    /* General knowledge */
    'industrial revolution', 'renaissance art', 'world wide web history',
    'space exploration', 'climate change', 'renewable energy',
    'artificial intelligence ethics', 'blockchain technology',
    'machine learning basics', 'neural networks'
  ];

  /* Track what topics we've already learned about */
  let learnedTopics = new Set();

  async function init() {
    try {
      const saved = await AielLearning.getPreference('learnedTopics', []);
      if (Array.isArray(saved)) saved.forEach((t) => learnedTopics.add(t));
    } catch (_) { /* first run */ }
  }

  /* ── Question generation ───────────────────────────────────────────────── */

  /**
   * Generate questions about a topic to ask AI backends.
   * @param {string} topic
   * @returns {string[]}
   */
  function generateQuestions(topic) {
    return QUESTION_TEMPLATES.map((tmpl) => tmpl.replace('{topic}', topic));
  }

  /**
   * Pick a topic that hasn't been learned yet.
   * @returns {string|null}
   */
  function pickNewTopic() {
    const unlearned = TOPIC_POOL.filter((t) => !learnedTopics.has(t));
    if (unlearned.length === 0) return null;
    return unlearned[Math.floor(Math.random() * unlearned.length)];
  }

  /* ── Learn from Chrome Built-in AI ─────────────────────────────────────── */

  async function learnFromChromeAI(topic) {
    if (!window.ai || !window.ai.languageModel) return 0;

    try {
      const capabilities = await window.ai.languageModel.capabilities();
      if (capabilities.available === 'no') return 0;

      const session = await window.ai.languageModel.create({
        systemPrompt: 'You are a knowledgeable teacher. Give clear, concise explanations. Keep answers under 200 words.'
      });

      const questions = generateQuestions(topic).slice(0, 3); /* limit to 3 questions */
      let ingested = 0;

      for (const question of questions) {
        try {
          const answer = await session.prompt(question);
          if (answer && answer.length > 20) {
            const item = {
              type: 'article',
              content: {
                title: topic,
                summary: answer.trim(),
                description: `AI-generated explanation of ${topic}`
              },
              source: 'Chrome Built-in AI',
              license: 'AI-generated (open)',
              keywords: AielDataFetcher.extractKeywordsFromText(`${topic} ${question}`),
              hash: AielDataFetcher.simpleHash(`chrome-ai:${topic}:${question}`),
              timestamp: Date.now()
            };

            const ok = await AielKnowledgeIngestor.ingestText(item);
            if (ok) ingested++;
          }
        } catch (_) { /* skip failed question */ }
      }

      session.destroy?.();

      if (ingested > 0) {
        learnedTopics.add(topic);
        await persistLearnedTopics();
        await incrementAIStat(ingested);
      }

      return ingested;
    } catch (_) {
      return 0;
    }
  }

  /* ── Learn from self (Transformers.js / local engine) ──────────────────── */

  /**
   * Use the local knowledge engine to generate Q&A patterns
   * about a topic by combining existing knowledge.
   */
  async function learnFromSelf(topic) {
    /* For the local engine, we synthesise patterns by combining known information */
    const questions = generateQuestions(topic);
    let ingested = 0;

    for (const question of questions.slice(0, 2)) {
      /* Check if we already have a pattern for this */
      const existing = await AielLearning.findPattern(question);
      if (existing && existing.score > 0.5) continue;

      /* Create a synthesised response from topic keywords */
      const keywords = AielDataFetcher.extractKeywordsFromText(topic);
      const response = `**${topic}** is an important concept. ` +
        `It relates to ${keywords.slice(0, 3).join(', ')} and is used in many fields. ` +
        `For more detailed information, try asking me specific questions about ${topic} ` +
        `or use my self-training feature to learn more from the internet.`;

      const item = {
        type: 'article',
        content: { title: topic, summary: response, description: '' },
        source: 'Aiel Self-Learning',
        license: 'Self-generated',
        keywords: keywords,
        hash: AielDataFetcher.simpleHash(`self:${topic}:${question}`),
        timestamp: Date.now()
      };

      const ok = await AielKnowledgeIngestor.ingestText(item);
      if (ok) ingested++;
    }

    if (ingested > 0) {
      learnedTopics.add(topic);
      await persistLearnedTopics();
      await incrementAIStat(ingested);
    }

    return ingested;
  }

  /* ── Cross-validation ──────────────────────────────────────────────────── */

  /**
   * If a topic has been learned from multiple sources, boost its score.
   * This is a lightweight version — it checks if a pattern exists and
   * reinforces it by "re-learning" with a higher implicit score.
   */
  async function crossValidate(topic) {
    const question = `What is ${topic}?`;
    const pattern = await AielLearning.findPattern(question);

    if (pattern && pattern.score >= 1) {
      /* Re-learn to boost score */
      const keywords = AielDataFetcher.extractKeywordsFromText(topic);
      await AielLearning.learnPattern(question, pattern.response, keywords);
      return true;
    }
    return false;
  }

  /* ── Helpers ────────────────────────────────────────────────────────────── */

  async function persistLearnedTopics() {
    const arr = [...learnedTopics].slice(-500);
    await AielLearning.setPreference('learnedTopics', arr);
  }

  async function incrementAIStat(count) {
    const stats = await AielLearning.getPreference('trainingStats', {
      total: 0, text: 0, qa: 0, code: 0, image: 0, aiGenerated: 0,
      lastRun: null, sessions: 0
    });
    stats.aiGenerated = (stats.aiGenerated || 0) + count;
    stats.total = (stats.total || 0) + count;
    stats.lastRun = Date.now();
    await AielLearning.setPreference('trainingStats', stats);
  }

  function getLearnedTopicCount() {
    return learnedTopics.size;
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */

  return {
    init,
    generateQuestions,
    pickNewTopic,
    learnFromChromeAI,
    learnFromSelf,
    crossValidate,
    getLearnedTopicCount
  };
})();

window.AielLearningBridge = AielLearningBridge;
