/**
 * Aiel AI — Provider Manager (Smart Router)
 * Manages all AI providers, routes requests to the best available one,
 * handles fallback chains, and tracks provider health.
 *
 * Replaces the old ai-engine.js with a dynamic, extensible provider system.
 */
const AielProviderManager = (() => {
  'use strict';

  /* ── State ─────────────────────────────────────────────────────────────── */

  let providers = [];
  let activeProvider = null;
  let ready = false;
  let initialising = false;
  let strategy = 'balanced'; /* 'latency' | 'balanced' | 'availability' */
  let autoProbeTimer = null;

  /* Default provider configurations (stored/loaded from preferences) */
  const DEFAULT_CONFIG = {
    ollama: {
      enabled: true,
      baseUrl: 'http://localhost:11434',
      model: 'llama3.2:3b',
      temperature: 0.7,
      maxTokens: 2048
    },
    openaiCompat: {
      enabled: false,
      baseUrl: '',
      apiKey: '',
      model: '',
      temperature: 0.7,
      maxTokens: 2048
    },
    chromeAI: {
      enabled: true
    },
    local: {
      enabled: true
    },
    strategy: 'balanced'
  };

  let config = { ...DEFAULT_CONFIG };

  /* ── Initialisation ────────────────────────────────────────────────────── */

  /**
   * Initialise the provider manager.
   * Loads saved config, creates providers, probes health.
   * @param {Function} [onProgress] — Progress callback
   * @returns {Promise<string>} — Name of the active provider
   */
  async function init(onProgress) {
    if (ready) return activeProvider?.name || 'local';
    if (initialising) return 'initialising';
    initialising = true;

    onProgress?.('Initialising Aiel AI…');

    /* Load saved configuration */
    try {
      if (typeof AielLearning !== 'undefined') {
        const saved = await AielLearning.getPreference('providerConfig', null);
        if (saved) {
          config = {
            ...DEFAULT_CONFIG,
            ...saved,
            ollama: { ...DEFAULT_CONFIG.ollama, ...(saved.ollama || {}) },
            openaiCompat: { ...DEFAULT_CONFIG.openaiCompat, ...(saved.openaiCompat || {}) },
            chromeAI: { ...DEFAULT_CONFIG.chromeAI, ...(saved.chromeAI || {}) },
            local: { ...DEFAULT_CONFIG.local, ...(saved.local || {}) }
          };
        }
      }
    } catch (_) { /* first run — use defaults */ }

    strategy = config.strategy || 'balanced';

    /* Create providers */
    providers = [];

    /* 1. Ollama — highest priority local provider */
    if (config.ollama.enabled) {
      const ollama = new AielOllamaProvider.OllamaProvider({
        baseUrl: config.ollama.baseUrl,
        model: config.ollama.model,
        temperature: config.ollama.temperature,
        maxTokens: config.ollama.maxTokens
      });
      providers.push(ollama);
    }

    /* 2. OpenAI-compatible — user-configured endpoint */
    if (config.openaiCompat.enabled && config.openaiCompat.baseUrl) {
      const openai = new AielOpenAICompatProvider.OpenAICompatProvider({
        baseUrl: config.openaiCompat.baseUrl,
        apiKey: config.openaiCompat.apiKey,
        model: config.openaiCompat.model,
        temperature: config.openaiCompat.temperature,
        maxTokens: config.openaiCompat.maxTokens
      });
      providers.push(openai);
    }

    /* 3. Chrome Built-in AI — on-device */
    if (config.chromeAI.enabled) {
      const chrome = new AielChromeAIProvider.ChromeAIProvider();
      providers.push(chrome);
    }

    /* 4. Local engine — always-available fallback */
    if (config.local.enabled) {
      const local = new AielLocalProvider.LocalProvider();
      providers.push(local);
    }

    /* Probe all providers in parallel */
    onProgress?.('Checking available AI providers…');
    await probeAll();

    /* Select the best provider */
    activeProvider = selectBest();
    ready = true;
    initialising = false;

    const name = activeProvider?.displayName || 'Local Engine';
    onProgress?.(`Ready — using ${name}`);

    /* Start periodic health-check loop */
    startAutoProbe();

    return activeProvider?.name || 'local';
  }

  /* ── Provider Probing ──────────────────────────────────────────────────── */

  /**
   * Health-check all providers in parallel.
   */
  async function probeAll() {
    await Promise.allSettled(
      providers.map(p => p.probe())
    );
  }

  /**
   * Select the best available provider based on current strategy.
   * @returns {Provider}
   */
  function selectBest() {
    const available = providers.filter(p => p._available && p._healthy);

    if (available.length === 0) {
      /* Fall back to local if nothing else is available */
      const local = providers.find(p => p.name === 'local');
      if (local) {
        local._available = true;
        local._healthy = true;
        return local;
      }
      return null;
    }

    /* Sort by score (lower = better) */
    available.sort((a, b) => a.score(strategy) - b.score(strategy));
    return available[0];
  }

  /* ── Periodic Auto-Probe ──────────────────────────────────────────────── */

  /**
   * Start a periodic health-check loop.
   * Re-probes all providers and switches if a better one becomes available.
   * @param {number} [intervalMs=30000] — Probe interval in milliseconds
   */
  function startAutoProbe(intervalMs = 30000) {
    stopAutoProbe();
    autoProbeTimer = setInterval(async () => {
      try {
        await probeAll();
        const previous = activeProvider?.name;
        const best = selectBest();
        if (best && best.name !== previous) {
          activeProvider = best;
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('aiel-provider-switch', {
              detail: { provider: best.name, displayName: best.displayName }
            }));
          }
        }
      } catch (_) { /* non-critical */ }
    }, intervalMs);
  }

  /**
   * Stop the periodic health-check loop.
   */
  function stopAutoProbe() {
    if (autoProbeTimer) {
      clearInterval(autoProbeTimer);
      autoProbeTimer = null;
    }
  }

  /**
   * Get all currently healthy providers (for tandem learning).
   * @returns {Provider[]}
   */
  function getHealthyProviders() {
    return providers.filter(p => p._available && p._healthy);
  }

  /* ── Chat Interface ────────────────────────────────────────────────────── */

  /**
   * Generate a streaming chat response.
   * Routes to best provider with automatic fallback.
   *
   * @param {Array<{role:string, content:string}>} messages
   * @param {object} [options] — {mode, model, temperature, maxTokens}
   * @returns {AsyncGenerator<string>} — Yields text chunks
   */
  async function* chat(messages, options = {}) {
    if (!ready) {
      await init();
    }

    const tried = new Set();
    const sortedProviders = [...providers]
      .filter(p => p._available || p.name === 'local')
      .sort((a, b) => a.score(strategy) - b.score(strategy));

    for (const provider of sortedProviders) {
      if (tried.has(provider.name)) continue;
      tried.add(provider.name);

      try {
        activeProvider = provider;

        /* Emit provider switch event */
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('aiel-provider-switch', {
            detail: { provider: provider.name, displayName: provider.displayName }
          }));
        }

        yield* provider.chatStream(messages, options);
        return; /* Success — done */

      } catch (err) {
        /* Log error and try next provider */
        console.warn(`[Aiel] Provider ${provider.name} failed:`, err.message);

        /* Emit fallback event */
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('aiel-provider-fallback', {
            detail: {
              failed: provider.name,
              error: err.message,
              remaining: sortedProviders.filter(p => !tried.has(p.name)).length
            }
          }));
        }

        continue; /* Try next provider */
      }
    }

    /* All providers failed — yield an error message */
    yield "⚠️ I'm having trouble generating a response right now. " +
      "Please try again in a moment, or rephrase your question!";
  }

  /* ── Configuration ─────────────────────────────────────────────────────── */

  /**
   * Update provider configuration.
   * @param {object} updates — Partial config update
   */
  async function updateConfig(updates) {
    config = {
      ...config,
      ...updates,
      ollama: { ...config.ollama, ...(updates.ollama || {}) },
      openaiCompat: { ...config.openaiCompat, ...(updates.openaiCompat || {}) },
      chromeAI: { ...config.chromeAI, ...(updates.chromeAI || {}) },
      local: { ...config.local, ...(updates.local || {}) }
    };

    if (updates.strategy) strategy = updates.strategy;

    /* Persist */
    try {
      if (typeof AielLearning !== 'undefined') {
        await AielLearning.setPreference('providerConfig', config);
      }
    } catch (_) { /* non-critical */ }

    /* Reinitialize providers */
    ready = false;
    await init();
  }

  /**
   * Get current configuration.
   * @returns {object}
   */
  function getConfig() {
    return { ...config };
  }

  /* ── Status & Diagnostics ──────────────────────────────────────────────── */

  /**
   * Get status of all providers.
   * @returns {object[]}
   */
  function getAllStatus() {
    return providers.map(p => p.getStatus());
  }

  /**
   * Get the currently active provider name.
   * @returns {string}
   */
  function getActiveProvider() {
    return activeProvider?.name || 'local';
  }

  /**
   * Get the display name of the active provider.
   * @returns {string}
   */
  function getActiveDisplayName() {
    return activeProvider?.displayName || 'Aiel Local Engine';
  }

  /**
   * List all available models from all providers.
   * @returns {Promise<object>} — { providerName: [models] }
   */
  async function listAllModels() {
    const result = {};
    for (const p of providers) {
      if (p._available) {
        try {
          result[p.name] = await p.listModels();
        } catch (_) {
          result[p.name] = [];
        }
      }
    }
    return result;
  }

  /**
   * Force re-probe all providers.
   * @returns {Promise<void>}
   */
  async function refresh() {
    await probeAll();
    activeProvider = selectBest();
  }

  /* ── Public API ────────────────────────────────────────────────────────── */

  return {
    init,
    chat,
    updateConfig,
    getConfig,
    getAllStatus,
    getActiveProvider,
    getActiveDisplayName,
    listAllModels,
    refresh,
    probeAll,
    startAutoProbe,
    stopAutoProbe,
    getHealthyProviders,
    get backend() { return activeProvider?.name || 'local'; },
    get isReady() { return ready; },
    get providers() { return [...providers]; }
  };
})();

window.AielEngine = AielProviderManager; /* Backward compatible alias */
window.AielProviderManager = AielProviderManager;
