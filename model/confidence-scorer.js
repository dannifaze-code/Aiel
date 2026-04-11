/**
 * Aiel AI — Confidence Scorer
 * Determines how confident the local model is in generating a response,
 * and whether to defer to an external provider.
 *
 * Factors: intent match strength, knowledge coverage, pattern availability,
 * input complexity, and historical accuracy.
 */
const AielConfidenceScorer = (() => {
  'use strict';

  /* ── Score Thresholds ────────────────────────────────────────────────────── */

  const THRESHOLDS = {
    HIGH: 0.8,       /* Confident — use local */
    MEDIUM: 0.5,     /* Moderate — use local if no external available */
    LOW: 0.3,        /* Low — prefer external provider */
    VERY_LOW: 0.15   /* Very low — strongly prefer external */
  };

  /* ── Intent Confidence Map ───────────────────────────────────────────────── */

  /**
   * Base confidence for each intent type.
   * Higher = local engine handles well.
   */
  const INTENT_BASE_CONFIDENCE = {
    greeting: 0.99,
    farewell: 0.99,
    identity: 0.99,
    feedback: 0.95,
    command: 0.90,
    math: 0.85,
    chat: 0.40,
    question: 0.30,
    code_request: 0.25,
    code_explain: 0.30,
    code_debug: 0.20,
    creative: 0.25,
    image: 0.70, /* handled by __IMAGE_GEN__ marker */
    video: 0.70, /* handled by __VIDEO_GEN__ marker */
    unknown: 0.20
  };

  /* ── Scoring ─────────────────────────────────────────────────────────────── */

  /**
   * Calculate confidence score for a given input and context.
   *
   * @param {object} params
   * @param {string} params.input — User message
   * @param {{intent: string, confidence: number}} params.intentResult — From classifier
   * @param {boolean} [params.hasPattern] — Whether a learned pattern was found
   * @param {number} [params.patternScore] — Pattern match score (0-1)
   * @param {boolean} [params.hasKnowledge] — Whether knowledge base has relevant data
   * @param {string} [params.mode] — Current chat mode
   * @returns {{score: number, recommendation: string, factors: object}}
   */
  function score(params) {
    const {
      input = '',
      intentResult = { intent: 'unknown', confidence: 0 },
      hasPattern = false,
      patternScore = 0,
      hasKnowledge = false,
      mode = 'chat'
    } = params;

    const factors = {};

    /* 1. Base intent confidence */
    const baseConfidence = INTENT_BASE_CONFIDENCE[intentResult.intent] || 0.20;
    factors.intentBase = baseConfidence;

    /* 2. Intent classification strength */
    const classifierBoost = intentResult.confidence * 0.15;
    factors.classifierBoost = classifierBoost;

    /* 3. Pattern availability boost */
    let patternBoost = 0;
    if (hasPattern && patternScore > 0.7) {
      patternBoost = 0.3 + (patternScore - 0.7) * 0.5;
    } else if (hasPattern && patternScore > 0.5) {
      patternBoost = 0.15;
    }
    factors.patternBoost = patternBoost;

    /* 4. Knowledge base coverage */
    const knowledgeBoost = hasKnowledge ? 0.2 : 0;
    factors.knowledgeBoost = knowledgeBoost;

    /* 5. Input complexity penalty */
    const complexityPenalty = computeComplexityPenalty(input);
    factors.complexityPenalty = complexityPenalty;

    /* 6. Mode alignment bonus */
    let modeBonus = 0;
    if (mode === 'code' && intentResult.intent.startsWith('code_')) {
      modeBonus = 0.05;
    }
    factors.modeBonus = modeBonus;

    /* Combine scores */
    const rawScore = baseConfidence + classifierBoost + patternBoost +
                     knowledgeBoost + modeBonus - complexityPenalty;
    const finalScore = Math.max(0, Math.min(1, rawScore));

    /* Recommendation */
    let recommendation;
    if (finalScore >= THRESHOLDS.HIGH) {
      recommendation = 'local';
    } else if (finalScore >= THRESHOLDS.MEDIUM) {
      recommendation = 'local-preferred';
    } else if (finalScore >= THRESHOLDS.LOW) {
      recommendation = 'external-preferred';
    } else {
      recommendation = 'external';
    }

    return { score: finalScore, recommendation, factors };
  }

  /* ── Complexity Analysis ─────────────────────────────────────────────────── */

  /**
   * Estimate input complexity and return a penalty (0-0.3).
   * Complex inputs benefit more from external providers.
   * @param {string} input
   * @returns {number}
   */
  function computeComplexityPenalty(input) {
    if (!input) return 0;

    let penalty = 0;

    /* Length-based complexity */
    const wordCount = input.split(/\s+/).length;
    if (wordCount > 50) penalty += 0.15;
    else if (wordCount > 25) penalty += 0.08;
    else if (wordCount > 10) penalty += 0.03;

    /* Multiple questions */
    const questionMarks = (input.match(/\?/g) || []).length;
    if (questionMarks > 1) penalty += 0.05 * Math.min(questionMarks, 3);

    /* Technical depth indicators */
    if (/\b(implement|architect|design|optimize|refactor|migrate|scale|deploy)\b/i.test(input)) {
      penalty += 0.08;
    }

    /* Multi-step request indicators */
    if (/\b(then|after that|next|also|additionally|furthermore|step \d)\b/i.test(input)) {
      penalty += 0.05;
    }

    /* Code in the input (user pasting code for analysis) */
    if (/```[\s\S]*```/.test(input) || /\bfunction\s+\w+\s*\(/.test(input)) {
      penalty += 0.1;
    }

    return Math.min(penalty, 0.3);
  }

  /* ── Public API ────────────────────────────────────────────────────────── */

  return {
    score,
    THRESHOLDS,
    computeComplexityPenalty
  };
})();

window.AielConfidenceScorer = AielConfidenceScorer;
