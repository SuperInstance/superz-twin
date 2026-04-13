/**
 * @module providers/openai
 * @description OpenAI LLM provider implementation.
 * Extends BaseProvider with standard OpenAI Chat Completions API format,
 * function calling support, token counting, and model selection.
 *
 * Environment variables:
 *   OPENAI_API_KEY    — OpenAI API key
 *   OPENAI_BASE_URL   — Override the default base URL (e.g. for Azure)
 *   OPENAI_MODEL      — Default model identifier
 *   OPENAI_ORG_ID     — Optional OpenAI organisation ID
 */

import { BaseProvider, ProviderError } from '../provider-interface.js';

/**
 * Well-known OpenAI models.
 * @type {Array<{id: string, name: string, contextWindow: number, description: string}>}
 */
const OPENAI_MODELS = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    contextWindow: 128_000,
    description: 'Latest multimodal GPT-4o model.',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    contextWindow: 128_000,
    description: 'Fast and affordable GPT-4o variant.',
  },
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    contextWindow: 128_000,
    description: 'GPT-4 with 128k context and faster speed.',
  },
  {
    id: 'gpt-4',
    name: 'GPT-4',
    contextWindow: 8192,
    description: 'Original GPT-4 model.',
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    contextWindow: 16_385,
    description: 'Fast and cost-effective model.',
  },
  {
    id: 'o1',
    name: 'o1',
    contextWindow: 200_000,
    description: 'OpenAI reasoning model.',
  },
  {
    id: 'o1-mini',
    name: 'o1-mini',
    contextWindow: 128_000,
    description: 'Compact reasoning model.',
  },
  {
    id: 'o3-mini',
    name: 'o3-mini',
    contextWindow: 200_000,
    description: 'Latest compact reasoning model.',
  },
];

/**
 * Default retry configuration for OpenAI.
 * @type {object}
 */
const DEFAULT_RETRY = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffFactor: 2,
};

/**
 * OpenAI LLM provider.
 */
export class OpenAIProvider extends BaseProvider {
  /**
   * Create an OpenAI provider instance.
   * @param {object} config
   * @param {string} [config.apiKey] - OpenAI API key (falls back to env).
   * @param {string} [config.baseUrl] - Custom base URL.
   * @param {string} [config.model] - Default model.
   * @param {string} [config.orgId] - OpenAI organisation ID.
   * @param {number} [config.timeoutMs=60000] - Request timeout.
   * @param {object} [config.retry={}] - Retry configuration.
   * @param {number} [config.maxTokens=4096] - Default max output tokens.
   */
  constructor(config = {}) {
    super({
      ...config,
      apiKey: config.apiKey || process.env.OPENAI_API_KEY || null,
      baseUrl: config.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: config.model || process.env.OPENAI_MODEL || 'gpt-4o',
    });

    this.name = 'openai';
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.retry = { ...DEFAULT_RETRY, ...config.retry };
    this.orgId = config.orgId || process.env.OPENAI_ORG_ID || null;
    this.defaultMaxTokens = config.maxTokens ?? 4096;
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
      embedding: true,
      streaming: true,
      functionCalling: true,
      vision: true,
      systemPrompts: true,
      tokenCounting: true,
      rateLimitInfo: true,
      supportedFeatures: [
        'function-calling',
        'parallel-function-calling',
        'vision',
        'json-mode',
        'structured-outputs',
        'seed',
      ],
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Chat completion via OpenAI Chat Completions API.
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
   * Generate embeddings via OpenAI Embeddings API.
   * @inheritDoc
   */
  async embed(text) {
    const model = options?.model || 'text-embedding-3-small';
    const payload = {
      model,
      input: text,
    };

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
      embedding: Array.isArray(text) ? embeddings : embeddings[0] || [],
      model: data.model ?? model,
      usage: this._normaliseUsage(data.usage),
    };
  }

  /**
   * List available OpenAI models.
   * @inheritDoc
   */
  async listModels() {
    try {
      const url = `${this.baseUrl}/models`;
      const headers = this._buildHeaders();
      const response = await this._request(url, { method: 'GET', headers }, this.timeoutMs);
      const data = await response.json();
      return (data.data || [])
        .filter((m) => m.id && !m.id.includes('ft:')) // filter out fine-tunes by default
        .map((m) => ({
          id: m.id,
          name: m.id,
          contextWindow: 0, // OpenAI doesn't expose this in the list endpoint
          description: m.owned_by || '',
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch {
      return OPENAI_MODELS.map((m) => ({ ...m }));
    }
  }

  /**
   * Test connectivity to OpenAI API.
   * @inheritDoc
   */
  async testConnection() {
    const start = Date.now();
    try {
      const result = await this.chat(
        [{ role: 'user', content: 'ping' }],
        { model: this.defaultModel, maxTokens: 5 }
      );
      return {
        success: true,
        latencyMs: Date.now() - start,
        model: result.model,
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        model: this.defaultModel,
        error: error.message,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Internal: payload construction
  // -----------------------------------------------------------------------

  /**
   * Build the request payload in OpenAI format.
   * @private
   * @param {Array} messages
   * @param {object} options
   * @param {string} model
   * @returns {object}
   */
  _buildPayload(messages, options, model) {
    const payload = {
      model,
      messages: this._formatMessages(messages),
      max_tokens: options.maxTokens ?? this.defaultMaxTokens,
      temperature: options.temperature ?? 0.7,
      stream: options.stream ?? false,
    };

    // Function / tool calling
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

    // Response format (e.g. JSON mode)
    if (options.responseFormat) {
      payload.response_format = options.responseFormat;
    }

    // Seed for reproducibility
    if (options.seed !== undefined) {
      payload.seed = options.seed;
    }

    // Stop sequences
    if (options.stopSequences) {
      payload.stop = options.stopSequences;
    }

    // Top-p
    if (options.topP !== undefined) {
      payload.top_p = options.topP;
    }

    return payload;
  }

  /**
   * Format messages, handling tool results correctly.
   * @private
   * @param {Array} messages
   * @returns {Array}
   */
  _formatMessages(messages) {
    return messages.map((msg) => {
      const formatted = {
        role: msg.role,
        content: msg.content,
      };

      if (msg.name) formatted.name = msg.name;
      if (msg.tool_calls) formatted.tool_calls = msg.tool_calls;
      if (msg.tool_call_id) formatted.tool_call_id = msg.tool_call_id;

      // Handle vision content blocks
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        formatted.content = msg.content.map((block) => {
          if (block.type === 'image_url') {
            return { type: 'image_url', image_url: { url: block.imageUrl || block.image_url?.url } };
          }
          return block;
        });
      }

      return formatted;
    });
  }

  // -----------------------------------------------------------------------
  // Internal: request pipeline
  // -----------------------------------------------------------------------

  /**
   * Build standard OpenAI headers, including org-id if set.
   * @private
   * @param {object} [extra={}]
   * @returns {object}
   */
  _buildHeaders(extra = {}) {
    const headers = super._buildHeaders(extra);
    if (this.orgId) {
      headers['OpenAI-Organization'] = this.orgId;
    }
    return headers;
  }

  /**
   * Send chat request and normalise response.
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

    const data = await response.json();
    this._extractRateLimits(response.headers);

    const choice = data.choices?.[0];
    if (!choice) {
      throw new ProviderError('OpenAI returned no choices', { retryable: true });
    }

    return {
      id: data.id ?? `oai-${Date.now()}`,
      content: choice.message?.content ?? '',
      role: choice.message?.role ?? 'assistant',
      model: data.model ?? payload.model,
      usage: this._normaliseUsage(data.usage),
      finishReason: choice.finish_reason ?? 'stop',
      tools: choice.message?.tool_calls ?? null,
    };
  }

  /**
   * Streaming chat via OpenAI SSE.
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

    this._extractRateLimits(response.headers);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    return {
      id: `oai-stream-${Date.now()}`,
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
                  yield {
                    type: 'tool_delta',
                    index: tc.index,
                    id: tc.id,
                    function: tc.function,
                  };
                }
              }

              if (parsed.usage) usage = parsed.usage;
            } catch {
              // skip
            }
          }
        }

        yield { type: 'done', usage: this._normaliseUsage(usage) };
      }.bind(this),
    };
  }

  /**
   * Extract rate-limit info from OpenAI response headers.
   * @private
   * @param {Headers} headers
   */
  _extractRateLimits(headers) {
    const get = (name) => {
      const val = headers.get(name);
      return val ? parseFloat(val) : null;
    };

    const resetMs = (() => {
      const reset = get('x-ratelimit-reset-requests') ?? get('x-ratelimit-reset-tokens');
      if (reset == null) return 0;
      // OpenAI sends epoch seconds
      const epochSec = reset > 1e12 ? reset / 1000 : reset;
      return Math.max(0, (epochSec - Date.now() / 1000) * 1000);
    })();

    this._updateRateLimitInfo({
      requestsLimit: get('x-ratelimit-limit-requests') ?? 0,
      requestsRemaining: get('x-ratelimit-remaining-requests') ?? 0,
      requestsResetMs: resetMs,
      tokensLimit: get('x-ratelimit-limit-tokens') ?? 0,
      tokensRemaining: get('x-ratelimit-remaining-tokens') ?? 0,
      scope: headers.get('x-ratelimit-scope') || 'user',
    });
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

        const jitter = Math.random() * 1000;
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

export default OpenAIProvider;
