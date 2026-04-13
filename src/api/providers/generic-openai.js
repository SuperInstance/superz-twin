/**
 * @module providers/generic-openai
 * @description Generic OpenAI-compatible LLM provider — the KEY provider that
 * makes superz-twin API-AGNOSTIC. Works with ANY endpoint that implements the
 * OpenAI Chat Completions format, including:
 *
 *   - Proxies: LiteLLM, OpenRouter, Helicone, etc.
 *   - Local models: Ollama, vLLM, TGI, LocalAI, LM Studio
 *   - Cloud services: Azure OpenAI, AWS Bedrock (via proxy), Google Vertex AI
 *   - Self-hosted: text-generation-webui, koboldcpp, aphrodite
 *
 * This provider is what enables users to configure superz-twin once and use it
 * with any backend by simply pointing `baseUrl` at their endpoint.
 *
 * Environment variables:
 *   GENERIC_API_KEY    — API key (may not be needed for local models)
 *   GENERIC_BASE_URL   — Base URL of the OpenAI-compatible endpoint
 *   GENERIC_MODEL      — Default model name
 *   GENERIC_TIMEOUT_MS — Request timeout in ms (default: 120000)
 */

import { BaseProvider, ProviderError } from '../provider-interface.js';

/**
 * Default timeout — generous since local models can be slow.
 * @type {number}
 */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Default retry configuration.
 * @type {object}
 */
const DEFAULT_RETRY = {
  maxRetries: 3,
  baseDelayMs: 2000,
  maxDelayMs: 60_000,
  backoffFactor: 2,
};

/**
 * Well-known proxy / local-server fingerprints for auto-configuration.
 * @type {Array<{pattern: RegExp, name: string, defaults: object}>}
 */
const KNOWN_ENDPOINTS = [
  {
    pattern: /ollama/i,
    name: 'Ollama',
    defaults: { defaultModel: 'llama3', timeoutMs: 300_000, apiKey: 'ollama' },
  },
  {
    pattern: /litellm/i,
    name: 'LiteLLM',
    defaults: { defaultModel: 'default', timeoutMs: 120_000 },
  },
  {
    pattern: /openrouter/i,
    name: 'OpenRouter',
    defaults: { defaultModel: 'openrouter/auto', timeoutMs: 120_000 },
  },
  {
    pattern: /lmstudio/i,
    name: 'LM Studio',
    defaults: { defaultModel: 'default', timeoutMs: 300_000, apiKey: 'lm-studio' },
  },
  {
    pattern: /localai/i,
    name: 'LocalAI',
    defaults: { defaultModel: 'default', timeoutMs: 300_000 },
  },
  {
    pattern: /vllm/i,
    name: 'vLLM',
    defaults: { defaultModel: 'default', timeoutMs: 300_000 },
  },
  {
    pattern: /text-generation-webui/i,
    name: 'text-generation-webui',
    defaults: { defaultModel: 'default', timeoutMs: 300_000 },
  },
  {
    pattern: /helicone/i,
    name: 'Helicone',
    defaults: { defaultModel: 'gpt-4o', timeoutMs: 120_000 },
  },
  {
    pattern: /bedrock/i,
    name: 'AWS Bedrock',
    defaults: { defaultModel: 'anthropic.claude-3-5-sonnet', timeoutMs: 120_000 },
  },
  {
    pattern: /azure/i,
    name: 'Azure OpenAI',
    defaults: { defaultModel: 'gpt-4o', timeoutMs: 120_000 },
  },
];

/**
 * Generic OpenAI-compatible LLM provider.
 *
 * This is the most important provider in the superz-twin ecosystem because
 * it enables API-agnostic operation. Users configure a single `baseUrl` and
 * optionally an `apiKey`, and the agent works with any backend.
 *
 * @example
 * // Use with Ollama
 * const provider = new GenericOpenAIProvider({
 *   baseUrl: 'http://localhost:11434/v1',
 *   model: 'llama3',
 * });
 *
 * @example
 * // Use with OpenRouter
 * const provider = new GenericOpenAIProvider({
 *   baseUrl: 'https://openrouter.ai/api/v1',
 *   apiKey: 'sk-or-...',
 *   model: 'anthropic/claude-3.5-sonnet',
 * });
 *
 * @example
 * // Use with LiteLLM proxy
 * const provider = new GenericOpenAIProvider({
 *   baseUrl: 'https://my-litellm.example.com/v1',
 *   apiKey: 'sk-...',
 *   model: 'gpt-4o',
 * });
 */
export class GenericOpenAIProvider extends BaseProvider {
  /**
   * Create a generic OpenAI-compatible provider.
   * @param {object} config
   * @param {string} [config.apiKey] - API key (env: GENERIC_API_KEY). Some local models don't need one.
   * @param {string} [config.baseUrl] - **REQUIRED** (env: GENERIC_BASE_URL). The OpenAI-compatible endpoint.
   * @param {string} [config.model] - Default model (env: GENERIC_MODEL).
   * @param {string} [config.displayName] - Human-readable name for this endpoint.
   * @param {number} [config.timeoutMs=120000] - Request timeout (env: GENERIC_TIMEOUT_MS).
   * @param {object} [config.retry={}] - Retry configuration.
   * @param {number} [config.maxTokens=4096] - Default max output tokens.
   * @param {object} [config.defaultHeaders={}] - Extra headers to send with every request.
   * @param {boolean} [config.strictMode=false] - Fail on non-standard responses vs. best-effort.
   * @param {boolean} [config.skipAuth=false] - Don't send Authorization header (for local models).
   * @param {object} [config.embeddingConfig={}] - Config for embedding endpoint if supported.
   * @param {string} [config.embeddingConfig.model] - Model for embeddings.
   * @param {boolean} [config.embeddingConfig.enabled=false] - Whether embeddings are available.
   */
  constructor(config = {}) {
    if (!config.baseUrl && !process.env.GENERIC_BASE_URL) {
      throw new ProviderError(
        'GenericOpenAIProvider requires a baseUrl. ' +
        'Set config.baseUrl or GENERIC_BASE_URL environment variable.',
        { retryable: false }
      );
    }

    const baseUrl = (config.baseUrl || process.env.GENERIC_BASE_URL).replace(/\/+$/, '');
    const detected = _detectEndpoint(baseUrl, config);

    super({
      apiKey: config.skipAuth
        ? null
        : config.apiKey || process.env.GENERIC_API_KEY || detected.defaults?.apiKey || null,
      baseUrl,
      model: config.model || process.env.GENERIC_MODEL || detected.defaults?.defaultModel || 'default',
    });

    this.name = config.displayName || detected.name || 'generic-openai';
    this.timeoutMs = config.timeoutMs ?? parseInt(process.env.GENERIC_TIMEOUT_MS, 10) ?? detected.defaults?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retry = { ...DEFAULT_RETRY, ...config.retry };
    this.defaultMaxTokens = config.maxTokens ?? 4096;
    this.defaultHeaders = config.defaultHeaders || {};
    this.strictMode = config.strictMode ?? false;
    this.skipAuth = config.skipAuth ?? false;
    this.detectedEndpoint = detected.name || null;
    this.embeddingConfig = config.embeddingConfig || { enabled: false };
    this.capabilities = this._buildCapabilities();
  }

  // -----------------------------------------------------------------------
  // Capabilities
  // -----------------------------------------------------------------------

  /** @inheritDoc */
  _buildCapabilities() {
    return {
      chat: true,
      completion: true,
      embedding: this.embeddingConfig.enabled ?? false,
      streaming: true, // assume streaming support (standard in OpenAI format)
      functionCalling: false, // unknown — probe or user can override
      vision: false, // unknown
      systemPrompts: true,
      tokenCounting: false, // varies by endpoint
      rateLimitInfo: false, // varies by endpoint
      supportedFeatures: ['openai-compatible', 'proxy-ready'],
    };
  }

  /**
   * Allow capabilities to be updated after probing the endpoint.
   * @param {Partial<import('../provider-interface.js').ProviderCapabilities>} caps
   */
  setCapabilities(caps) {
    this.capabilities = { ...this.capabilities, ...caps };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Chat completion — works with any OpenAI-compatible endpoint.
   * @inheritDoc
   */
  async chat(messages, options = {}) {
    const model = this._resolveModel(options.model);
    const payload = this._buildPayload(messages, options, model);

    if (options.stream) {
      return this._streamChat(payload);
    }

    return this._withRetry(() => this._sendChatRequest(payload));
  }

  /**
   * Simple text completion.
   * @inheritDoc
   */
  async complete(prompt, options = {}) {
    const messages = [{ role: 'user', content: prompt }];
    const result = await this.chat(messages, options);
    return {
      id: result.id,
      text: result.content,
      model: result.model,
      usage: result.usage,
      finishReason: result.finishReason,
    };
  }

  /**
   * Generate embeddings (if the endpoint supports it).
   * @inheritDoc
   */
  async embed(text, options = {}) {
    if (!this.capabilities.embedding) {
      throw new ProviderError(
        `${this.name} does not support embeddings. ` +
        `Enable by setting config.embeddingConfig.enabled = true.`,
        { retryable: false }
      );
    }

    const model = options?.model || this.embeddingConfig.model || 'default';
    const payload = { model, input: text };

    const url = `${this.baseUrl}/embeddings`;
    const headers = this._buildHeaders();
    const response = await this._request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }, this.timeoutMs);

    const data = await response.json();
    const embeddings = (data.data || []).map((d) => d.embedding);

    return {
      embedding: Array.isArray(text) ? embeddings : (embeddings[0] || []),
      model: data.model ?? model,
      usage: this._normaliseUsage(data.usage),
    };
  }

  /**
   * Probe the /models endpoint and return available models.
   * Many OpenAI-compatible servers expose this endpoint.
   * @inheritDoc
   */
  async listModels() {
    try {
      const url = `${this.baseUrl}/models`;
      const headers = this._buildHeaders();
      const response = await this._request(url, { method: 'GET', headers }, this.timeoutMs);
      const data = await response.json();

      const models = (data.data || [])
        .map((m) => ({
          id: m.id || m.model || m.name || 'unknown',
          name: m.name || m.id || m.model || 'unknown',
          contextWindow: m.context_length ?? m.contextWindow ?? m.max_context ?? 0,
          description: m.description || m.owned_by || '',
        }))
        .filter((m) => m.id !== 'unknown')
        .sort((a, b) => a.id.localeCompare(b.id));

      // If models were returned, the endpoint is working
      if (models.length > 0) {
        this.capabilities.tokenCounting = true;
      }

      return models;
    } catch (error) {
      // Not all endpoints support /models — return empty rather than fail
      if (!this.strictMode) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Test connectivity by sending a minimal request.
   * Also probes capabilities to update the capability flags.
   * @inheritDoc
   */
  async testConnection() {
    const start = Date.now();
    try {
      // First try listing models (lightweight)
      let models = [];
      try {
        models = await this.listModels();
      } catch {
        // /models may not be available, try a minimal chat
      }

      // If we got models, connection is verified
      if (models.length > 0) {
        return {
          success: true,
          latencyMs: Date.now() - start,
          model: this.defaultModel,
          detectedEndpoint: this.detectedEndpoint,
          availableModels: models.map((m) => m.id),
        };
      }

      // Fall back to a minimal chat request
      const result = await this.chat(
        [{ role: 'user', content: 'ping' }],
        { model: this.defaultModel, maxTokens: 5 }
      );
      return {
        success: true,
        latencyMs: Date.now() - start,
        model: result.model,
        detectedEndpoint: this.detectedEndpoint,
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        model: this.defaultModel,
        detectedEndpoint: this.detectedEndpoint,
        error: error.message,
      };
    }
  }

  /**
   * Probe the endpoint for advanced capabilities (function calling, vision, etc.)
   * This is called after testConnection to update capability flags.
   *
   * @param {object} [options={}]
   * @param {boolean} [options.skipFunctionCalling=false]
   * @param {boolean} [options.skipVision=false]
   * @returns {Promise<import('../provider-interface.js').ProviderCapabilities>}
   */
  async probeCapabilities(options = {}) {
    const caps = { ...this.capabilities };

    // Check if the endpoint reports token counting
    try {
      const models = await this.listModels();
      if (models.length > 0) {
        caps.tokenCounting = true;
        caps.rateLimitInfo = true; // assume yes if models endpoint works
      }
    } catch {
      // endpoint doesn't support /models
    }

    // Check function calling support with a minimal request
    if (!options.skipFunctionCalling) {
      try {
        const result = await this.chat(
          [{ role: 'user', content: 'What time is it?' }],
          {
            model: this.defaultModel,
            maxTokens: 10,
            tools: [{
              name: 'get_time',
              description: 'Get current time',
              parameters: { type: 'object', properties: {} },
            }],
          }
        );
        // If we get here without error, function calling is supported
        if (!result.tools || result.tools.length === 0) {
          caps.functionCalling = true; // accepted tools param
        } else {
          caps.functionCalling = true; // returned tool calls
        }
      } catch {
        caps.functionCalling = false;
      }
    }

    // Check vision support
    if (!options.skipVision) {
      try {
        await this.chat(
          [{
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
            ],
          }],
          { model: this.defaultModel, maxTokens: 5 }
        );
        caps.vision = true;
      } catch {
        caps.vision = false;
      }
    }

    this.capabilities = caps;
    return { ...caps };
  }

  // -----------------------------------------------------------------------
  // Internal: payload construction
  // -----------------------------------------------------------------------

  /**
   * Build the OpenAI-format payload.
   * @private
   * @param {Array} messages
   * @param {object} options
   * @param {string} model
   * @returns {object}
   */
  _buildPayload(messages, options, model) {
    const payload = {
      model,
      messages: messages.map((msg) => {
        const formatted = { role: msg.role, content: msg.content };
        if (msg.name) formatted.name = msg.name;
        if (msg.tool_calls) formatted.tool_calls = msg.tool_calls;
        if (msg.tool_call_id) formatted.tool_call_id = msg.tool_call_id;
        return formatted;
      }),
      max_tokens: options.maxTokens ?? this.defaultMaxTokens,
      temperature: options.temperature ?? 0.7,
      stream: options.stream ?? false,
    };

    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description || '',
          parameters: tool.parameters || { type: 'object', properties: {} },
        },
      }));
    }

    if (options.stopSequences) payload.stop = options.stopSequences;
    if (options.topP !== undefined) payload.top_p = options.topP;
    if (options.frequencyPenalty !== undefined) payload.frequency_penalty = options.frequencyPenalty;
    if (options.presencePenalty !== undefined) payload.presence_penalty = options.presencePenalty;
    if (options.seed !== undefined) payload.seed = options.seed;

    return payload;
  }

  // -----------------------------------------------------------------------
  // Internal: request pipeline
  // -----------------------------------------------------------------------

  /**
   * Build headers, merging in any user-specified defaults.
   * @private
   * @param {object} [extra={}]
   * @returns {object}
   */
  _buildHeaders(extra = {}) {
    if (this.skipAuth) {
      return {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'superz-twin/1.0',
        ...this.defaultHeaders,
        ...extra,
      };
    }
    return super._buildHeaders({ ...this.defaultHeaders, ...extra });
  }

  /**
   * Send chat request with best-effort response normalisation.
   * @private
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async _sendChatRequest(payload) {
    const url = `${this.baseUrl}/chat/completions`;
    const headers = this._buildHeaders();
    const response = await this._request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }, this.timeoutMs);

    let data;
    try {
      data = await response.json();
    } catch {
      throw new ProviderError('Endpoint returned non-JSON response', { retryable: false });
    }

    // Handle various error response formats
    if (data.error) {
      const errMsg = typeof data.error === 'string'
        ? data.error
        : data.error.message || JSON.stringify(data.error);
      throw new ProviderError(`Provider error: ${errMsg}`, {
        statusCode: data.error.code ?? data.statusCode ?? null,
        errorCode: data.error.type ?? data.error.code ?? null,
        retryable: isRetryableError(data.error),
      });
    }

    // Best-effort normalisation — different endpoints may format differently
    return this._normaliseChatResponse(data, payload.model);
  }

  /**
   * Normalise chat response from potentially varied formats.
   * @private
   * @param {object} data
   * @param {string} requestedModel
   * @returns {object}
   */
  _normaliseChatResponse(data, requestedModel) {
    // Standard OpenAI format
    const choice = data.choices?.[0];
    if (choice) {
      return {
        id: data.id ?? `gen-${Date.now()}`,
        content: choice.message?.content ?? '',
        role: choice.message?.role ?? 'assistant',
        model: data.model ?? requestedModel,
        usage: this._normaliseUsage(data.usage),
        finishReason: choice.finish_reason ?? 'stop',
        tools: choice.message?.tool_calls ?? null,
      };
    }

    // Alternative formats (some older/simpler endpoints)
    if (data.response || data.text || data.generated_text) {
      return {
        id: data.id ?? `gen-${Date.now()}`,
        content: data.response ?? data.text ?? data.generated_text,
        role: 'assistant',
        model: data.model ?? requestedModel,
        usage: this._normaliseUsage(data.usage),
        finishReason: data.finish_reason ?? data.stop_reason ?? 'stop',
        tools: null,
      };
    }

    if (this.strictMode) {
      throw new ProviderError('Unexpected response format from generic endpoint', {
        retryable: false,
      });
    }

    // Best effort — return whatever content we can find
    return {
      id: data.id ?? `gen-${Date.now()}`,
      content: data.content ?? data.message ?? JSON.stringify(data),
      role: 'assistant',
      model: data.model ?? requestedModel,
      usage: this._normaliseUsage(data.usage),
      finishReason: 'stop',
      tools: null,
    };
  }

  /**
   * Streaming chat.
   * @private
   * @param {object} payload
   * @returns {AsyncIterable}
   */
  async _streamChat(payload) {
    const url = `${this.baseUrl}/chat/completions`;
    const headers = this._buildHeaders();
    const response = await this._request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }, this.timeoutMs * 3);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    return {
      id: `gen-stream-${Date.now()}`,
      model: payload.model,
      [Symbol.asyncIterator]: async function* () {
        let buffer = '';
        let usage = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;
            if (!trimmed.startsWith('data: ')) continue;

            try {
              const parsed = JSON.parse(trimmed.slice(6));
              const delta = parsed.choices?.[0]?.delta;

              if (delta?.content) {
                yield { type: 'delta', delta: delta.content, role: delta.role ?? 'assistant' };
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  yield { type: 'tool_delta', index: tc.index, function: tc.function };
                }
              }

              if (parsed.usage) usage = parsed.usage;
            } catch {
              // skip malformed chunks
            }
          }
        }

        yield { type: 'done', usage: this._normaliseUsage(usage) };
      }.bind(this),
    };
  }

  /**
   * Retry with exponential backoff.
   * @private
   * @param {Function} fn
   * @returns {Promise<*>}
   */
  async _withRetry(fn) {
    let lastError;
    for (let attempt = 0; attempt <= this.retry.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!error.retryable || attempt >= this.retry.maxRetries) throw error;

        const jitter = Math.random() * 1500;
        const delay = Math.min(
          this.retry.baseDelayMs * Math.pow(this.retry.backoffFactor, attempt) + jitter,
          this.retry.maxDelayMs
        );

        await new Promise((r) => setTimeout(r, error.retryAfterMs ?? delay));
      }
    }
    throw lastError;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Detect known endpoint types from the base URL.
 * @private
 * @param {string} baseUrl
 * @param {object} config
 * @returns {{ name: string|null, defaults: object }}
 */
function _detectEndpoint(baseUrl, config = {}) {
  // Check URL patterns
  for (const entry of KNOWN_ENDPOINTS) {
    if (entry.pattern.test(baseUrl)) {
      return {
        name: entry.name,
        defaults: { ...entry.defaults },
      };
    }
  }

  // Check hostname patterns (common ports)
  try {
    const url = new URL(baseUrl);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      const port = parseInt(url.port, 10);
      if (port === 11434) return { name: 'Ollama', defaults: { defaultModel: 'llama3', timeoutMs: 300_000 } };
      if (port === 1234) return { name: 'LM Studio', defaults: { defaultModel: 'default', timeoutMs: 300_000 } };
      if (port === 8080) return { name: 'text-generation-webui', defaults: { defaultModel: 'default', timeoutMs: 300_000 } };
      return { name: 'Local Server', defaults: { timeoutMs: 300_000 } };
    }
  } catch {
    // invalid URL — will be caught at request time
  }

  return { name: null, defaults: {} };
}

/**
 * Determine if a provider error is retryable.
 * @private
 * @param {object|string} error
 * @returns {boolean}
 */
function isRetryableError(error) {
  const msg = typeof error === 'string' ? error.toLowerCase() : (
    (error.message || error.code || '').toString().toLowerCase()
  );
  return (
    msg.includes('rate') ||
    msg.includes('timeout') ||
    msg.includes('overloaded') ||
    msg.includes('capacity') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('500') ||
    msg.includes('429')
  );
}

export default GenericOpenAIProvider;
