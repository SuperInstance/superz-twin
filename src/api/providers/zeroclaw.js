/**
 * @module providers/zeroclaw
 * @description ZeroClaw LLM provider implementation.
 * Extends BaseProvider with ZeroClaw-specific API format, authentication,
 * retry logic, and streaming support.
 *
 * Environment variables:
 *   ZEROCLAW_API_KEY   — API key for ZeroClaw
 *   ZEROCLAW_BASE_URL  — Override the default base URL
 *   ZEROCLAW_MODEL     — Default model identifier
 */

import { BaseProvider, ProviderError } from '../provider-interface.js';

/**
 * Known ZeroClaw models with their metadata.
 * @type {Array<{id: string, name: string, contextWindow: number, description: string}>}
 */
const ZEROCLAW_MODELS = [
  {
    id: 'zeroclaw-v1',
    name: 'ZeroClaw V1',
    contextWindow: 128_000,
    description: 'General-purpose ZeroClaw model with 128k context.',
  },
  {
    id: 'zeroclaw-v1-turbo',
    name: 'ZeroClaw V1 Turbo',
    contextWindow: 128_000,
    description: 'Faster ZeroClaw model with 128k context.',
  },
  {
    id: 'zeroclaw-v1-mini',
    name: 'ZeroClaw V1 Mini',
    contextWindow: 64_000,
    description: 'Compact ZeroClaw model for simpler tasks.',
  },
];

/**
 * Default retry configuration for ZeroClaw.
 * @type {object}
 */
const DEFAULT_RETRY = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffFactor: 2,
};

/**
 * ZeroClaw LLM provider.
 */
export class ZeroClawProvider extends BaseProvider {
  /**
   * Create a ZeroClaw provider instance.
   * @param {object} config
   * @param {string} [config.apiKey] - ZeroClaw API key (falls back to env).
   * @param {string} [config.baseUrl] - Custom base URL.
   * @param {string} [config.model] - Default model.
   * @param {number} [config.timeoutMs=60000] - Request timeout.
   * @param {object} [config.retry={}] - Retry configuration.
   */
  constructor(config = {}) {
    super({
      ...config,
      apiKey: config.apiKey || process.env.ZEROCLAW_API_KEY || null,
      baseUrl: config.baseUrl || process.env.ZEROCLAW_BASE_URL || 'https://api.zeroclaw.ai/v1',
      model: config.model || process.env.ZEROCLAW_MODEL || 'zeroclaw-v1',
    });

    this.name = 'zeroclaw';
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.retry = { ...DEFAULT_RETRY, ...config.retry };
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
      embedding: false,
      streaming: true,
      functionCalling: true,
      vision: false,
      systemPrompts: true,
      tokenCounting: true,
      rateLimitInfo: true,
      supportedFeatures: ['reasoning', 'code-generation', 'structured-output'],
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Chat completion via ZeroClaw Messages API.
   * @inheritDoc
   */
  async chat(messages, options = {}) {
    const model = this._resolveModel(options.model);
    const payload = {
      model,
      messages: this._formatMessages(messages),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      stream: options.stream ?? false,
    };

    if (options.tools && options.tools.length > 0) {
      payload.tools = this._formatTools(options.tools);
    }

    if (options.stream) {
      return this._streamChat(payload, options);
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
   * @inheritDoc — ZeroClaw does not yet support embeddings.
   */
  async embed(_text) {
    throw new ProviderError('ZeroClaw does not support embeddings', {
      retryable: false,
    });
  }

  /**
   * List available ZeroClaw models.
   * @inheritDoc
   */
  async listModels() {
    try {
      const url = `${this.baseUrl}/models`;
      const headers = this._buildHeaders();
      const response = await this._request(url, { method: 'GET', headers }, this.timeoutMs);
      const data = await response.json();
      return (data.data || []).map((m) => ({
        id: m.id,
        name: m.name || m.id,
        contextWindow: m.context_window ?? m.contextWindow,
        description: m.description || '',
      }));
    } catch (error) {
      // Fall back to hardcoded list on failure
      return ZEROCLAW_MODELS.map((m) => ({ ...m }));
    }
  }

  /**
   * Test connectivity to ZeroClaw API.
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
  // Internal: request pipeline
  // -----------------------------------------------------------------------

  /**
   * Send the chat request and normalise the response.
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
    this._updateRateLimitInfo(this._lastRateLimitInfo);

    const choice = data.choices?.[0];
    if (!choice) {
      throw new ProviderError('ZeroClaw returned no choices', { retryable: true });
    }

    return {
      id: data.id ?? `zc-${Date.now()}`,
      content: choice.message?.content ?? '',
      role: choice.message?.role ?? 'assistant',
      model: data.model ?? payload.model,
      usage: this._normaliseUsage(data.usage),
      finishReason: choice.finish_reason ?? 'stop',
      tools: choice.tool_calls ?? null,
    };
  }

  /**
   * Streaming chat — returns an async iterator.
   * @private
   * @param {object} payload
   * @param {object} [options]
   * @returns {AsyncIterable<{type: string, delta: string, [key: string]: any}>}
   */
  async _streamChat(payload, options = {}) {
    const url = `${this.baseUrl}/chat/completions`;
    const headers = this._buildHeaders();
    const response = await this._request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }, this.timeoutMs * 2); // longer timeout for streaming

    this._extractRateLimits(response.headers);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    return {
      id: `zc-stream-${Date.now()}`,
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
              if (parsed.usage) {
                usage = parsed.usage;
              }
            } catch {
              // skip malformed SSE chunks
            }
          }
        }

        yield { type: 'done', usage: this._normaliseUsage(usage) };
      }.bind(this),
    };
  }

  /**
   * Retry wrapper with exponential backoff.
   * @private
   * @param {Function} fn - The async function to retry.
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

        const delay = Math.min(
          this.retry.baseDelayMs * Math.pow(this.retry.backoffFactor, attempt) + Math.random() * 500,
          this.retry.maxDelayMs
        );

        const waitMs = error.retryAfterMs ?? delay;
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    throw lastError;
  }

  // -----------------------------------------------------------------------
  // Internal: formatting helpers
  // -----------------------------------------------------------------------

  /**
   * Format messages for ZeroClaw's API (OpenAI-compatible).
   * @private
   * @param {Array} messages
   * @returns {Array}
   */
  _formatMessages(messages) {
    return messages.map((msg) => {
      const formatted = { role: msg.role, content: msg.content };
      if (msg.name) formatted.name = msg.name;
      if (msg.tool_calls) formatted.tool_calls = msg.tool_calls;
      if (msg.tool_call_id) formatted.tool_call_id = msg.tool_call_id;
      return formatted;
    });
  }

  /**
   * Format tool definitions for ZeroClaw.
   * @private
   * @param {Array} tools
   * @returns {Array}
   */
  _formatTools(tools) {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.parameters || {},
      },
    }));
  }

  /**
   * Extract rate-limit info from response headers.
   * @private
   * @param {Headers} headers
   */
  _extractRateLimits(headers) {
    const getInfo = (name) => {
      const val = headers.get(name) || headers.get(name.toLowerCase());
      return val ? parseInt(val, 10) : null;
    };

    if (getInfo('x-ratelimit-limit-requests')) {
      this._updateRateLimitInfo({
        requestsLimit: getInfo('x-ratelimit-limit-requests') ?? 0,
        requestsRemaining: getInfo('x-ratelimit-remaining-requests') ?? 0,
        requestsResetMs: (getInfo('x-ratelimit-reset-requests') ?? 0) * 1000,
        tokensLimit: getInfo('x-ratelimit-limit-tokens') ?? 0,
        tokensRemaining: getInfo('x-ratelimit-remaining-tokens') ?? 0,
        scope: headers.get('x-ratelimit-scope') || 'user',
      });
    }
  }
}

export default ZeroClawProvider;
