/**
 * Aiel AI — Stream Decoder
 * Decodes SSE (Server-Sent Events) and JSONL streams from LLM providers.
 * Runs entirely in the browser using the ReadableStream API.
 */
const AielStreamDecoder = (() => {
  'use strict';

  /* ── Line Decoder ────────────────────────────────────────────────────────── */

  /**
   * Splits a byte/text stream into individual lines, handling \n, \r, \r\n.
   * Buffers partial lines across chunks.
   */
  class LineDecoder {
    constructor() {
      this._buffer = '';
    }

    /**
     * Feed a chunk of text and get back complete lines.
     * @param {string} chunk
     * @returns {string[]}
     */
    decode(chunk) {
      this._buffer += chunk;
      const lines = [];
      let start = 0;

      for (let i = 0; i < this._buffer.length; i++) {
        const ch = this._buffer[i];
        if (ch === '\n' || ch === '\r') {
          lines.push(this._buffer.slice(start, i));
          /* Handle \r\n as single newline */
          if (ch === '\r' && this._buffer[i + 1] === '\n') i++;
          start = i + 1;
        }
      }

      this._buffer = this._buffer.slice(start);
      return lines;
    }

    /**
     * Flush any remaining buffered text as a final line.
     * @returns {string[]}
     */
    flush() {
      if (this._buffer.length === 0) return [];
      const line = this._buffer;
      this._buffer = '';
      return [line];
    }
  }

  /* ── SSE Decoder ─────────────────────────────────────────────────────────── */

  /**
   * Parse a Server-Sent Events stream from a fetch Response.
   * Yields parsed `data` payloads (as strings or parsed JSON).
   *
   * @param {ReadableStream} stream — response.body
   * @param {object} [options]
   * @param {boolean} [options.parseJSON=true] — auto-parse data as JSON
   * @returns {AsyncGenerator<object|string>}
   */
  async function* decodeSSE(stream, options = {}) {
    const parseJSON = options.parseJSON !== false;
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');
    const lineDecoder = new LineDecoder();

    let currentEvent = null;
    let currentData = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = typeof value === 'string' ? value : decoder.decode(value, { stream: true });
        const lines = lineDecoder.decode(text);

        for (const line of lines) {
          /* Empty line = event boundary */
          if (line === '') {
            if (currentData.length > 0) {
              const data = currentData.join('\n');
              if (data === '[DONE]') return;

              if (parseJSON) {
                try {
                  yield JSON.parse(data);
                } catch (_) {
                  yield data;
                }
              } else {
                yield data;
              }
            }
            currentEvent = null;
            currentData = [];
            continue;
          }

          /* SSE field parsing */
          if (line.startsWith('data:')) {
            currentData.push(line.slice(5).trimStart());
          } else if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          }
          /* Ignore id:, retry:, and comment lines (starting with :) */
        }
      }

      /* Flush remaining data */
      const remaining = lineDecoder.flush();
      for (const line of remaining) {
        if (line.startsWith('data:')) {
          currentData.push(line.slice(5).trimStart());
        }
      }
      if (currentData.length > 0) {
        const data = currentData.join('\n');
        if (data !== '[DONE]') {
          if (parseJSON) {
            try { yield JSON.parse(data); } catch (_) { yield data; }
          } else {
            yield data;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /* ── JSONL Decoder ───────────────────────────────────────────────────────── */

  /**
   * Parse a JSON Lines stream (one JSON object per line).
   * @param {ReadableStream} stream
   * @returns {AsyncGenerator<object>}
   */
  async function* decodeJSONL(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');
    const lineDecoder = new LineDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = typeof value === 'string' ? value : decoder.decode(value, { stream: true });
        const lines = lineDecoder.decode(text);

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            yield JSON.parse(trimmed);
          } catch (_) {
            /* Skip malformed lines */
          }
        }
      }

      /* Flush remaining */
      const remaining = lineDecoder.flush();
      for (const line of remaining) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try { yield JSON.parse(trimmed); } catch (_) { /* skip */ }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /* ── ReadableStream → AsyncIterable polyfill ─────────────────────────────── */

  /**
   * Convert a ReadableStream to an async iterable if native iteration
   * is not supported (older browsers).
   * @param {ReadableStream} stream
   * @returns {AsyncIterable}
   */
  function streamToAsyncIterable(stream) {
    if (stream[Symbol.asyncIterator]) return stream;

    const reader = stream.getReader();
    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            const { done, value } = await reader.read();
            if (done) {
              reader.releaseLock();
              return { done: true, value: undefined };
            }
            return { done: false, value };
          },
          async return() {
            reader.releaseLock();
            return { done: true, value: undefined };
          }
        };
      }
    };
  }

  /* ── Public API ────────────────────────────────────────────────────────── */

  return {
    LineDecoder,
    decodeSSE,
    decodeJSONL,
    streamToAsyncIterable
  };
})();

window.AielStreamDecoder = AielStreamDecoder;
