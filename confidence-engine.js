/**
 * Aiel AI — Confidence Engine
 * Manages pattern confidence scoring, topic mastery levels,
 * graduation/demotion rules, and milestone tracking.
 *
 * The goal: Aiel's Local Engine should eventually stop needing
 * external providers for topics it has mastered.
 */
const AielConfidenceEngine = (() => {
  'use strict';

  /* ── Constants ──────────────────────────────────────────────────────────── */

  /** Confidence factor weights (must sum to 1.0) */
  const WEIGHTS = {
    multiSource:       0.25,
    userFeedback:      0.25,
    repetitionConsist: 0.15,
    recency:           0.10,
    responseQuality:   0.15,
    crossValidation:   0.10
  };

  /** Topic mastery levels */
  const MASTERY_LEVELS = [
    { level: 0, name: 'Unknown',   threshold: 0.0,  spotCheckRate: 1.0  },
    { level: 1, name: 'Learning',  threshold: 0.2,  spotCheckRate: 1.0  },
    { level: 2, name: 'Familiar',  threshold: 0.5,  spotCheckRate: 0.3  },
    { level: 3, name: 'Confident', threshold: 0.7,  spotCheckRate: 0.10 },
    { level: 4, name: 'Mastered',  threshold: 0.85, spotCheckRate: 0.0  }
  ];

  /** Graduation requirements */
  const MIN_PATTERNS_FOR_GRADUATION = 5;
  const MIN_ACCEPTED_INTERACTIONS = 3;

  /** Staleness decay */
  const STALENESS_DECAY_PER_WEEK = 0.05;
  const STALENESS_FLOOR = 0.2;
  const STALENESS_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; /* 7 days */

  /** Milestones */
  const MILESTONES = {
    FIRST_50_MASTERED: { key: 'milestone_50_mastered', count: 50, message: '🎓 Aiel has mastered 50 topics and is becoming more self-sufficient!' },
    FIRST_MASTERED_TOPIC: { key: 'milestone_first_mastered', message: '🏆 Aiel now fully understands a topic and can answer without external AI!' },
    HALF_LOCAL: { key: 'milestone_half_local', message: '⚡ Aiel is now handling half of all questions on its own!' },
    NINETY_LOCAL: { key: 'milestone_ninety_local', message: '🧠 Aiel is nearly fully self-sufficient!' }
  };

  /* ── State ──────────────────────────────────────────────────────────────── */

  let topicMastery = {};       /* topic → {level, confidence, interactions, lastDemotion} */
  let interactionLog = {};     /* topic → [{accepted, timestamp}] */
  let queryStats = { total: 0, local: 0 };
  let achievedMilestones = {}; /* milestone key → true */
  let initialized = false;

  /* ── Initialization ─────────────────────────────────────────────────────── */

  async function init() {
    if (initialized) return;
    try {
      if (typeof AielLearning !== 'undefined') {
        topicMastery = await AielLearning.getPreference('topicMastery', {});
        interactionLog = await AielLearning.getPreference('interactionLog', {});
        queryStats = await AielLearning.getPreference('confidenceQueryStats', { total: 0, local: 0 });
        achievedMilestones = await AielLearning.getPreference('achievedMilestones', {});
      }
    } catch (_) { /* first run */ }
    initialized = true;
  }

  /* ── Confidence Scoring ─────────────────────────────────────────────────── */

  /**
   * Compute the confidence score for a pattern.
   * @param {object} pattern — {sources, score, timestamp, lastUsed, response, confidence}
   * @param {object} [context] — {crossValidated, userAccepted}
   * @returns {number} — Confidence score 0.0 to 1.0
   */
  function scorePattern(pattern, context = {}) {
    const factors = {};

    /* 1. Multi-source validation (0-1): did 2+ providers agree? */
    const sourceCount = (pattern.sources || []).length;
    factors.multiSource = sourceCount >= 3 ? 1.0 : sourceCount >= 2 ? 0.7 : sourceCount >= 1 ? 0.3 : 0;

    /* 2. User feedback signal (0-1) */
    const topic = pattern.topic || 'general';
    const logs = interactionLog[topic] || [];
    const recentLogs = logs.slice(-10);
    if (recentLogs.length === 0) {
      factors.userFeedback = 0.5; /* neutral if no data */
    } else {
      const accepted = recentLogs.filter(l => l.accepted).length;
      factors.userFeedback = accepted / recentLogs.length;
    }

    /* 3. Repetition consistency (0-1): higher score → more consistent usage */
    const patternScore = pattern.score || 1;
    factors.repetitionConsist = Math.min(patternScore / 10, 1.0);

    /* 4. Recency (0-1): decays over time */
    const ageMs = Date.now() - (pattern.lastUsed || pattern.timestamp || Date.now());
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    factors.recency = ageDays <= 1 ? 1.0 : ageDays <= 7 ? 0.8 : ageDays <= 30 ? 0.5 : 0.2;

    /* 5. Response quality heuristic (0-1) */
    factors.responseQuality = assessResponseQuality(pattern.response || '');

    /* 6. Cross-validation boost (0-1) */
    factors.crossValidation = context.crossValidated ? 1.0 : (sourceCount >= 2 ? 0.6 : 0);

    /* Weighted sum */
    const confidence =
      factors.multiSource       * WEIGHTS.multiSource +
      factors.userFeedback      * WEIGHTS.userFeedback +
      factors.repetitionConsist * WEIGHTS.repetitionConsist +
      factors.recency           * WEIGHTS.recency +
      factors.responseQuality   * WEIGHTS.responseQuality +
      factors.crossValidation   * WEIGHTS.crossValidation;

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Assess response quality heuristically (0-1).
   * @param {string} text
   * @returns {number}
   */
  function assessResponseQuality(text) {
    if (!text || text.length < 15) return 0;
    let score = 0.5;

    /* Decent length */
    if (text.length > 50) score += 0.1;
    if (text.length > 150) score += 0.1;

    /* Has formatting (markdown, lists, etc.) */
    if (/[*_#\-]/.test(text)) score += 0.1;

    /* Not a refusal/error */
    if (/sorry|can't|cannot|don't know|not sure|error|unable/i.test(text)) score -= 0.3;

    /* Has complete sentences */
    if (/[.!?]/.test(text)) score += 0.1;

    return Math.max(0, Math.min(1, score));
  }

  /* ── Topic Mastery ──────────────────────────────────────────────────────── */

  /**
   * Get the mastery level for a topic.
   * @param {string} topic
   * @returns {{level: number, name: string, confidence: number, spotCheckRate: number}}
   */
  function getTopicLevel(topic) {
    const entry = topicMastery[topic];
    if (!entry) {
      return { ...MASTERY_LEVELS[0], confidence: 0 };
    }
    const levelDef = MASTERY_LEVELS[entry.level] || MASTERY_LEVELS[0];
    return { ...levelDef, confidence: entry.confidence || 0 };
  }

  /**
   * Determine whether external providers should be queried for a topic.
   * @param {string} topic
   * @returns {{shouldQuery: boolean, spotCheck: boolean, level: number}}
   */
  function shouldQueryExternal(topic) {
    const entry = topicMastery[topic];
    if (!entry || entry.level <= 1) {
      return { shouldQuery: true, spotCheck: false, level: entry?.level || 0 };
    }

    const levelDef = MASTERY_LEVELS[entry.level];
    const spotCheck = Math.random() < levelDef.spotCheckRate;

    if (entry.level >= 4) {
      /* Mastered — only spot-check, never query */
      return { shouldQuery: false, spotCheck, level: 4 };
    }
    if (entry.level >= 3) {
      /* Confident — use local, spot-check 10% */
      return { shouldQuery: false, spotCheck, level: 3 };
    }
    if (entry.level >= 2) {
      /* Familiar — use local, spot-check 30% */
      return { shouldQuery: false, spotCheck, level: 2 };
    }

    return { shouldQuery: true, spotCheck: false, level: entry.level };
  }

  /**
   * Update topic mastery based on pattern confidence scores.
   * @param {string} topic
   * @param {number} avgConfidence — Average confidence of patterns for this topic
   * @param {number} patternCount — Number of patterns for this topic
   */
  async function updateTopicMastery(topic, avgConfidence, patternCount) {
    if (!topicMastery[topic]) {
      topicMastery[topic] = { level: 0, confidence: 0, interactions: 0, patternsCount: 0 };
    }

    const entry = topicMastery[topic];
    entry.confidence = avgConfidence;
    entry.patternsCount = patternCount;

    /* Check graduation */
    const logs = interactionLog[topic] || [];
    const recentAccepted = logs.slice(-MIN_ACCEPTED_INTERACTIONS)
      .filter(l => l.accepted).length;
    const allRecentAccepted = logs.length >= MIN_ACCEPTED_INTERACTIONS &&
      recentAccepted >= MIN_ACCEPTED_INTERACTIONS;

    let newLevel = 0;
    for (let i = MASTERY_LEVELS.length - 1; i >= 0; i--) {
      if (avgConfidence >= MASTERY_LEVELS[i].threshold &&
          patternCount >= MIN_PATTERNS_FOR_GRADUATION &&
          allRecentAccepted) {
        newLevel = i;
        break;
      }
    }

    /* Only graduate up, never skip levels */
    if (newLevel > entry.level) {
      entry.level = Math.min(newLevel, entry.level + 1);
    }

    await persistState();
    await checkMilestones();
  }

  /* ── Interaction Recording ──────────────────────────────────────────────── */

  /**
   * Record a user interaction for a topic.
   * @param {string} topic
   * @param {boolean} accepted — true if user accepted, false if rephrased/retried
   */
  async function recordInteraction(topic, accepted) {
    if (!interactionLog[topic]) interactionLog[topic] = [];
    interactionLog[topic].push({ accepted, timestamp: Date.now() });

    /* Keep only last 20 interactions per topic */
    if (interactionLog[topic].length > 20) {
      interactionLog[topic] = interactionLog[topic].slice(-20);
    }

    /* Track query stats */
    queryStats.total++;
    if (accepted && topicMastery[topic]?.level >= 2) {
      queryStats.local++;
    }

    /* Check demotion on negative feedback */
    if (!accepted && topicMastery[topic]?.level >= 3) {
      await demoteTopic(topic);
    }

    await persistState();
    await checkMilestones();
  }

  /**
   * Record a cross-validation result for a topic.
   * @param {string} topic
   * @param {number} overlapScore — 0-1 overlap between providers
   */
  async function onCrossValidation(topic, overlapScore) {
    if (!topicMastery[topic]) {
      topicMastery[topic] = { level: 0, confidence: 0, interactions: 0, patternsCount: 0 };
    }

    /* Significant mismatch? Demote. */
    if (overlapScore < 0.3 && topicMastery[topic].level >= 2) {
      await demoteTopic(topic);
    } else if (overlapScore > 0.7) {
      /* Good agreement — boost confidence slightly */
      topicMastery[topic].confidence = Math.min(1, (topicMastery[topic].confidence || 0) + 0.05);
    }

    await persistState();
  }

  /* ── Demotion ───────────────────────────────────────────────────────────── */

  /**
   * Demote a topic's mastery level.
   * @param {string} topic
   */
  async function demoteTopic(topic) {
    if (!topicMastery[topic]) return;
    const entry = topicMastery[topic];
    if (entry.level > 0) {
      entry.level = Math.max(0, entry.level - 1);
      entry.lastDemotion = Date.now();
    }
    await persistState();
  }

  /* ── Staleness Decay ────────────────────────────────────────────────────── */

  /**
   * Apply staleness decay to all patterns.
   * Call periodically (e.g., once per session or daily).
   */
  async function applyDecay() {
    if (typeof AielLearning === 'undefined') return;
    try {
      const patterns = await AielLearning.getAllPatterns(1000);
      const now = Date.now();

      for (const pattern of patterns) {
        const age = now - (pattern.lastUsed || pattern.timestamp || now);
        if (age > STALENESS_THRESHOLD_MS) {
          const weeksStale = Math.floor(age / (7 * 24 * 60 * 60 * 1000));
          const decay = weeksStale * STALENESS_DECAY_PER_WEEK;
          const newConfidence = Math.max(STALENESS_FLOOR, (pattern.confidence || 0.3) - decay);
          if (newConfidence !== pattern.confidence) {
            await AielLearning.updatePattern(pattern.id, { confidence: newConfidence });
          }
        }
      }
    } catch (_) { /* non-critical */ }
  }

  /* ── Milestones ─────────────────────────────────────────────────────────── */

  /**
   * Check and emit milestone events.
   */
  async function checkMilestones() {
    if (typeof window === 'undefined') return;

    /* Count mastered patterns */
    const masteredTopics = Object.values(topicMastery).filter(t => t.level >= 4);

    /* First topic mastered */
    if (masteredTopics.length >= 1 && !achievedMilestones[MILESTONES.FIRST_MASTERED_TOPIC.key]) {
      achievedMilestones[MILESTONES.FIRST_MASTERED_TOPIC.key] = true;
      emitMilestone(MILESTONES.FIRST_MASTERED_TOPIC.message);
    }

    /* 50 mastered topics */
    if (masteredTopics.length >= 50 && !achievedMilestones[MILESTONES.FIRST_50_MASTERED.key]) {
      achievedMilestones[MILESTONES.FIRST_50_MASTERED.key] = true;
      emitMilestone(MILESTONES.FIRST_50_MASTERED.message);
    }

    /* 50% local queries */
    if (queryStats.total >= 20) {
      const localRate = queryStats.local / queryStats.total;
      if (localRate >= 0.5 && !achievedMilestones[MILESTONES.HALF_LOCAL.key]) {
        achievedMilestones[MILESTONES.HALF_LOCAL.key] = true;
        emitMilestone(MILESTONES.HALF_LOCAL.message);
      }
      if (localRate >= 0.9 && !achievedMilestones[MILESTONES.NINETY_LOCAL.key]) {
        achievedMilestones[MILESTONES.NINETY_LOCAL.key] = true;
        emitMilestone(MILESTONES.NINETY_LOCAL.message);
      }
    }

    await persistState();
  }

  function emitMilestone(message) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aiel-milestone', {
        detail: { message }
      }));
    }
  }

  /* ── Status / Diagnostics ───────────────────────────────────────────────── */

  /**
   * Get a summary of self-sufficiency status.
   * @returns {object}
   */
  function getStatus() {
    const topics = Object.entries(topicMastery);
    const levelCounts = [0, 0, 0, 0, 0];
    topics.forEach(([, t]) => { levelCounts[t.level] = (levelCounts[t.level] || 0) + 1; });

    return {
      totalTopics: topics.length,
      levels: {
        unknown: levelCounts[0],
        learning: levelCounts[1],
        familiar: levelCounts[2],
        confident: levelCounts[3],
        mastered: levelCounts[4]
      },
      queryStats: { ...queryStats },
      localRate: queryStats.total > 0 ? (queryStats.local / queryStats.total) : 0,
      milestones: { ...achievedMilestones }
    };
  }

  /**
   * Get all topic mastery data.
   * @returns {object}
   */
  function getAllTopicMastery() {
    return { ...topicMastery };
  }

  /* ── Persistence ────────────────────────────────────────────────────────── */

  async function persistState() {
    try {
      if (typeof AielLearning !== 'undefined') {
        await AielLearning.setPreference('topicMastery', topicMastery);
        await AielLearning.setPreference('interactionLog', interactionLog);
        await AielLearning.setPreference('confidenceQueryStats', queryStats);
        await AielLearning.setPreference('achievedMilestones', achievedMilestones);
      }
    } catch (_) { /* non-critical */ }
  }

  /* ── Batch Recompute ────────────────────────────────────────────────────── */

  /**
   * Recompute confidence for all patterns and update topic mastery.
   * Useful to run periodically or after significant learning.
   */
  async function recomputeAll() {
    if (typeof AielLearning === 'undefined') return;
    try {
      const patterns = await AielLearning.getAllPatterns(2000);
      const topicPatterns = {};

      /* Group by topic */
      for (const p of patterns) {
        const topic = p.topic || 'general';
        if (!topicPatterns[topic]) topicPatterns[topic] = [];
        topicPatterns[topic].push(p);
      }

      /* Score each pattern and update topic mastery */
      for (const [topic, pats] of Object.entries(topicPatterns)) {
        let totalConf = 0;
        for (const p of pats) {
          const conf = scorePattern(p);
          totalConf += conf;
          /* Update pattern confidence in DB */
          if (Math.abs((p.confidence || 0) - conf) > 0.05) {
            await AielLearning.updatePattern(p.id, { confidence: conf });
          }
        }
        const avgConf = pats.length > 0 ? totalConf / pats.length : 0;
        await updateTopicMastery(topic, avgConf, pats.length);
      }
    } catch (_) { /* non-critical */ }
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */

  return {
    init,
    scorePattern,
    getTopicLevel,
    shouldQueryExternal,
    updateTopicMastery,
    recordInteraction,
    onCrossValidation,
    demoteTopic,
    applyDecay,
    checkMilestones,
    getStatus,
    getAllTopicMastery,
    recomputeAll,
    MASTERY_LEVELS
  };
})();

window.AielConfidenceEngine = AielConfidenceEngine;
