/**
 * Aiel AI — Core AI Engine (v2.0)
 * Runs entirely in the browser: no API key, no server required.
 *
 * v2.0 delegates to the Provider Manager for multi-provider routing:
 *   1. Ollama (local, highest priority)
 *   2. OpenAI-compatible (configurable)
 *   3. Chrome Built-in AI (window.ai, Chrome 128+)
 *   4. Aiel Local Engine (always-available fallback)
 *
 * This file is the backward-compatible entry point.
 * All new logic lives in providers/ and model/.
 */
const AielEngine = (() => {

  /* ── State ─────────────────────────────────────────────────────────────── */

  let ready = false;
  let isInitialising = false;

  /* ── Initialisation ─────────────────────────────────────────────────────── */

  async function init(onProgress) {
    if (ready) return AielProviderManager.backend;
    if (isInitialising) return 'initialising';
    isInitialising = true;

    try {
      /* Initialise the custom model pipeline */
      if (typeof AielModel !== 'undefined') {
        await AielModel.init();
      }

      /* Delegate to Provider Manager (smart router) */
      const backend = await AielProviderManager.init(onProgress);
      ready = true;
      return backend;
    } catch (err) {
      console.warn('[Aiel] Engine init error:', err);
      ready = true;
      return 'local';
    } finally {
      isInitialising = false;
    }
  }

  /* ── Chat ───────────────────────────────────────────────────────────────── */

  /**
   * Generate a response for a given conversation.
   * Delegates to the Provider Manager which routes to the best provider.
   *
   * @param {Array<{role:'user'|'assistant', content:string}>} messages
   * @param {{mode:string}} options
   * @returns {AsyncGenerator<string>} - Yields text chunks for streaming display
   */
  async function* chat(messages, options = {}) {
    yield* AielProviderManager.chat(messages, options);
  }

  /**
   * Detect programming language from input (backward compat).
   * @param {string} input
   * @returns {string}
   */
  function detectLanguage(input) {
    if (typeof AielLocalProvider !== 'undefined') {
      return AielLocalProvider.detectLanguage(input);
    }
    return 'javascript';
  }

  /* ── Provider Management ─────────────────────────────────────────────────── */

  function getAllProviderStatus() {
    return AielProviderManager.getAllStatus();
  }

  async function updateProviderConfig(config) {
    return AielProviderManager.updateConfig(config);
  }

  async function listAllModels() {
    return AielProviderManager.listAllModels();
  }

  async function refreshProviders() {
    return AielProviderManager.refresh();
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */

  return {
    init,
    chat,
    detectLanguage,
    getAllProviderStatus,
    updateProviderConfig,
    listAllModels,
    refreshProviders,
    get backend() { return AielProviderManager?.backend || 'local'; },
    get isReady() { return ready; }
  };
})();

window.AielEngine = AielEngine;
