/**
 * Aiel AI — Chrome Built-in AI Provider
 * Uses the Chrome Built-in AI API (window.ai) available in Chrome 128+.
 * Zero cost, no API key, runs entirely on-device.
 */
const AielChromeAIProvider = (() => {
  'use strict';

  const { Provider, AielProviderError } = AielProviderBase;

  class ChromeAIProvider extends Provider {
    constructor(config = {}) {
      super({
        name: 'chrome-ai',
        displayName: 'Chrome Built-in AI',
        priority: 20, /* High priority — free, fast, on-device */
        timeoutMs: config.timeoutMs || 60000,
        maxRetries: 0, /* No retries for local model */
        ...config
      });

      this._session = null;
      this._capabilities = null;
    }

    /* ── Health Check ───────────────────────────────────────────────────────── */

    async checkHealth() {
      try {
        if (!window.ai || !window.ai.languageModel) return false;
        this._capabilities = await window.ai.languageModel.capabilities();
        return this._capabilities.available !== 'no';
      } catch (_) {
        return false;
      }
    }

    /* ── Session Management ─────────────────────────────────────────────────── */

    async _getSession() {
      if (this._session) return this._session;

      try {
        this._session = await window.ai.languageModel.create({
          systemPrompt: this._buildSystemPrompt()
        });
        return this._session;
      } catch (err) {
        throw new AielProviderError(
          'Failed to create Chrome AI session: ' + err.message,
          this.name,
          err
        );
      }
    }

    _buildSystemPrompt() {
      return [
        'You are Aiel, a helpful, free AI assistant.',
        'You are knowledgeable, concise, and friendly.',
        'You can help with coding, writing, analysis, math, science, and general knowledge.',
        'Always be helpful and provide clear, accurate answers.',
        'Format responses with markdown when appropriate.'
      ].join(' ');
    }

    /* ── Chat (non-streaming) ───────────────────────────────────────────────── */

    async generate(messages, options = {}) {
      const session = await this._getSession();
      const prompt = this._formatPrompt(messages);
      return await session.prompt(prompt);
    }

    /* ── Chat (streaming) ───────────────────────────────────────────────────── */

    async *stream(messages, options = {}) {
      const session = await this._getSession();
      const prompt = this._formatPrompt(messages);

      try {
        const stream = await session.promptStreaming(prompt);
        let previousText = '';
        for await (const chunk of stream) {
          /* Chrome AI may return cumulative text; yield only new content */
          if (chunk.length > previousText.length) {
            yield chunk.slice(previousText.length);
            previousText = chunk;
          } else if (chunk !== previousText) {
            yield chunk;
            previousText = chunk;
          }
        }
      } catch (err) {
        /* If session is destroyed, clear it for re-creation */
        this._session = null;
        throw new AielProviderError(
          'Chrome AI streaming failed: ' + err.message,
          this.name,
          err
        );
      }
    }

    /* ── Model Listing ──────────────────────────────────────────────────────── */

    async listModels() {
      if (this._capabilities) {
        return ['chrome-builtin-ai'];
      }
      return [];
    }

    /* ── Helpers ─────────────────────────────────────────────────────────────── */

    _formatPrompt(messages) {
      /* Chrome AI expects a single string prompt.
       * Format conversation context into a clear prompt. */
      if (messages.length === 1) {
        return messages[0].content;
      }

      /* Build conversation context */
      const parts = [];
      const recent = messages.slice(-6); /* Keep context manageable */

      for (const msg of recent) {
        if (msg.role === 'user') {
          parts.push(`User: ${msg.content}`);
        } else if (msg.role === 'assistant') {
          parts.push(`Assistant: ${msg.content}`);
        }
      }

      return parts.join('\n\n') + '\n\nAssistant:';
    }

    /**
     * Destroy the current session and release resources.
     */
    destroy() {
      if (this._session) {
        this._session.destroy?.();
        this._session = null;
      }
    }
  }

  return { ChromeAIProvider };
})();

window.AielChromeAIProvider = AielChromeAIProvider;
