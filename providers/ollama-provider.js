/**
 * Aiel AI — Ollama Provider
 * Connects to a locally-running Ollama instance (localhost:11434).
 * Zero cost, no API key, supports streaming.
 */
const AielOllamaProvider = (() => {
  'use strict';

  const { Provider, AielProviderError, AielNetworkError } = AielProviderBase;

  /** Default Ollama configuration */
  const DEFAULTS = {
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2:3b',
    temperature: 0.7,
    maxTokens: 2048
  };

  class OllamaProvider extends Provider {
    /**
     * @param {object} config
     * @param {string} [config.baseUrl] — Ollama server URL
     * @param {string} [config.model] — Default model name
     * @param {number} [config.temperature]
     * @param {number} [config.maxTokens]
     */
    constructor(config = {}) {
      super({
        name: 'ollama',
        displayName: 'Ollama (Local)',
        priority: 10, /* Highest priority — free, local, powerful */
        timeoutMs: config.timeoutMs || 120000, /* Ollama can be slow on first load */
        maxRetries: 1,
        ...config
      });

      this.baseUrl = config.baseUrl || DEFAULTS.baseUrl;
      this.model = config.model || DEFAULTS.model;
      this.temperature = config.temperature ?? DEFAULTS.temperature;
      this.maxTokens = config.maxTokens ?? DEFAULTS.maxTokens;
      this._models = [];
    }

    /* ── Health Check ───────────────────────────────────────────────────────── */

    async checkHealth() {
      try {
        const resp = await this._fetch(`${this.baseUrl}/api/tags`);
        if (!resp.ok) return false;
        const data = await resp.json();
        this._models = (data.models || []).map(m => m.name);
        return true;
      } catch (_) {
        return false;
      }
    }

    /* ── Chat (non-streaming) ───────────────────────────────────────────────── */

    async generate(messages, options = {}) {
      const model = options.model || this.model;
      const body = {
        model: this._normalizeModel(model),
        messages: this._formatMessages(messages),
        stream: false,
        options: {
          temperature: options.temperature ?? this.temperature,
          num_predict: options.maxTokens ?? this.maxTokens
        }
      };

      const resp = await this._fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new AielProviderError(
          `Ollama error (${resp.status}): ${text}`,
          this.name
        );
      }

      const data = await resp.json();
      return data.message?.content || '';
    }

    /* ── Chat (streaming) ───────────────────────────────────────────────────── */

    async *stream(messages, options = {}) {
      const model = options.model || this.model;
      const body = {
        model: this._normalizeModel(model),
        messages: this._formatMessages(messages),
        stream: true,
        options: {
          temperature: options.temperature ?? this.temperature,
          num_predict: options.maxTokens ?? this.maxTokens
        }
      };

      const resp = await this._fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new AielProviderError(
          `Ollama streaming error (${resp.status}): ${text}`,
          this.name
        );
      }

      /* Ollama streams JSONL (one JSON object per line) */
      for await (const obj of AielStreamDecoder.decodeJSONL(resp.body)) {
        if (obj.message?.content) {
          yield obj.message.content;
        }
        if (obj.done) break;
      }
    }

    /* ── Model Listing ──────────────────────────────────────────────────────── */

    async listModels() {
      if (this._models.length === 0) {
        await this.checkHealth();
      }
      return [...this._models];
    }

    /* ── Configuration ──────────────────────────────────────────────────────── */

    updateConfig(config) {
      if (config.baseUrl) this.baseUrl = config.baseUrl;
      if (config.model) this.model = config.model;
      if (config.temperature != null) this.temperature = config.temperature;
      if (config.maxTokens != null) this.maxTokens = config.maxTokens;
    }

    /* ── Helpers ─────────────────────────────────────────────────────────────── */

    _normalizeModel(model) {
      /* Strip provider prefix if present */
      if (model.startsWith('ollama/')) return model.slice(7);
      return model;
    }

    _formatMessages(messages) {
      return messages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }));
    }
  }

  return { OllamaProvider, DEFAULTS };
})();

window.AielOllamaProvider = AielOllamaProvider;
