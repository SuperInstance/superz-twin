/**
 * @module rate-limiter
 * @description Rate limiting and request management for the superz-twin API layer.
 *
 * Provides:
 *   - **Token bucket** rate limiting (per-provider)
 *   - **Priority-based request queue** (high / normal / low)
 *   - **Automatic retry with exponential backoff** and jitter
 *   - **Rate limit info extraction** from API response headers
 *
 * Designed to be used alongside providers — either standalone or injected
 * into the provider factory.
 *
 * @example
 * import { RateLimiter } from './rate-limiter.js';
 *
 * const limiter = new RateLimiter({
 *   requestsPerMinute: 60,
 *   tokensPerMinute: 100000,
 * });
 *
 * // Wrap an API call with rate limiting
 * const result = await limiter.execute('openai', async () => {
 *   return await provider.chat(messages, options);
 * });
 *
 * // Or use directly
 * await limiter.wait('openai');
 * // ... make request
 * limiter.updateFromResponse('openai', response.headers);
 */

/**
 * Priority levels for queued requests.
 * @enum {number}
 */
export const Priority = Object.freeze({
  HIGH: 0,
  NORMAL: 1,
  LOW: 2,
});

/**
 * @typedef {object} RateLimiterConfig
 * @property {number} [requestsPerMinute=60] - Max requests per minute.
 * @property {number} [tokensPerMinute=Infinity] - Max tokens per minute.
 * @property {number} [burstSize=10] - Max burst (tokens in bucket).
 * @property {number} [maxQueueSize=100] - Max pending requests in queue.
 * @property {number} [maxRetries=3] - Max automatic retries.
 * @property {number} [baseDelayMs=1000] - Base retry delay.
 * @property {number} [maxDelayMs=30000] - Max retry delay.
 * @property {number} [backoffFactor=2] - Exponential backoff factor.
 */

/**
 * Per-provider rate limit state.
 * @typedef {object} ProviderRateLimitState
 * @property {object} tokenBucket - Token bucket state.
 * @property {number} tokenBucket.tokens - Current tokens.
 * @property {number} tokenBucket.maxTokens - Max tokens (burst size).
 * @property {number} tokenBucket.refillRate - Tokens per ms.
 * @property {number} tokenBucket.lastRefill - Last refill timestamp.
 * @property {object} info - Latest rate limit info from headers.
 * @property {number} totalRequests - Total requests made.
 * @property {number} totalRetries - Total retries triggered.
 */

/**
 * RateLimiter — token bucket rate limiter with priority queue and retry logic.
 */
export class RateLimiter {
  /**
   * Create a RateLimiter.
   * @param {RateLimiterConfig} [config={}]
   */
  constructor(config = {}) {
    /** @type {number} */
    this.requestsPerMinute = config.requestsPerMinute ?? 60;

    /** @type {number} */
    this.tokensPerMinute = config.tokensPerMinute ?? Infinity;

    /** @type {number} */
    this.burstSize = config.burstSize ?? Math.min(this.requestsPerMinute, 10);

    /** @type {number} */
    this.maxQueueSize = config.maxQueueSize ?? 100;

    /** @type {number} */
    this.maxRetries = config.maxRetries ?? 3;

    /** @type {number} */
    this.baseDelayMs = config.baseDelayMs ?? 1000;

    /** @type {number} */
    this.maxDelayMs = config.maxDelayMs ?? 30_000;

    /** @type {number} */
    this.backoffFactor = config.backoffFactor ?? 2;

    /** @type {Map<string, ProviderRateLimitState>} */
    this._states = new Map();

    /** @type {Array<{id: string, provider: string, fn: Function, priority: number, resolve: Function, reject: Function, attempt: number}>} */
    this._queue = [];

    /** @type {boolean} */
    this._processing = false;

    /** @type {number} */
    this._requestId = 0;
  }

  // -------------------------------------------------------------------------
  // Core API
  // -------------------------------------------------------------------------

  /**
   * Wait until a request can be made for the given provider.
   * Returns a promise that resolves when the rate limiter allows the request.
   *
   * @param {string} provider - Provider identifier (e.g. "openai", "claude").
   * @param {number} [priority=Priority.NORMAL] - Request priority.
   * @returns {Promise<void>}
   */
  async wait(provider, priority = Priority.NORMAL) {
    const state = this._getOrCreateState(provider);
    const now = Date.now();

    // Refill tokens
    this._refillBucket(state, now);

    // If we have tokens, proceed immediately
    if (state.tokenBucket.tokens >= 1) {
      state.tokenBucket.tokens -= 1;
      state.totalRequests++;
      return;
    }

    // Otherwise, enqueue and wait
    return new Promise((resolve, reject) => {
      if (this._queue.length >= this.maxQueueSize) {
        reject(new Error(`Rate limiter queue full (${this.maxQueueSize}) for provider: ${provider}`));
        return;
      }

      this._queue.push({
        id: ++this._requestId,
        provider,
        fn: null, // just a wait — no function to execute
        priority,
        resolve,
        reject,
        attempt: 0,
      });

      // Sort by priority (lower = higher priority), then by insertion order
      this._queue.sort((a, b) => a.priority - b.priority || a.id - b.id);

      if (!this._processing) {
        this._processQueue();
      }
    });
  }

  /**
   * Execute a function with rate limiting for the given provider.
   * Combines waiting, execution, and retry into a single call.
   *
   * @param {string} provider - Provider identifier.
   * @param {Function} fn - Async function to execute.
   * @param {object} [options={}]
   * @param {number} [options.priority=Priority.NORMAL] - Request priority.
   * @param {Function} [options.isRetryable] - Custom retryable check: (error) => boolean.
   * @param {number} [options.maxRetries] - Override global max retries for this call.
   * @returns {Promise<*>} The result of fn().
   */
  async execute(provider, fn, options = {}) {
    const {
      priority = Priority.NORMAL,
      isRetryable = defaultIsRetryable,
      maxRetries = this.maxRetries,
    } = options;

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Wait for rate limiter
      await this.wait(provider, priority);

      try {
        const result = await fn();
        return result;
      } catch (error) {
        lastError = error;
        const state = this._getOrCreateState(provider);
        state.totalRetries++;

        if (!isRetryable(error) || attempt >= maxRetries) {
          throw error;
        }

        // Calculate backoff delay
        const jitter = Math.random() * 500;
        const delay = Math.min(
          this.baseDelayMs * Math.pow(this.backoffFactor, attempt) + jitter,
          this.maxDelayMs
        );

        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw lastError;
  }

  // -------------------------------------------------------------------------
  // Rate limit info from API responses
  // -------------------------------------------------------------------------

  /**
   * Update rate limit state from API response headers.
   * Extracts rate limit info from common header patterns.
   *
   * @param {string} provider - Provider identifier.
   * @param {Headers|object} headers - Response headers.
   */
  updateFromResponse(provider, headers) {
    const state = this._getOrCreateState(provider);
    const h = headers instanceof Headers
      ? (name) => headers.get(name)
      : (name) => headers[name] ?? headers[name.toLowerCase()] ?? null;

    const getNum = (name) => {
      const val = h(name);
      return val != null ? parseInt(val, 10) : null;
    };

    // Try common header patterns from various providers
    const limitHeaders = [
      // OpenAI
      { limit: 'x-ratelimit-limit-requests', remaining: 'x-ratelimit-remaining-requests', reset: 'x-ratelimit-reset-requests' },
      // Anthropic
      { limit: 'anthropic-ratelimit-limit-requests', remaining: 'anthropic-ratelimit-remaining-requests', reset: 'anthropic-ratelimit-reset-requests' },
      // Generic
      { limit: 'x-ratelimit-limit', remaining: 'x-ratelimit-remaining', reset: 'x-ratelimit-reset' },
      // Standard
      { limit: 'rate-limit-limit', remaining: 'rate-limit-remaining', reset: 'rate-limit-reset' },
    ];

    for (const pattern of limitHeaders) {
      const limit = getNum(pattern.limit);
      if (limit != null && limit > 0) {
        const remaining = getNum(pattern.remaining) ?? 0;
        const resetSec = getNum(pattern.reset);

        state.info = {
          requestsLimit: limit,
          requestsRemaining: remaining,
          requestsResetMs: resetSec ? resetSec * 1000 : 60_000,
          tokensLimit: getNum('x-ratelimit-limit-tokens') ?? getNum('anthropic-ratelimit-limit-tokens') ?? 0,
          tokensRemaining: getNum('x-ratelimit-remaining-tokens') ?? getNum('anthropic-ratelimit-remaining-tokens') ?? 0,
          scope: h('x-ratelimit-scope') || 'user',
          _updatedAt: Date.now(),
        };

        // Adjust bucket size to match server-reported limits
        state.tokenBucket.maxTokens = Math.max(state.tokenBucket.maxTokens, limit);
        state.tokenBucket.tokens = Math.min(state.tokenBucket.tokens, remaining);

        break;
      }
    }
  }

  /**
   * Get current rate limit info for a provider.
   *
   * @param {string} provider - Provider identifier.
   * @returns {object|null} Current rate limit info, or null if no info available.
   */
  getRateLimitInfo(provider) {
    return this._states.get(provider)?.info ?? null;
  }

  /**
   * Get stats for all providers.
   *
   * @returns {Record<string, {totalRequests: number, totalRetries: number, queueLength: number, info: object|null}>}
   */
  getStats() {
    const stats = {};
    for (const [provider, state] of this._states) {
      stats[provider] = {
        totalRequests: state.totalRequests,
        totalRetries: state.totalRetries,
        queueLength: this._queue.filter((q) => q.provider === provider).length,
        info: state.info ?? null,
        bucketTokens: state.tokenBucket.tokens,
        bucketMaxTokens: state.tokenBucket.maxTokens,
      };
    }
    return stats;
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /**
   * Set rate limits for a specific provider.
   *
   * @param {string} provider - Provider identifier.
   * @param {object} limits
   * @param {number} [limits.requestsPerMinute] - Max requests per minute.
   * @param {number} [limits.tokensPerMinute] - Max tokens per minute.
   * @param {number} [limits.burstSize] - Max burst.
   */
  setLimits(provider, limits = {}) {
    const state = this._getOrCreateState(provider);

    if (limits.requestsPerMinute !== undefined) {
      state.tokenBucket.maxTokens = limits.burstSize ?? Math.min(limits.requestsPerMinute, 10);
      state.tokenBucket.refillRate = limits.requestsPerMinute / 60_000; // tokens per ms
    }

    if (limits.tokensPerMinute !== undefined) {
      this.tokensPerMinute = limits.tokensPerMinute;
    }
  }

  /**
   * Reset all rate limit state.
   */
  reset() {
    this._states.clear();
    this._queue = [];
    this._processing = false;
  }

  /**
   * Reset rate limit state for a specific provider.
   *
   * @param {string} provider - Provider identifier.
   */
  resetProvider(provider) {
    this._states.delete(provider);
    // Remove queued requests for this provider
    this._queue = this._queue.filter((q) => q.provider !== provider);
  }

  // -------------------------------------------------------------------------
  // Internal: token bucket
  // -------------------------------------------------------------------------

  /**
   * Get or create state for a provider.
   * @private
   * @param {string} provider
   * @returns {ProviderRateLimitState}
   */
  _getOrCreateState(provider) {
    if (!this._states.has(provider)) {
      const refillRate = this.requestsPerMinute / 60_000; // tokens per ms
      this._states.set(provider, {
        tokenBucket: {
          tokens: this.burstSize,
          maxTokens: this.burstSize,
          refillRate,
          lastRefill: Date.now(),
        },
        info: null,
        totalRequests: 0,
        totalRetries: 0,
      });
    }
    return this._states.get(provider);
  }

  /**
   * Refill the token bucket based on elapsed time.
   * @private
   * @param {ProviderRateLimitState} state
   * @param {number} [now=Date.now()]
   */
  _refillBucket(state, now = Date.now()) {
    const { tokenBucket } = state;
    const elapsed = now - tokenBucket.lastRefill;
    const refill = elapsed * tokenBucket.refillRate;

    tokenBucket.tokens = Math.min(
      tokenBucket.tokens + refill,
      tokenBucket.maxTokens
    );
    tokenBucket.lastRefill = now;
  }

  // -------------------------------------------------------------------------
  // Internal: queue processing
  // -------------------------------------------------------------------------

  /**
   * Process the queue of waiting requests.
   * @private
   */
  async _processQueue() {
    if (this._processing) return;
    this._processing = true;

    while (this._queue.length > 0) {
      const item = this._queue[0];
      const state = this._getOrCreateState(item.provider);
      this._refillBucket(state);

      if (state.tokenBucket.tokens >= 1) {
        state.tokenBucket.tokens -= 1;
        state.totalRequests++;
        this._queue.shift();
        item.resolve();
      } else {
        // Wait a bit before checking again
        const waitTime = Math.max(
          (1 - state.tokenBucket.tokens) / state.tokenBucket.refillRate,
          50
        );
        await new Promise((r) => setTimeout(r, Math.min(waitTime, 1000)));
      }
    }

    this._processing = false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Default check for whether an error is retryable.
 * @private
 * @param {Error} error
 * @returns {boolean}
 */
function defaultIsRetryable(error) {
  if (!error) return false;

  // ProviderError with retryable flag
  if (error.retryable === true) return true;
  if (error.retryable === false) return false;

  // HTTP status codes
  const status = error.statusCode ?? error.status;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;

  // Error messages
  const msg = (error.message || '').toLowerCase();
  if (msg.includes('rate limit')) return true;
  if (msg.includes('timeout')) return true;
  if (msg.includes('overloaded')) return true;
  if (msg.includes('capacity')) return true;
  if (msg.includes('econnreset')) return true;
  if (msg.includes('econnrefused')) return true;

  return false;
}

export default RateLimiter;
