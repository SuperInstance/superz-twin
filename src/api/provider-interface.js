/**
 * @module provider-interface
 * @description Abstract base class for all LLM providers in the superz-twin API layer.
 * Every provider implementation must extend this class and override the required methods.
 * This is what makes superz-twin API-AGNOSTIC — new providers plug in seamlessly.
 */

/**
 * Custom error thrown when a provider method is called but not implemented.
 */
export class NotImplementedError extends Error {
  constructor(methodName, providerName = 'Provider') {
    super(`${providerName} does not implement: ${methodName}`);
    this.name = 'NotImplementedError';
    this.methodName = methodName;
    this.providerName = providerName;
  }
}

/**
 * Custom error for provider-specific failures with structured metadata.
 */
export class ProviderError extends Error {
  /**
   * @param {string} message - Human-readable error description.
   * @param {object} [details={}] - Additional error metadata.
   * @param {number} [details.statusCode] - HTTP status code, if applicable.
   * @param {string} [details.errorCode] - Provider-specific error code.
   * @param {boolean} [details.retryable] - Whether the request should be retried.
   * @param {number} [details.retryAfterMs] - Suggested retry delay in ms.
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'ProviderError';
    this.statusCode = details.statusCode ?? null;
    this.errorCode = details.errorCode ?? null;
    this.retryable = details.retryable ?? false;
    this.retryAfterMs = details.retryAfterMs ?? null;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Standardised capability flags that every provider must declare.
 * @typedef {object} ProviderCapabilities
 * @property {boolean} chat - Supports chat completions (multi-turn).
 * @property {boolean} completion - Supports simple text completions.
 * @property {boolean} embedding - Supports text embeddings.
 * @property {boolean} streaming - Supports streaming responses.
 * @property {boolean} functionCalling - Supports function/tool calling.
 * @property {boolean} vision - Supports image/vision inputs.
 * @property {boolean} systemPrompts - Supports dedicated system prompts.
 * @property {boolean} tokenCounting - Provider can report token counts.
 * @property {boolean} rateLimitInfo - Provider exposes rate limit headers.
 * @property {string[]} [supportedFeatures] - Free-form list of extra features.
 */

/**
 * Standardised rate-limit information.
 * @typedef {object} RateLimitInfo
 * @property {number} requestsLimit - Max requests per window.
 * @property {number} requestsRemaining - Remaining requests in window.
 * @property {number} requestsResetMs - Milliseconds until the window resets.
 * @property {number} tokensLimit - Max tokens per window (if applicable).
 * @property {number} tokensRemaining - Remaining tokens in window.
 * @property {string} [scope] - Scope of the rate limit (e.g. 'user', 'org', 'global').
 */

/**
 * Abstract base class that every LLM provider must extend.
 *
 * @example
 * import { BaseProvider } from './provider-interface.js';
 *
 * export class MyProvider extends BaseProvider {
 *   constructor(config) {
 *     super(config);
 *     this.name = 'my-provider';
 *   }
 *
 *   async chat(messages, options) {
 *     // ... implementation
 *   }
 * }
 */
export class BaseProvider {
  /**
   * Create a new provider instance.
   * @param {object} config - Provider configuration.
   * @param {string} [config.apiKey] - API key for authentication.
   * @param {string} [config.baseUrl] - Base URL for the provider API.
   * @param {string} [config.model] - Default model identifier.
   * @param {object} [config.options={}] - Additional provider-specific options.
   */
  constructor(config = {}) {
    if (new.target === BaseProvider) {
      throw new Error('BaseProvider is abstract and cannot be instantiated directly');
    }

    /** @type {string} Provider name — must be set by subclasses. */
    this.name = 'base';

    /** @type {object} Raw configuration object. */
    this.config = config;

    /** @type {string|null} API key. */
    this.apiKey = config.apiKey ?? null;

    /** @type {string} Base URL for API requests. */
    this.baseUrl = config.baseUrl ?? '';

    /** @type {string} Default model to use. */
    this.defaultModel = config.model ?? '';

    /** @type {object} Extra provider-specific options. */
    this.options = config.options ?? {};

    /** @type {ProviderCapabilities} Capabilities of this provider. */
    this.capabilities = this._buildCapabilities();

    /** @type {object|null} Last known rate-limit info. */
    this._lastRateLimitInfo = null;
  }

  // ---------------------------------------------------------------------------
  // Abstract methods — MUST be overridden by concrete providers
  // ---------------------------------------------------------------------------

  /**
   * Send a chat completion request.
   *
   * @param {Array<{role: string, content: string|object, name?: string}>} messages -
   *   The conversation messages in OpenAI-compatible format.
   * @param {object} [options={}] - Additional options.
   * @param {string} [options.model] - Model to use (overrides default).
   * @param {number} [options.temperature] - Sampling temperature.
   * @param {number} [options.maxTokens] - Maximum tokens in response.
   * @param {Array}  [options.tools] - Tool/function definitions.
   * @param {boolean}[options.stream] - Whether to stream the response.
   * @returns {Promise<{id: string, content: string, model: string, usage: object, finishReason: string, [key: string]: any}>}
   * @throws {NotImplementedError} If not overridden.
   */
  async chat(messages, options = {}) {
    throw new NotImplementedError('chat', this.name);
  }

  /**
   * Send a simple text completion request.
   *
   * @param {string} prompt - The prompt text.
   * @param {object} [options={}] - Completion options.
   * @param {string} [options.model] - Model to use.
   * @param {number} [options.temperature] - Sampling temperature.
   * @param {number} [options.maxTokens] - Maximum tokens in response.
   * @param {boolean}[options.stream] - Whether to stream the response.
   * @returns {Promise<{id: string, text: string, model: string, usage: object, finishReason: string}>}
   * @throws {NotImplementedError} If not overridden.
   */
  async complete(prompt, options = {}) {
    throw new NotImplementedError('complete', this.name);
  }

  /**
   * Generate an embedding vector for the given text.
   *
   * @param {string|Array<string>} text - Text or array of texts to embed.
   * @returns {Promise<{embedding: number[]|number[][], model: string, usage: object}>}
   * @throws {NotImplementedError} If not overridden.
   */
  async embed(text) {
    throw new NotImplementedError('embed', this.name);
  }

  /**
   * List available models from this provider.
   *
   * @returns {Promise<Array<{id: string, name: string, contextWindow?: number, description?: string}>>}
   * @throws {NotImplementedError} If not overridden.
   */
  async listModels() {
    throw new NotImplementedError('listModels', this.name);
  }

  /**
   * Test the connection to the provider API.
   *
   * @returns {Promise<{success: boolean, latencyMs: number, model: string, error?: string}>}
   * @throws {NotImplementedError} If not overridden.
   */
  async testConnection() {
    throw new NotImplementedError('testConnection', this.name);
  }

  // ---------------------------------------------------------------------------
  // Shared / default implementations
  // ---------------------------------------------------------------------------

  /**
   * Return the capabilities of this provider.
   * Subclasses should override `_buildCapabilities()` rather than this method.
   *
   * @returns {ProviderCapabilities}
   */
  getCapabilities() {
    return { ...this.capabilities };
  }

  /**
   * Return the most recent rate-limit information.
   *
   * @returns {RateLimitInfo|null}
   */
  rateLimitInfo() {
    return this._lastRateLimitInfo ? { ...this._lastRateLimitInfo } : null;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers — subclasses can use or override these
  // ---------------------------------------------------------------------------

  /**
   * Build the capabilities object. Override in subclasses.
   * @protected
   * @returns {ProviderCapabilities}
   */
  _buildCapabilities() {
    return {
      chat: false,
      completion: false,
      embedding: false,
      streaming: false,
      functionCalling: false,
      vision: false,
      systemPrompts: false,
      tokenCounting: false,
      rateLimitInfo: false,
      supportedFeatures: [],
    };
  }

  /**
   * Update internal rate-limit info from an API response.
   * @protected
   * @param {RateLimitInfo} info
   */
  _updateRateLimitInfo(info) {
    this._lastRateLimitInfo = {
      ...info,
      _updatedAt: Date.now(),
    };
  }

  /**
   * Build standardised request headers (including auth).
   * @protected
   * @param {object} [extra={}] - Additional headers.
   * @returns {object}
   */
  _buildHeaders(extra = {}) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'superz-twin/1.0',
      ...extra,
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  /**
   * Make an HTTP request with built-in timeout and error handling.
   * @protected
   * @param {string} url - Full URL.
   * @param {object} [fetchOptions={}] - Fetch options.
   * @param {number} [timeoutMs=60000] - Request timeout in milliseconds.
   * @returns {Promise<Response>} The fetch Response object.
   * @throws {ProviderError} On network or HTTP errors.
   */
  async _request(url, fetchOptions = {}, timeoutMs = 60000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const retryable = response.status === 429 || response.status >= 500;
        const retryAfterMs = response.headers.get('retry-after')
          ? parseInt(response.headers.get('retry-after'), 10) * 1000
          : null;

        throw new ProviderError(
          `HTTP ${response.status}: ${response.statusText}${body ? ` — ${body}` : ''}`,
          {
            statusCode: response.status,
            retryable,
            retryAfterMs,
          }
        );
      }

      return response;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error.name === 'AbortError') {
        throw new ProviderError(`Request timed out after ${timeoutMs}ms`, {
          retryable: true,
          retryAfterMs: 1000,
        });
      }
      throw new ProviderError(`Network error: ${error.message}`, {
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Normalise a model name to the provider's default if not specified.
   * @protected
   * @param {string|undefined} model
   * @returns {string}
   */
  _resolveModel(model) {
    return model || this.defaultModel || 'default';
  }

  /**
   * Extract usage/token information from a provider response into standard form.
   * @protected
   * @param {object} providerUsage - Raw usage from the provider.
   * @returns {{promptTokens: number, completionTokens: number, totalTokens: number}}
   */
  _normaliseUsage(providerUsage) {
    if (!providerUsage) {
      return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    }
    return {
      promptTokens: providerUsage.prompt_tokens ?? providerUsage.inputTokens ?? providerUsage.promptTokens ?? 0,
      completionTokens: providerUsage.completion_tokens ?? providerUsage.outputTokens ?? providerUsage.completionTokens ?? 0,
      totalTokens: providerUsage.total_tokens ?? providerUsage.totalTokens ?? providerUsage.totalTokens ?? 0,
    };
  }
}

export default BaseProvider;
