/**
 * Aiel AI — Provider Base Class
 * Abstract interface for all AI providers in the Aiel system.
 * Each provider implements health checks, chat, and streaming.
 *
 * Includes structured error types, retry logic, and circuit breaker.
 */
const AielProviderBase = (() => {
  'use strict';

  /* ── Error Types ─────────────────────────────────────────────────────────── */

  class AielProviderError extends Error {
    constructor(message, provider, cause) {
      super(message);
      this.name = 'AielProviderError';
      this.provider = provider || 'unknown';
      this.cause = cause || null;
      this.timestamp = Date.now();
    }
  }

  class AielNetworkError extends AielProviderError {
    constructor(message, provider, cause) {
      super(message, provider, cause);
      this.name = 'AielNetworkError';
      this.retryable = true;
    }
  }

  class AielTimeoutError extends AielProviderError {
    constructor(message, provider, timeout) {
      super(message, provider);
      this.name = 'AielTimeoutError';
      this.timeout = timeout;
      this.retryable = true;
    }
  }

  class AielRateLimitError extends AielProviderError {
    constructor(message, provider, retryAfter) {
      super(message, provider);
      this.name = 'AielRateLimitError';
      this.retryAfter = retryAfter || 60000;
      this.retryable = true;
    }
  }

  /* ── Circuit Breaker ─────────────────────────────────────────────────────── */

  class CircuitBreaker {
    constructor(options = {}) {
      this.failureThreshold = options.failureThreshold || 3;
      this.cooldownMs = options.cooldownMs || 60000;
      this.failures = 0;
      this.lastFailure = 0;
      this.state = 'closed'; /* closed = healthy, open = broken, half-open = testing */
    }

    /**
     * Check if the circuit allows requests.
     * @returns {boolean}
     */
    canRequest() {
      if (this.state === 'closed') return true;
      if (this.state === 'open') {
        /* Check if cooldown has elapsed */
        if (Date.now() - this.lastFailure > this.cooldownMs) {
          this.state = 'half-open';
          return true;
        }
        return false;
      }
      /* half-open: allow one test request */
      return true;
    }

    /**
     * Record a successful request.
     */
    onSuccess() {
      this.failures = 0;
      this.state = 'closed';
    }

    /**
     * Record a failed request.
     */
    onFailure() {
      this.failures++;
      this.lastFailure = Date.now();
      if (this.failures >= this.failureThreshold) {
        this.state = 'open';
      }
    }

    /**
     * Reset the breaker.
     */
    reset() {
      this.failures = 0;
      this.lastFailure = 0;
      this.state = 'closed';
    }
  }

  /* ── Retry Logic ─────────────────────────────────────────────────────────── */

  /**
   * Execute an async function with exponential backoff retry.
   * @param {Function} fn — async function to execute
   * @param {object} options
   * @param {number} [options.maxRetries=2]
   * @param {number} [options.baseDelayMs=500]
   * @param {number} [options.maxDelayMs=10000]
   * @returns {Promise<*>}
   */
  async function withRetry(fn, options = {}) {
    const maxRetries = options.maxRetries ?? 2;
    const baseDelay = options.baseDelayMs ?? 500;
    const maxDelay = options.maxDelayMs ?? 10000;

    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn(attempt);
      } catch (err) {
        lastError = err;

        /* Don't retry non-retryable errors */
        if (err.retryable === false) throw err;

        /* Don't retry after last attempt */
        if (attempt >= maxRetries) throw err;

        /* Exponential backoff with jitter */
        const delay = Math.min(
          baseDelay * Math.pow(2, attempt) + Math.random() * baseDelay,
          maxDelay
        );
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw lastError;
  }

  /* ── Provider Base Class ─────────────────────────────────────────────────── */

  class Provider {
    /**
     * @param {object} config
     * @param {string} config.name — Provider name (e.g. 'ollama', 'chrome-ai')
     * @param {string} [config.displayName] — Human-readable name
     * @param {number} [config.priority=50] — Lower = higher priority (0-100)
     * @param {number} [config.timeoutMs=30000] — Request timeout
     * @param {number} [config.maxRetries=2] — Max retry attempts
     */
    constructor(config = {}) {
      this.name = config.name || 'unknown';
      this.displayName = config.displayName || this.name;
      this.priority = config.priority ?? 50;
      this.timeoutMs = config.timeoutMs ?? 30000;
      this.maxRetries = config.maxRetries ?? 2;

      /* Metrics */
      this.requestCount = 0;
      this.errorCount = 0;
      this.totalLatencyMs = 0;
      this.lastUsed = 0;
      this.lastError = null;

      /* Circuit breaker */
      this.circuit = new CircuitBreaker({
        failureThreshold: 3,
        cooldownMs: 60000
      });

      /* Health state */
      this._healthy = false;
      this._available = false;
      this._latencyMs = 9999;
    }

    /* ── Abstract methods (override in subclasses) ────────────────────────── */

    /**
     * Check if this provider is available (health check).
     * @returns {Promise<boolean>}
     */
    async checkHealth() {
      return false;
    }

    /**
     * Generate a chat response (non-streaming).
     * @param {Array<{role:string, content:string}>} messages
     * @param {object} options — {model, temperature, maxTokens}
     * @returns {Promise<string>} — Full response text
     */
    async generate(messages, options = {}) {
      throw new AielProviderError(`${this.name}: generate() not implemented`, this.name);
    }

    /**
     * Generate a streaming chat response.
     * @param {Array<{role:string, content:string}>} messages
     * @param {object} options — {model, temperature, maxTokens}
     * @returns {AsyncGenerator<string>} — Yields text chunks
     */
    async *stream(messages, options = {}) {
      /* Default: fall back to non-streaming */
      const result = await this.generate(messages, options);
      yield result;
    }

    /**
     * Get list of available models.
     * @returns {Promise<string[]>}
     */
    async listModels() {
      return [];
    }

    /* ── Concrete methods ─────────────────────────────────────────────────── */

    /**
     * Probe the provider's health and measure latency.
     * Updates internal health state.
     * @returns {Promise<boolean>}
     */
    async probe() {
      const start = Date.now();
      try {
        this._available = await this.checkHealth();
        this._healthy = this._available;
        if (this._available) {
          this._latencyMs = Date.now() - start;
          this.circuit.onSuccess();
        }
      } catch (_) {
        this._available = false;
        this._healthy = false;
        this._latencyMs = 9999;
      }
      return this._available;
    }

    /**
     * Execute a chat request with retry and circuit breaker.
     * @param {Array} messages
     * @param {object} options
     * @returns {Promise<string>}
     */
    async chat(messages, options = {}) {
      if (!this.circuit.canRequest()) {
        throw new AielProviderError(
          `${this.name}: circuit breaker open (too many failures)`,
          this.name
        );
      }

      const start = Date.now();
      this.requestCount++;

      try {
        const result = await withRetry(
          () => this.generate(messages, options),
          { maxRetries: this.maxRetries }
        );
        const duration = Date.now() - start;
        this._recordSuccess(duration);
        return result;
      } catch (err) {
        this._recordFailure(err);
        throw err;
      }
    }

    /**
     * Execute a streaming chat request with circuit breaker.
     * @param {Array} messages
     * @param {object} options
     * @returns {AsyncGenerator<string>}
     */
    async *chatStream(messages, options = {}) {
      if (!this.circuit.canRequest()) {
        throw new AielProviderError(
          `${this.name}: circuit breaker open`,
          this.name
        );
      }

      const start = Date.now();
      this.requestCount++;

      try {
        yield* this.stream(messages, options);
        const duration = Date.now() - start;
        this._recordSuccess(duration);
      } catch (err) {
        this._recordFailure(err);
        throw err;
      }
    }

    /**
     * Compute a routing score (lower = better).
     * @param {string} [strategy='balanced'] — 'latency' | 'cost' | 'balanced'
     * @returns {number}
     */
    score(strategy = 'balanced') {
      if (!this._healthy || !this._available) return Infinity;

      const latencyScore = this._latencyMs / 1000;
      const errorRate = this.requestCount > 0
        ? this.errorCount / this.requestCount
        : 0;
      const errorPenalty = errorRate * 500;
      const priorityBonus = this.priority / 100;

      switch (strategy) {
        case 'latency':
          return latencyScore + errorPenalty + priorityBonus;
        case 'availability':
          return errorPenalty + priorityBonus;
        default: /* balanced */
          return (latencyScore * 0.5) + errorPenalty + (priorityBonus * 0.3);
      }
    }

    /**
     * Get current provider status.
     * @returns {object}
     */
    getStatus() {
      return {
        name: this.name,
        displayName: this.displayName,
        healthy: this._healthy,
        available: this._available,
        latencyMs: this._latencyMs,
        requestCount: this.requestCount,
        errorCount: this.errorCount,
        avgLatencyMs: this.requestCount > 0
          ? Math.round(this.totalLatencyMs / this.requestCount)
          : 0,
        circuitState: this.circuit.state,
        lastError: this.lastError
      };
    }

    /* ── Internal ─────────────────────────────────────────────────────────── */

    _recordSuccess(durationMs) {
      this.totalLatencyMs += durationMs;
      this.lastUsed = Date.now();
      /* Exponential moving average for latency */
      const alpha = 0.3;
      this._latencyMs = alpha * durationMs + (1 - alpha) * this._latencyMs;
      this.circuit.onSuccess();
    }

    _recordFailure(err) {
      this.errorCount++;
      this.lastError = {
        message: err.message,
        name: err.name,
        timestamp: Date.now()
      };
      this.circuit.onFailure();
    }

    /**
     * Helper: fetch with timeout.
     * @param {string} url
     * @param {object} [fetchOptions]
     * @returns {Promise<Response>}
     */
    async _fetch(url, fetchOptions = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const resp = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal
        });
        return resp;
      } catch (err) {
        if (err.name === 'AbortError') {
          throw new AielTimeoutError(
            `${this.name}: request timed out after ${this.timeoutMs}ms`,
            this.name,
            this.timeoutMs
          );
        }
        throw new AielNetworkError(
          `${this.name}: network error — ${err.message}`,
          this.name,
          err
        );
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  /* ── Public API ────────────────────────────────────────────────────────── */

  return {
    Provider,
    CircuitBreaker,
    AielProviderError,
    AielNetworkError,
    AielTimeoutError,
    AielRateLimitError,
    withRetry
  };
})();

window.AielProviderBase = AielProviderBase;
