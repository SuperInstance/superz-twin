/**
 * @module providers/pi-agent
 * @description Pi Agent LLM provider implementation.
 * Extends BaseProvider with Pi Agent-specific API format, model selection,
 * system prompt handling, and fallback logic.
 *
 * Environment variables:
 *   PI_AGENT_API_KEY   — API key for Pi Agent
 *   PI_AGENT_BASE_URL  — Override the default base URL
 *   PI_AGENT_MODEL     — Default model identifier
 */

import { BaseProvider, ProviderError } from '../provider-interface.js';

/**
 * Known Pi Agent models.
 * @type {Array<{id: string, name: string, contextWindow: number, description: string}>}
 */
const PI_AGENT_MODELS = [
  {
    id: 'pi-1',
    name: 'Pi-1',
    contextWindow: 32_000,
    description: 'Pi Agent foundation model with strong reasoning.',
  },
  {
    id: 'pi-2',
    name: 'Pi-2',
    contextWindow: 128_000,
    description: 'Next-gen Pi Agent model with 128k context.',
  },
  {
    id: 'pi-2-turbo',
    name: 'Pi-2 Turbo',
    contextWindow: 128_000,
    description: 'Fast Pi-2 variant optimised for speed.',
  },
  {
    id: 'pi-code',
    name: 'Pi Code',
    contextWindow: 64_000,
    description: 'Pi Agent model fine-tuned for code tasks.',
  },
];

/**
 * Default retry configuration for Pi Agent.
 * @type {object}
 */
const DEFAULT_RETRY = {
  maxRetries: 3,
  baseDelayMs: 1500,
  maxDelayMs: 30_000,
  backoffFactor: 2,
};

/**
 * Pi Agent LLM provider.
 */
export class PiAgentProvider extends BaseProvider {
  /**
   * Create a Pi Agent provider instance.
   * @param {object} config
   * @param {string} [config.apiKey] - Pi Agent API key (falls back to env).
   * @param {string} [config.baseUrl] - Custom base URL.
   * @param {string} [config.model] - Default model.
   * @param {string} [config.systemPrompt] - Default system prompt.
   * @param {number} [config.timeoutMs=90000] - Request timeout (Pi Agent can be slower).
   * @param {object} [config.retry={}] - Retry configuration.
   * @param {string[]} [config.fallbackModels=[]] - Models to try if primary fails.
   */
  constructor(config = {}) {
    super({
      ...config,
      apiKey: config.apiKey || process.env.PI_AGENT_API_KEY || null,
      baseUrl: config.baseUrl || process.env.PI_AGENT_BASE_URL || 'https://api.pi-agent.dev/v1',
      model: config.model || process.env.PI_AGENT_MODEL || 'pi-2',
    });

    this.name = 'pi-agent';
    this.timeoutMs = config.timeoutMs ?? 90_000;
    this.retry = { ...DEFAULT_RETRY, ...config.retry };
    this.systemPrompt = config.systemPrompt || null;
    this.fallbackModels = config.fallbackModels || [];
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
      functionCalling: false,
      vision: false,
      systemPrompts: true,
      tokenCounting: true,
      rateLimitInfo: true,
      supportedFeatures: ['reasoning', 'code-generation', 'agent-mode'],
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Chat completion via Pi Agent Messages API.
   * @inheritDoc
   */
  async chat(messages, options = {}) {
    const model = this._resolveModel(options.model);
    const payload = this._buildPayload(messages, options, model);

    if (options.stream) {
      return this._streamChat(payload);
    }

    // Try primary model, then fallbacks
    let lastError;
    const modelsToTry = [model, ...this.fallbackModels.filter((m) => m !== model)];

    for (const tryModel of modelsToTry) {
      const tryPayload = { ...payload, model: tryModel };
      try {
        return await this._withRetry(() => this._sendChatRequest(tryPayload));
      } catch (error) {
        lastError = error;
        if (!error.retryable || tryModel === modelsToTry[modelsToTry.length - 1]) {
          break;
        }
        // Fall through to next model
      }
    }

    throw lastError;
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
   * @inheritDoc — Pi Agent does not currently support embeddings.
   */
  async embed(_text) {
    throw new ProviderError('Pi Agent does not support embeddings', {
      retryable: false,
    });
  }

  /**
   * List available Pi Agent models.
   * @inheritDoc
   */
  async listModels() {
    try {
      const url = `${this.baseUrl}/models`;
      const headers = this._buildHeaders();
      const response = await this._request(url, { method: 'GET', headers }, this.timeoutMs);
      const data = await response.json();
      return (data.models || data.data || []).map((m) => ({
        id: m.id || m.model_id,
        name: m.name || m.id,
        contextWindow: m.context_window ?? m.contextWindow ?? 0,
        description: m.description || '',
      }));
    } catch {
      return PI_AGENT_MODELS.map((m) => ({ ...m }));
    }
  }

  /**
   * Test connectivity to Pi Agent API.
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
   * Build the request payload in Pi Agent's format.
   * @private
   * @param {Array} messages
   * @param {object} options
   * @param {string} model
   * @returns {object}
   */
  _buildPayload(messages, options, model) {
    const payload = {
      model,
      messages: [],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      stream: options.stream ?? false,
    };

    // Pi Agent handles system prompts via a top-level `system` field
    const systemPrompt = options.systemPrompt || this.systemPrompt;
    if (systemPrompt) {
      payload.system = systemPrompt;
    }

    // Filter out system messages from the messages array (Pi Agent uses the top-level field)
    const filteredMessages = messages.filter((m) => m.role !== 'system');
    payload.messages = filteredMessages.map((msg) => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    }));

    return payload;
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
    const headers = this._buildHeaders();
    const response = await this._request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }, this.timeoutMs);

    const data = await response.json();
    this._extractRateLimits(response.headers);

    const message = data.message || data.choices?.[0]?.message;
    if (!message) {
      throw new ProviderError('Pi Agent returned no message', { retryable: true });
    }

    return {
      id: data.id ?? `pi-${Date.now()}`,
      content: message.content ?? '',
      role: message.role ?? 'assistant',
      model: data.model ?? payload.model,
      usage: this._normaliseUsage(data.usage),
      finishReason: data.stop_reason ?? message.finish_reason ?? 'stop',
    };
  }

  /**
   * Streaming chat.
   * @private
   * @param {object} payload
   * @returns {AsyncIterable}
   */
  async _streamChat(payload) {
    const url = `${this.baseUrl}/messages`;
    const headers = this._buildHeaders();
    const response = await this._request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }, this.timeoutMs * 2);

    this._extractRateLimits(response.headers);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    return {
      id: `pi-stream-${Date.now()}`,
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
              const delta = parsed.delta ?? parsed.choices?.[0]?.delta;
              if (delta?.text ?? delta?.content) {
                yield {
                  type: 'delta',
                  delta: delta.text ?? delta.content,
                  role: delta.role ?? 'assistant',
                };
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

        const jitter = Math.random() * 800;
        const delay = Math.min(
          this.retry.baseDelayMs * Math.pow(this.retry.backoffFactor, attempt) + jitter,
          this.retry.maxDelayMs
        );

        await new Promise((r) => setTimeout(r, error.retryAfterMs ?? delay));
      }
    }
    throw lastError;
  }

  /**
   * Extract rate-limit info from headers.
   * @private
   * @param {Headers} headers
   */
  _extractRateLimits(headers) {
    const get = (name) => {
      const val = headers.get(name) || headers.get(name.toLowerCase());
      return val ? parseInt(val, 10) : null;
    };

    if (get('x-ratelimit-limit')) {
      this._updateRateLimitInfo({
        requestsLimit: get('x-ratelimit-limit') ?? 0,
        requestsRemaining: get('x-ratelimit-remaining') ?? 0,
        requestsResetMs: (get('x-ratelimit-reset') ?? 0) * 1000,
        tokensLimit: get('x-ratelimit-tokens-limit') ?? 0,
        tokensRemaining: get('x-ratelimit-tokens-remaining') ?? 0,
        scope: headers.get('x-ratelimit-scope') || 'user',
      });
    }
  }
}

export default PiAgentProvider;
