/**
 * Aiel AI — Mood / Reward Tracking System
 * Tracks and computes the AI's "emotional" state based on learning signals.
 * Emits `aiel-mood-update` events for the graph/UI to consume.
 */
const AielMood = (() => {
  'use strict';

  /* ── Mood states ────────────────────────────────────────────────────────── */

  const MOOD_STATES = [
    { min: 0,  max: 20, emoji: '😴', label: 'Dormant',  color: '#888' },
    { min: 20, max: 40, emoji: '😐', label: 'Neutral',  color: '#aaa' },
    { min: 40, max: 60, emoji: '🙂', label: 'Content',  color: '#00d4aa' },
    { min: 60, max: 80, emoji: '😊', label: 'Happy',    color: '#6c63ff' },
    { min: 80, max: 100, emoji: '🎉', label: 'Excited', color: '#ffd700' }
  ];

  /* ── State ──────────────────────────────────────────────────────────────── */

  let moodScore = 30;                /* 0–100 */
  let recentSignals = [];            /* last 50 reward signals */
  let sessionStats = {
    itemsLearned: 0,
    patternsMatched: 0,
    duplicatesSkipped: 0,
    fetchErrors: 0,
    userFeedback: 0
  };
  let idleTimer = null;
  let initialized = false;

  /* ── Configuration ──────────────────────────────────────────────────────── */

  const SIGNAL_WEIGHTS = {
    itemLearned:      3,
    patternMatched:   5,
    duplicateSkipped: -1,
    fetchFailed:      -2,
    userPositive:     8,
    userNegative:     -5,
    idleDecay:        -0.5
  };

  const DECAY_INTERVAL_MS = 15000;   /* idle decay every 15s */
  const MAX_SIGNALS = 50;

  /* ── Initialisation ─────────────────────────────────────────────────────── */

  async function init() {
    if (initialized) return;
    initialized = true;

    /* Restore persisted mood state */
    try {
      if (typeof AielLearning !== 'undefined') {
        const saved = await AielLearning.getPreference('moodState', null);
        if (saved && typeof saved.score === 'number') {
          moodScore = clamp(saved.score, 0, 100);
        }
      }
    } catch (_) { /* first run */ }

    /* Start idle decay timer */
    startIdleDecay();
  }

  /* ── Reward signals ─────────────────────────────────────────────────────── */

  function onItemLearned(item) {
    const weight = SIGNAL_WEIGHTS.itemLearned;
    addSignal('itemLearned', weight, item);
    sessionStats.itemsLearned++;
  }

  function onPatternMatched(score) {
    const weight = SIGNAL_WEIGHTS.patternMatched * Math.min(score, 1);
    addSignal('patternMatched', weight);
    sessionStats.patternsMatched++;
  }

  function onDuplicateSkipped() {
    addSignal('duplicateSkipped', SIGNAL_WEIGHTS.duplicateSkipped);
    sessionStats.duplicatesSkipped++;
  }

  function onFetchFailed() {
    addSignal('fetchFailed', SIGNAL_WEIGHTS.fetchFailed);
    sessionStats.fetchErrors++;
  }

  function onUserFeedback(positive) {
    const weight = positive ? SIGNAL_WEIGHTS.userPositive : SIGNAL_WEIGHTS.userNegative;
    addSignal('userFeedback', weight);
    sessionStats.userFeedback += positive ? 1 : -1;
  }

  /* ── Core mood calculation ──────────────────────────────────────────────── */

  function addSignal(type, weight, meta) {
    const signal = { type, weight, timestamp: Date.now(), meta: meta || null };
    recentSignals.push(signal);
    if (recentSignals.length > MAX_SIGNALS) {
      recentSignals = recentSignals.slice(-MAX_SIGNALS);
    }

    /* Update mood score with smoothing */
    const targetDelta = weight;
    /* Apply with dampening — prevents wild swings */
    moodScore = clamp(moodScore + targetDelta * 0.6, 0, 100);

    /* Reset idle decay timer */
    resetIdleDecay();

    /* Emit event and persist */
    emitUpdate(type);
    persist();
  }

  function startIdleDecay() {
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = setInterval(() => {
      if (moodScore > 30) {
        moodScore = clamp(moodScore + SIGNAL_WEIGHTS.idleDecay, 0, 100);
        emitUpdate('idleDecay');
        persist();
      }
    }, DECAY_INTERVAL_MS);
  }

  function resetIdleDecay() {
    startIdleDecay();
  }

  /* ── Computed metrics ───────────────────────────────────────────────────── */

  function getSuccessRate() {
    const recent = recentSignals.slice(-20);
    if (recent.length === 0) return 0.5;
    const successes = recent.filter(s => s.weight > 0).length;
    return successes / recent.length;
  }

  function getLearningRate() {
    /* Items learned per minute over last 5 minutes */
    const fiveMinAgo = Date.now() - 300000;
    const recent = recentSignals.filter(s =>
      s.type === 'itemLearned' && s.timestamp > fiveMinAgo
    );
    return recent.length / 5;
  }

  function getDiversityScore() {
    const recent = recentSignals.slice(-20);
    const types = new Set(recent.map(s => s.type));
    return Math.min(types.size / 4, 1) * 100;
  }

  /* ── Getters ────────────────────────────────────────────────────────────── */

  function getMood() {
    const state = MOOD_STATES.find(s => moodScore >= s.min && moodScore < s.max)
      || MOOD_STATES[MOOD_STATES.length - 1];
    return {
      score: Math.round(moodScore),
      emoji: state.emoji,
      label: state.label,
      color: state.color,
      successRate: getSuccessRate(),
      learningRate: getLearningRate(),
      diversityScore: getDiversityScore(),
      sessionStats: { ...sessionStats }
    };
  }

  function getRecentSignals(count) {
    return recentSignals.slice(-(count || 20));
  }

  /* ── Helpers ────────────────────────────────────────────────────────────── */

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function emitUpdate(reason) {
    if (typeof window !== 'undefined') {
      const mood = getMood();
      window.dispatchEvent(new CustomEvent('aiel-mood-update', {
        detail: { ...mood, reason }
      }));
    }
  }

  async function persist() {
    try {
      if (typeof AielLearning !== 'undefined') {
        await AielLearning.setPreference('moodState', {
          score: moodScore,
          timestamp: Date.now()
        });
      }
    } catch (_) { /* non-critical */ }
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */

  return {
    init,
    onItemLearned,
    onPatternMatched,
    onDuplicateSkipped,
    onFetchFailed,
    onUserFeedback,
    getMood,
    getRecentSignals,
    getSuccessRate,
    getLearningRate,
    getDiversityScore
  };
})();

window.AielMood = AielMood;
