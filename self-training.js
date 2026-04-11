/**
 * Aiel AI — Self-Training Orchestrator
 * Coordinates autonomous learning: schedules fetches, routes data to the
 * knowledge ingestor, tracks progress, and respects rate limits.
 */
const AielSelfTrainer = (() => {
  'use strict';

  /* ── State ─────────────────────────────────────────────────────────────── */

  let isTraining = false;
  let isPaused = false;
  let intervalId = null;
  let idleCallbackId = null;
  let sessionItemsLearned = 0;

  /* Configuration defaults */
  const DEFAULT_CONFIG = {
    enabled: false,
    intervalMs: 30000,               /* 30 seconds between training cycles */
    maxItemsPerCycle: 5,             /* max items to ingest per cycle */
    maxTotalItems: 10000,            /* max total items in storage */
    categories: {
      words: true,
      articles: true,
      trivia: true,
      facts: true,
      books: true,
      images: true,
      aiLearning: true
    }
  };

  let config = { ...DEFAULT_CONFIG };

  /* Training source queue — round-robin through categories */
  const SOURCE_QUEUE = [
    'words', 'articles', 'trivia', 'facts', 'books', 'images', 'aiLearning'
  ];
  let currentSourceIndex = 0;

  /* Activity log (in-memory, last 50 entries) */
  let activityLog = [];

  /* ── Initialisation ────────────────────────────────────────────────────── */

  async function init() {
    /* Load saved config */
    const saved = await AielLearning.getPreference('selfTrainingConfig', null);
    if (saved) config = { ...DEFAULT_CONFIG, ...saved, categories: { ...DEFAULT_CONFIG.categories, ...(saved.categories || {}) } };

    /* Load saved activity log */
    const savedLog = await AielLearning.getPreference('trainingActivityLog', []);
    if (Array.isArray(savedLog)) activityLog = savedLog.slice(-50);

    /* Initialise sub-modules */
    await AielKnowledgeIngestor.init();
    await AielLearningBridge.init();

    /* Auto-start if enabled */
    if (config.enabled) startTraining();
  }

  /* ── Training control ──────────────────────────────────────────────────── */

  function startTraining() {
    if (isTraining) return;
    isTraining = true;
    isPaused = false;

    logActivity('🚀 Self-training started');

    /* Use requestIdleCallback for non-blocking training when available */
    scheduleNextCycle();

    /* Increment session counter */
    AielLearning.getPreference('trainingStats', { sessions: 0 }).then((stats) => {
      stats.sessions = (stats.sessions || 0) + 1;
      AielLearning.setPreference('trainingStats', stats);
    });
  }

  function stopTraining() {
    isTraining = false;
    isPaused = false;
    if (intervalId) { clearTimeout(intervalId); intervalId = null; }
    if (idleCallbackId && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(idleCallbackId);
      idleCallbackId = null;
    }
    logActivity('⏹️ Self-training stopped');
  }

  function pauseTraining() {
    isPaused = true;
    logActivity('⏸️ Self-training paused');
  }

  function resumeTraining() {
    if (!isTraining) return;
    isPaused = false;
    logActivity('▶️ Self-training resumed');
    scheduleNextCycle();
  }

  /* ── Scheduling ────────────────────────────────────────────────────────── */

  function scheduleNextCycle() {
    if (!isTraining || isPaused) return;

    if (typeof requestIdleCallback === 'function') {
      idleCallbackId = requestIdleCallback(() => {
        intervalId = setTimeout(async () => {
          await processQueue();
          scheduleNextCycle();
        }, config.intervalMs);
      }, { timeout: config.intervalMs + 5000 });
    } else {
      intervalId = setTimeout(async () => {
        await processQueue();
        scheduleNextCycle();
      }, config.intervalMs);
    }
  }

  /* ── Main processing loop ──────────────────────────────────────────────── */

  async function processQueue() {
    if (!isTraining || isPaused) return;

    /* Check storage limits */
    const stats = await AielKnowledgeIngestor.getStats();
    if (stats.total >= config.maxTotalItems) {
      logActivity('⚠️ Storage limit reached, pausing training');
      pauseTraining();
      return;
    }

    /* Pick the next source category (round-robin) */
    let attempts = 0;
    while (attempts < SOURCE_QUEUE.length) {
      const source = SOURCE_QUEUE[currentSourceIndex];
      currentSourceIndex = (currentSourceIndex + 1) % SOURCE_QUEUE.length;
      attempts++;

      if (!config.categories[source]) continue;

      try {
        const count = await fetchAndIngest(source);
        if (count > 0) {
          sessionItemsLearned += count;
          logActivity(`📚 Learned ${count} item(s) from ${source}`);

          /* Emit custom event for UI updates */
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('aiel-training-update', {
              detail: { source, count, total: stats.total + count }
            }));
          }
        }
        return; /* One source per cycle */
      } catch (err) {
        logActivity(`❌ Error fetching from ${source}: ${err.message}`);
      }
    }
  }

  /* ── Fetch and ingest dispatcher ───────────────────────────────────────── */

  async function fetchAndIngest(source) {
    let items = [];

    switch (source) {
      case 'words':
        items = await AielDataFetcher.fetchRandomWords(2);
        break;
      case 'articles': {
        const article = await AielDataFetcher.fetchWikipediaSummary('random');
        if (article) items = [article];
        break;
      }
      case 'trivia':
        items = await AielDataFetcher.fetchTrivia(null, 3);
        break;
      case 'facts': {
        const fact = await AielDataFetcher.fetchNumberFact();
        if (fact) items = [fact];
        break;
      }
      case 'books':
        items = await AielDataFetcher.fetchBookInfo();
        break;
      case 'images':
        items = await AielDataFetcher.fetchRandomImage();
        break;
      case 'aiLearning': {
        const topic = AielLearningBridge.pickNewTopic();
        if (topic) {
          /* Try Chrome AI first, then fall back to self-learning */
          let count = await AielLearningBridge.learnFromChromeAI(topic);
          if (count === 0) count = await AielLearningBridge.learnFromSelf(topic);
          return count;
        }
        return 0;
      }
      default:
        return 0;
    }

    /* Limit items per cycle */
    items = items.slice(0, config.maxItemsPerCycle);
    return AielKnowledgeIngestor.ingestBatch(items);
  }

  /* ── Manual training burst ─────────────────────────────────────────────── */

  /**
   * Perform a one-shot training burst: fetch from all enabled categories.
   * @returns {Promise<number>} total items learned
   */
  async function trainNow() {
    logActivity('⚡ Manual training burst started');
    let total = 0;

    for (const source of SOURCE_QUEUE) {
      if (!config.categories[source]) continue;
      try {
        const count = await fetchAndIngest(source);
        total += count;
      } catch (_) { /* skip errors */ }
    }

    logActivity(`✅ Training burst complete: ${total} items learned`);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aiel-training-update', {
        detail: { source: 'burst', count: total, total }
      }));
    }

    return total;
  }

  /* ── Configuration ─────────────────────────────────────────────────────── */

  async function updateConfig(updates) {
    config = {
      ...config,
      ...updates,
      categories: { ...config.categories, ...(updates.categories || {}) }
    };
    await AielLearning.setPreference('selfTrainingConfig', config);

    if (config.enabled && !isTraining) startTraining();
    if (!config.enabled && isTraining) stopTraining();
  }

  function getConfig() {
    return { ...config };
  }

  /* ── Status ────────────────────────────────────────────────────────────── */

  async function getTrainingStatus() {
    const stats = await AielKnowledgeIngestor.getStats();
    return {
      isTraining,
      isPaused,
      sessionItemsLearned,
      config: { ...config },
      stats,
      topicsLearned: AielLearningBridge.getLearnedTopicCount(),
      activityLog: [...activityLog]
    };
  }

  /* ── Activity log ──────────────────────────────────────────────────────── */

  function logActivity(message) {
    const entry = { message, timestamp: Date.now() };
    activityLog.push(entry);
    if (activityLog.length > 50) activityLog = activityLog.slice(-50);

    /* Persist log */
    AielLearning.setPreference('trainingActivityLog', activityLog);
  }

  function getActivityLog() {
    return [...activityLog];
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */

  return {
    init,
    startTraining,
    stopTraining,
    pauseTraining,
    resumeTraining,
    trainNow,
    processQueue,
    updateConfig,
    getConfig,
    getTrainingStatus,
    getActivityLog,
    get isActive() { return isTraining && !isPaused; }
  };
})();

window.AielSelfTrainer = AielSelfTrainer;
