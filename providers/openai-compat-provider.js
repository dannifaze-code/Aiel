/**
 * Aiel AI — OpenAI-Compatible Provider
 * Connects to any OpenAI-compatible API endpoint.
 * Supports: OpenAI free-tier, LM Studio, text-generation-webui,
 * LocalAI, vLLM, or any OpenAI API-compatible server.
 */
const AielOpenAICompatProvider = (() => {
  'use strict';

  const { Provider, AielProviderError, AielRateLimitError } = AielProviderBase;

  /** Default configuration */
  const DEFAULTS = {
    baseUrl: '',
    model: 'gpt-3.5-turbo',
    temperature: 0.7,
    maxTokens: 2048
  };

  class OpenAICompatProvider extends Provider {
    /**
     * @param {object} config
     * @param {string} config.baseUrl — API base URL (e.g. http://localhost:1234/v1)
     * @param {string} [config.apiKey] — API key (optional for local servers)
     * @param {string} [config.model] — Default model
     * @param {number} [config.temperature]
     * @param {number} [config.maxTokens]
     */
    constructor(config = {}) {
      super({
        name: config.name || 'openai-compat',
        displayName: config.displayName || 'OpenAI Compatible',
        priority: config.priority ?? 30,
        timeoutMs: config.timeoutMs || 60000,
        maxRetries: 2,
        ...config
      });

      this.baseUrl = config.baseUrl || DEFAULTS.baseUrl;
      this.apiKey = config.apiKey || '';
      this.model = config.model || DEFAULTS.model;
      this.temperature = config.temperature ?? DEFAULTS.temperature;
      this.maxTokens = config.maxTokens ?? DEFAULTS.maxTokens;
      this._models = [];
    }

    /* ── Health Check ───────────────────────────────────────────────────────── */

    async checkHealth() {
      if (!this.baseUrl) return false;

      try {
        const headers = {};
        if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

        const resp = await this._fetch(`${this.baseUrl}/models`, { headers });
        if (!resp.ok) return false;

        const data = await resp.json();
        this._models = (data.data || []).map(m => m.id);
        return true;
      } catch (_) {
        return false;
      }
    }

    /* ── Chat (non-streaming) ───────────────────────────────────────────────── */

    async generate(messages, options = {}) {
      this._ensureConfigured();

      const body = {
        model: options.model || this.model,
        messages: this._formatMessages(messages),
        temperature: options.temperature ?? this.temperature,
        max_tokens: options.maxTokens ?? this.maxTokens,
        stream: false
      };

      const resp = await this._post('/chat/completions', body);
      const data = await resp.json();

      if (data.error) {
        throw new AielProviderError(
          `API error: ${data.error.message || JSON.stringify(data.error)}`,
          this.name
        );
      }

      return data.choices?.[0]?.message?.content || '';
    }

    /* ── Chat (streaming) ───────────────────────────────────────────────────── */

    async *stream(messages, options = {}) {
      this._ensureConfigured();

      const body = {
        model: options.model || this.model,
        messages: this._formatMessages(messages),
        temperature: options.temperature ?? this.temperature,
        max_tokens: options.maxTokens ?? this.maxTokens,
        stream: true
      };

      const resp = await this._post('/chat/completions', body);

      /* Parse SSE stream */
      for await (const event of AielStreamDecoder.decodeSSE(resp.body)) {
        if (typeof event === 'string') {
          if (event === '[DONE]') break;
          continue;
        }

        /* OpenAI streaming format: choices[0].delta.content */
        const content = event.choices?.[0]?.delta?.content;
        if (content) {
          yield content;
        }

        /* Check for stop */
        const finishReason = event.choices?.[0]?.finish_reason;
        if (finishReason === 'stop' || finishReason === 'length') break;
      }
    }

    /* ── Model Listing ──────────────────────────────────────────────────────── */

    async listModels() {
      if (this._models.length === 0 && this.baseUrl) {
        await this.checkHealth();
      }
      return [...this._models];
    }

    /* ── Configuration ──────────────────────────────────────────────────────── */

    updateConfig(config) {
      if (config.baseUrl !== undefined) this.baseUrl = config.baseUrl;
      if (config.apiKey !== undefined) this.apiKey = config.apiKey;
      if (config.model) this.model = config.model;
      if (config.temperature != null) this.temperature = config.temperature;
      if (config.maxTokens != null) this.maxTokens = config.maxTokens;
    }

    /* ── Helpers ─────────────────────────────────────────────────────────────── */

    _ensureConfigured() {
      if (!this.baseUrl) {
        throw new AielProviderError(
          'OpenAI-compatible provider not configured: no base URL set',
          this.name
        );
      }
    }

    _formatMessages(messages) {
      return messages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }));
    }

    async _post(path, body) {
      const headers = {
        'Content-Type': 'application/json'
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const resp = await this._fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (resp.status === 429) {
        const retryAfter = parseInt(resp.headers.get('retry-after') || '60', 10) * 1000;
        throw new AielRateLimitError(
          'Rate limited by API',
          this.name,
          retryAfter
        );
      }

      if (!resp.ok && !body.stream) {
        const text = await resp.text().catch(() => '');
        throw new AielProviderError(
          `API error (${resp.status}): ${text}`,
          this.name
        );
      }

      return resp;
    }
  }

  return { OpenAICompatProvider, DEFAULTS };
})();

window.AielOpenAICompatProvider = AielOpenAICompatProvider;
