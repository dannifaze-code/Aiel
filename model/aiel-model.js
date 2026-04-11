/**
 * Aiel AI — Model Orchestrator
 * Ties together the intent classifier, topic extractor, confidence scorer,
 * and response generator into a unified model pipeline.
 *
 * This is the "brain" of Aiel's local AI — it decides how to process
 * each input and whether to use local generation or defer to external providers.
 */
const AielModel = (() => {
  'use strict';

  /* ── State ─────────────────────────────────────────────────────────────── */

  let initialized = false;
  let feedbackHistory = []; /* Last N feedback signals */
  const MAX_FEEDBACK_HISTORY = 100;

  /* ── Initialisation ────────────────────────────────────────────────────── */

  async function init() {
    if (initialized) return;

    /* Load feedback history */
    try {
      if (typeof AielLearning !== 'undefined') {
        const saved = await AielLearning.getPreference('modelFeedback', []);
        if (Array.isArray(saved)) feedbackHistory = saved.slice(-MAX_FEEDBACK_HISTORY);
      }
    } catch (_) { /* first run */ }

    initialized = true;
  }

  /* ── Main Analysis Pipeline ────────────────────────────────────────────── */

  /**
   * Analyze user input and produce a complete understanding.
   *
   * @param {string} input — User message
   * @param {object} [context] — {mode, history, messages}
   * @returns {Promise<object>} — Full analysis result
   */
  async function analyze(input, context = {}) {
    const mode = context.mode || 'chat';

    /* 1. Classify intent */
    const intentResult = AielIntentClassifier.classify(input, { mode });

    /* 2. Extract topics */
    const topics = AielTopicExtractor.extract(input, { maxTopics: 5 });
    const entities = AielTopicExtractor.extractEntities(input);
    const keywords = AielTopicExtractor.extractKeywords(input);

    /* 3. Check for learned patterns */
    let pattern = null;
    try {
      if (typeof AielLearning !== 'undefined') {
        pattern = await AielLearning.findPattern(input);
      }
    } catch (_) { /* non-critical */ }

    /* 4. Check knowledge base */
    let knowledge = null;
    try {
      if (typeof AielLearning !== 'undefined' && typeof AielLearning.searchKnowledge === 'function') {
        const results = await AielLearning.searchKnowledge(input, 3);
        if (results.length > 0) {
          const best = results[0];
          const content = best.content || best;
          if (typeof content === 'object') {
            if (content.summary) knowledge = content.summary;
            else if (content.definition) knowledge = `**${content.word || ''}**: ${content.definition}`;
            else if (content.fact) knowledge = content.fact;
          } else if (typeof content === 'string') {
            knowledge = content;
          }
          /* Validate quality */
          if (knowledge && typeof AielLearning.isValidResponse === 'function') {
            if (!AielLearning.isValidResponse(knowledge)) knowledge = null;
          }
        }
      }
    } catch (_) { /* non-critical */ }

    /* 5. Score confidence */
    const confidenceResult = AielConfidenceScorer.score({
      input,
      intentResult,
      hasPattern: pattern != null && pattern.score > 0.5,
      patternScore: pattern?.score || 0,
      hasKnowledge: knowledge != null,
      mode
    });

    return {
      input,
      intent: intentResult,
      topics,
      entities,
      keywords,
      pattern,
      knowledge,
      confidence: confidenceResult,
      mode
    };
  }

  /* ── Response Generation ───────────────────────────────────────────────── */

  /**
   * Generate a local response based on analysis.
   * Used when external providers are unavailable or confidence is high.
   *
   * @param {object} analysis — Result from analyze()
   * @returns {string}
   */
  function generateResponse(analysis) {
    const response = AielResponseGenerator.generate({
      input: analysis.input,
      intentResult: analysis.intent,
      topics: analysis.topics,
      pattern: analysis.pattern,
      knowledge: analysis.knowledge,
      mode: analysis.mode
    });

    return AielResponseGenerator.enhance(response, {
      intent: analysis.intent.intent,
      topics: analysis.topics,
      mode: analysis.mode
    });
  }

  /**
   * Should this request prefer an external provider?
   *
   * @param {object} analysis — Result from analyze()
   * @returns {boolean}
   */
  function shouldDeferToExternal(analysis) {
    /* Always handle locally: greetings, identity, feedback, math, commands */
    const localOnlyIntents = ['greeting', 'farewell', 'identity', 'feedback', 'command', 'math'];
    if (localOnlyIntents.includes(analysis.intent.intent)) return false;

    /* Check confidence */
    return analysis.confidence.recommendation === 'external' ||
           analysis.confidence.recommendation === 'external-preferred';
  }

  /* ── Feedback Loop ─────────────────────────────────────────────────────── */

  /**
   * Record user feedback for a response.
   * @param {object} feedback
   * @param {string} feedback.input — Original user input
   * @param {string} feedback.response — AI response
   * @param {boolean} feedback.positive — Was the response helpful?
   * @param {string} [feedback.provider] — Which provider generated it
   * @param {string} [feedback.intent] — Classified intent
   */
  async function recordFeedback(feedback) {
    feedbackHistory.push({
      ...feedback,
      timestamp: Date.now()
    });

    if (feedbackHistory.length > MAX_FEEDBACK_HISTORY) {
      feedbackHistory = feedbackHistory.slice(-MAX_FEEDBACK_HISTORY);
    }

    /* Persist */
    try {
      if (typeof AielLearning !== 'undefined') {
        await AielLearning.setPreference('modelFeedback', feedbackHistory);
      }
    } catch (_) { /* non-critical */ }

    /* Notify mood system */
    if (typeof AielMood !== 'undefined') {
      AielMood.onUserFeedback(feedback.positive);
    }
  }

  /**
   * Get accuracy metrics from feedback history.
   * @returns {object}
   */
  function getAccuracyMetrics() {
    if (feedbackHistory.length === 0) {
      return { total: 0, positive: 0, negative: 0, accuracy: 0 };
    }

    const positive = feedbackHistory.filter(f => f.positive).length;
    const negative = feedbackHistory.length - positive;
    const accuracy = positive / feedbackHistory.length;

    /* Per-provider metrics */
    const byProvider = {};
    for (const f of feedbackHistory) {
      const provider = f.provider || 'unknown';
      if (!byProvider[provider]) {
        byProvider[provider] = { total: 0, positive: 0 };
      }
      byProvider[provider].total++;
      if (f.positive) byProvider[provider].positive++;
    }

    for (const [key, val] of Object.entries(byProvider)) {
      byProvider[key].accuracy = val.positive / val.total;
    }

    return {
      total: feedbackHistory.length,
      positive,
      negative,
      accuracy,
      byProvider
    };
  }

  /* ── Public API ────────────────────────────────────────────────────────── */

  return {
    init,
    analyze,
    generateResponse,
    shouldDeferToExternal,
    recordFeedback,
    getAccuracyMetrics
  };
})();

window.AielModel = AielModel;
