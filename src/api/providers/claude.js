/**
 * @module providers/claude
 * @description Anthropic Claude LLM provider implementation.
 * Extends BaseProvider with Anthropic Messages API format, separate system
 * prompt handling, token counting awareness, and model selection.
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY   — Anthropic API key
 *   ANTHROPIC_BASE_URL  — Override the default base URL
 *   CLAUDE_MODEL        — Default Claude model
 */

import { BaseProvider, ProviderError } from '../provider-interface.js';

/**
 * Known Claude models.
 * @type {Array<{id: string, name: string, contextWindow: number, description: string}>}
 */
const CLAUDE_MODELS = [
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    contextWindow: 200_000,
    description: 'Latest Claude Sonnet with 200k context.',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    contextWindow: 200_000,
    description: 'Most powerful Claude model with 200k context.',
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    contextWindow: 200_000,
    description: 'Fast, intelligent Claude 3.5 model.',
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    contextWindow: 200_000,
    description: 'Fast and compact Claude model.',
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    contextWindow: 200_000,
    description: 'Legacy Claude 3 Opus model.',
  },
];

/**
 * Anthropic x-api-key header name (Anthropic does NOT use Bearer tokens).
 */
const ANTHROPIC_AUTH_HEADER = 'x-api-key';

/**
 * Default retry configuration for Claude.
 * @type {object}
 */
const DEFAULT_RETRY = {
  maxRetries: 4,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffFactor: 2,
};

/**
 * Anthropic Claude LLM provider.
 */
export class ClaudeProvider extends BaseProvider {
  /**
   * Create a Claude provider instance.
   * @param {object} config
   * @param {string} [config.apiKey] - Anthropic API key (falls back to env).
   * @param {string} [config.baseUrl] - Custom base URL.
   * @param {string} [config.model] - Default model.
   * @param {string} [config.anthropicVersion='2023-06-01'] - Anthropic API version header.
   * @param {number} [config.timeoutMs=120000] - Request timeout (Claude can be slow on long outputs).
   * @param {object} [config.retry={}] - Retry configuration.
   * @param {number} [config.maxTokens=4096] - Default max output tokens.
   */
  constructor(config = {}) {
    super({
      ...config,
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY || null,
      baseUrl: config.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1',
      model: config.model || process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    });

    this.name = 'claude';
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.retry = { ...DEFAULT_RETRY, ...config.retry };
    this.anthropicVersion = config.anthropicVersion || '2023-06-01';
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
      embedding: false,
      streaming: true,
      functionCalling: true,
      vision: true,
      systemPrompts: true,
      tokenCounting: true,
      rateLimitInfo: true,
      supportedFeatures: [
        'tool-use',
        'vision',
        'extended-thinking',
        'pdf-input',
        'cache-control',
      ],
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Chat completion via Anthropic Messages API.
   * @inheritDoc
   */
  async chat(messages, options = {}) {
    const model = this._resolveModel(options.model);
    const { systemPrompt, anthropicMessages } = this._splitSystemMessages(messages, options.systemPrompt);
    const payload = {
      model,
      messages: anthropicMessages,
      max_tokens: options.maxTokens ?? this.defaultMaxTokens,
      temperature: options.temperature ?? 0.7,
      stream: options.stream ?? false,
    };

    if (systemPrompt) {
      payload.system = systemPrompt;
    }

    if (options.tools && options.tools.length > 0) {
      payload.tools = this._formatTools(options.tools);
    }

    if (options.stopSequences) {
      payload.stop_sequences = options.stopSequences;
    }

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
   * @inheritDoc — Anthropic does not offer a separate embedding endpoint.
   */
  async embed(_text) {
    throw new ProviderError('Anthropic Claude does not support embeddings', {
      retryable: false,
    });
  }

  /**
   * List known Claude models.
   * Anthropic does not expose a /models endpoint, so we use our hardcoded list.
   * @inheritDoc
   */
  async listModels() {
    return CLAUDE_MODELS.map((m) => ({ ...m }));
  }

  /**
   * Test connectivity to Anthropic API.
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
  // Internal: Anthropic-specific formatting
  // -----------------------------------------------------------------------

  /**
   * Extract system messages and format the rest for Anthropic.
   * Anthropic uses a separate `system` parameter instead of system-role messages.
   *
   * @private
   * @param {Array} messages - Standard messages array.
   * @param {string|undefined} explicitSystemPrompt - System prompt from options.
   * @returns {{ systemPrompt: string|null, anthropicMessages: Array }}
   */
  _splitSystemMessages(messages, explicitSystemPrompt) {
    let systemPrompt = explicitSystemPrompt || null;
    const anthropicMessages = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = systemPrompt
          ? `${systemPrompt}\n\n${msg.content}`
          : msg.content;
        continue;
      }

      // Anthropic expects 'assistant' tool results to have role 'user' with tool_result blocks
      if (msg.role === 'tool' || msg.role === 'function') {
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id ?? msg.tool_use_id ?? '',
              content: msg.content ?? '',
            },
          ],
        });
        continue;
      }

      anthropicMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // Anthropic requires the first message to have role 'user'
    if (anthropicMessages.length > 0 && anthropicMessages[0].role === 'assistant') {
      anthropicMessages.unshift({
        role: 'user',
        content: '\n',
      });
    }

    return { systemPrompt, anthropicMessages };
  }

  /**
   * Format tools for Anthropic's format.
   * @private
   * @param {Array} tools
   * @returns {Array}
   */
  _formatTools(tools) {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.parameters || tool.input_schema || { type: 'object', properties: {} },
    }));
  }

  // -----------------------------------------------------------------------
  // Internal: request pipeline
  // -----------------------------------------------------------------------

  /**
   * Send chat request and normalise response.
   * @private
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async _sendChatRequest(payload) {
    const url = `${this.baseUrl}/messages`;
    const headers = this._buildAnthropicHeaders();
    const response = await this._request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }, this.timeoutMs);

    const data = await response.json();
    this._extractRateLimits(response.headers);

    if (data.type === 'error') {
      throw new ProviderError(
        data.error?.message || 'Anthropic API error',
        {
          statusCode: data.error?.status ?? null,
          errorCode: data.error?.type ?? null,
          retryable: data.error?.type === 'rate_limit_error' || data.error?.type === 'overloaded_error',
          retryAfterMs: this._parseRetryAfter(data.error),
        }
      );
    }

    return this._normaliseResponse(data, payload.model);
  }

  /**
   * Normalise Anthropic response to standard format.
   * @private
   * @param {object} data - Raw Anthropic response.
   * @param {string} requestedModel - The model that was requested.
   * @returns {object}
   */
  _normaliseResponse(data, requestedModel) {
    const content = data.content || [];
    const textParts = content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const toolCalls = content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({
        id: b.id,
        type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input) },
      }));

    return {
      id: data.id ?? `claude-${Date.now()}`,
      content: textParts,
      role: 'assistant',
      model: data.model ?? requestedModel,
      usage: this._normaliseUsage({
        promptTokens: data.usage?.input_tokens,
        completionTokens: data.usage?.output_tokens,
        totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      }),
      finishReason: data.stop_reason === 'tool_use' ? 'tool-calls' : (data.stop_reason ?? 'stop'),
      tools: toolCalls.length > 0 ? toolCalls : null,
    };
  }

  /**
   * Streaming chat via Anthropic Messages API.
   * @private
   * @param {object} payload
   * @returns {AsyncIterable}
   */
  async _streamChat(payload) {
    const url = `${this.baseUrl}/messages`;
    const headers = this._buildAnthropicHeaders();
    const response = await this._request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }, this.timeoutMs * 3);

    this._extractRateLimits(response.headers);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    return {
      id: `claude-stream-${Date.now()}`,
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
            if (!trimmed || trimmed === 'event: message_stop') continue;
            if (!trimmed.startsWith('data: ')) continue;

            try {
              const parsed = JSON.parse(trimmed.slice(6));

              if (parsed.type === 'content_block_delta') {
                const delta = parsed.delta;
                if (delta.type === 'text_delta') {
                  yield { type: 'delta', delta: delta.text, role: 'assistant' };
                } else if (delta.type === 'input_json_delta') {
                  yield { type: 'tool_delta', delta: delta.partial_json };
                }
              }

              if (parsed.type === 'message_delta') {
                // Final usage
                if (parsed.usage) {
                  usage = {
                    input_tokens: parsed.usage.input_tokens ?? 0,
                    output_tokens: parsed.usage.output_tokens ?? 0,
                  };
                }
              }

              if (parsed.type === 'message_start' && parsed.message?.usage) {
                usage = parsed.message.usage;
              }
            } catch {
              // skip malformed
            }
          }
        }

        yield { type: 'done', usage: this._normaliseUsage(usage) };
      }.bind(this),
    };
  }

  // -----------------------------------------------------------------------
  // Internal: helpers
  // -----------------------------------------------------------------------

  /**
   * Build headers for Anthropic API (uses x-api-key, not Bearer).
   * @private
   * @returns {object}
   */
  _buildAnthropicHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'superz-twin/1.0',
      'anthropic-version': this.anthropicVersion,
    };

    if (this.apiKey) {
      headers[ANTHROPIC_AUTH_HEADER] = this.apiKey;
    }

    return headers;
  }

  /**
   * Parse retry-after from Anthropic error.
   * @private
   * @param {object} error
   * @returns {number|null}
   */
  _parseRetryAfter(error) {
    if (error?.headers?.['retry-after']) {
      return parseInt(error.headers['retry-after'], 10) * 1000;
    }
    return null;
  }

  /**
   * Extract rate-limit info from Anthropic response headers.
   * @private
   * @param {Headers} headers
   */
  _extractRateLimits(headers) {
    const get = (name) => {
      const val = headers.get(name);
      return val ? parseInt(val, 10) : null;
    };

    if (get('anthropic-ratelimit-limit-requests')) {
      this._updateRateLimitInfo({
        requestsLimit: get('anthropic-ratelimit-limit-requests') ?? 0,
        requestsRemaining: get('anthropic-ratelimit-remaining-requests') ?? 0,
        requestsResetMs: (get('anthropic-ratelimit-reset-requests') ?? 0) * 1000,
        tokensLimit: get('anthropic-ratelimit-limit-tokens') ?? 0,
        tokensRemaining: get('anthropic-ratelimit-remaining-tokens') ?? 0,
        scope: headers.get('anthropic-ratelimit-scope') || 'user',
      });
    }
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

export default ClaudeProvider;
