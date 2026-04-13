/**
 * @module provider-factory
 * @description Factory pattern for creating LLM provider instances.
 *
 * The factory is the central point where superz-twin resolves which provider
 * to use based on user configuration. It supports:
 *
 *   - **Explicit type**: `{ type: "claude", settings: { ... } }`
 *   - **Auto-detection**: If only `baseUrl` is provided, creates a `generic-openai` provider
 *   - **Custom registration**: `registerProvider("my-provider", MyProviderClass)`
 *   - **Fallback chains**: Primary provider fails → try next in order
 *
 * @example
 * import { ProviderFactory } from './provider-factory.js';
 *
 * // Explicit Claude
 * const claude = ProviderFactory.createProvider({
 *   type: 'claude',
 *   settings: { apiKey: 'sk-ant-...', model: 'claude-sonnet-4-20250514' },
 * });
 *
 * // Auto-detect (any OpenAI-compatible endpoint)
 * const generic = ProviderFactory.createProvider({
 *   baseUrl: 'http://localhost:11434/v1',
 *   model: 'llama3',
 * });
 *
 * // Fallback chain
 * const withFallback = ProviderFactory.createWithFallback([
 *   { type: 'claude', settings: { apiKey: 'sk-ant-...' } },
 *   { type: 'openai', settings: { apiKey: 'sk-...' } },
 *   { baseUrl: 'http://localhost:11434/v1', model: 'llama3' },
 * ]);
 */

import { ZeroClawProvider } from './providers/zeroclaw.js';
import { PiAgentProvider } from './providers/pi-agent.js';
import { ClaudeProvider } from './providers/claude.js';
import { OpenAIProvider } from './providers/openai.js';
import { GenericOpenAIProvider } from './providers/generic-openai.js';
import { BaseProvider, ProviderError } from './provider-interface.js';

/**
 * Map of built-in provider types to their constructor classes.
 * @type {Map<string, typeof BaseProvider>}
 */
const BUILTIN_PROVIDERS = new Map([
  ['zeroclaw', ZeroClawProvider],
  ['zero-claw', ZeroClawProvider],
  ['pi-agent', PiAgentProvider],
  ['pi', PiAgentProvider],
  ['claude', ClaudeProvider],
  ['anthropic', ClaudeProvider],
  ['openai', OpenAIProvider],
  ['generic', GenericOpenAIProvider],
  ['generic-openai', GenericOpenAIProvider],
]);

/**
 * Registry of custom providers added by users or plugins.
 * Custom providers take precedence over built-in ones.
 * @type {Map<string, typeof BaseProvider>}
 */
const CUSTOM_PROVIDERS = new Map();

/**
 * ProviderFactory — creates and manages LLM provider instances.
 */
export class ProviderFactory {
  // -------------------------------------------------------------------------
  // Provider registration
  // -------------------------------------------------------------------------

  /**
   * Register a custom provider class under a given type name.
   * Custom providers override built-in ones with the same name.
   *
   * @param {string} type - Provider type identifier (e.g. "my-custom-provider").
   * @param {typeof BaseProvider} ProviderClass - The provider class (must extend BaseProvider).
   * @throws {TypeError} If ProviderClass is not a valid BaseProvider subclass.
   *
   * @example
   * import { BaseProvider } from './provider-interface.js';
   *
   * export class GeminiProvider extends BaseProvider { ... }
   *
   * ProviderFactory.registerProvider('gemini', GeminiProvider);
   */
  static registerProvider(type, ProviderClass) {
    const normalisedType = type.toLowerCase().trim();

    if (typeof ProviderClass !== 'function' || !ProviderClass.prototype) {
      throw new TypeError('ProviderClass must be a constructor function / class');
    }

    if (!(ProviderClass.prototype instanceof BaseProvider)) {
      throw new TypeError(
        `${ProviderClass.name || 'ProviderClass'} must extend BaseProvider`
      );
    }

    CUSTOM_PROVIDERS.set(normalisedType, ProviderClass);
  }

  /**
   * Unregister a previously registered custom provider.
   *
   * @param {string} type - Provider type to unregister.
   * @returns {boolean} Whether the provider was found and removed.
   */
  static unregisterProvider(type) {
    return CUSTOM_PROVIDERS.delete(type.toLowerCase().trim());
  }

  /**
   * Get all registered provider type names (built-in + custom).
   *
   * @returns {string[]}
   */
  static getRegisteredTypes() {
    return [...new Set([...BUILTIN_PROVIDERS.keys(), ...CUSTOM_PROVIDERS.keys()])].sort();
  }

  /**
   * Check if a provider type is registered.
   *
   * @param {string} type
   * @returns {boolean}
   */
  static isRegistered(type) {
    const normalised = type.toLowerCase().trim();
    return BUILTIN_PROVIDERS.has(normalised) || CUSTOM_PROVIDERS.has(normalised);
  }

  // -------------------------------------------------------------------------
  // Provider creation
  // -------------------------------------------------------------------------

  /**
   * Create a provider instance from a configuration object.
   *
   * Supports multiple configuration formats:
   *
   * ```js
   * // Format 1: explicit type + settings
   * { type: "claude", settings: { apiKey: "..." } }
   *
   * // Format 2: flat config with type field
   * { type: "openai", apiKey: "...", model: "gpt-4o" }
   *
   * // Format 3: auto-detect (no type, has baseUrl)
   * { baseUrl: "http://localhost:11434/v1", model: "llama3" }
   *
   * // Format 4: just API key (defaults to OpenAI)
   * { apiKey: "sk-..." }
   * ```
   *
   * @param {object} config - Provider configuration.
   * @param {string} [config.type] - Provider type (zeroclaw, pi-agent, claude, openai, generic).
   * @param {object} [config.settings] - Provider-specific settings (when using format 1).
   * @param {string} [config.apiKey] - API key (can also be in settings).
   * @param {string} [config.baseUrl] - Base URL (can also be in settings).
   * @param {string} [config.model] - Default model (can also be in settings).
   * @returns {BaseProvider} The instantiated provider.
   * @throws {ProviderError} If the provider type is unknown or instantiation fails.
   */
  static createProvider(config = {}) {
    if (!config || typeof config !== 'object') {
      throw new ProviderError('Provider config must be a non-null object', { retryable: false });
    }

    const { type, settings, ...flatConfig } = config;

    // Merge settings into flat config if using format 1
    const mergedConfig = settings ? { ...settings, ...flatConfig } : { ...flatConfig };

    // Resolve the provider type
    const resolvedType = _resolveProviderType(type, mergedConfig);
    const ProviderClass = _resolveProviderClass(resolvedType);

    try {
      return new ProviderClass(mergedConfig);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        `Failed to create provider "${resolvedType}": ${error.message}`,
        { retryable: false }
      );
    }
  }

  // -------------------------------------------------------------------------
  // Fallback chains
  // -------------------------------------------------------------------------

  /**
   * Create a FallbackProvider that wraps multiple providers and tries them
   * in order until one succeeds.
   *
   * @param {Array<object>} configs - Array of provider configs (same format as createProvider).
   * @param {object} [options={}] - Options for fallback behaviour.
   * @param {boolean} [options.testOnCreation=true] - Test each provider during creation.
   * @param {Function} [options.onFallback] - Callback invoked when a fallback is triggered.
   * @returns {BaseProvider} A FallbackProvider instance.
   */
  static createWithFallback(configs, options = {}) {
    const {
      testOnCreation = false,
      onFallback = null,
    } = options;

    if (!Array.isArray(configs) || configs.length === 0) {
      throw new ProviderError('Fallback chain requires at least one provider config', {
        retryable: false,
      });
    }

    const providers = configs.map((cfg, index) => {
      const provider = this.createProvider(cfg);
      provider._fallbackIndex = index;
      return provider;
    });

    return new FallbackProvider(providers, { testOnCreation, onFallback });
  }
}

// ===========================================================================
// FallbackProvider — internal class that tries providers in sequence
// ===========================================================================

/**
 * Provider that wraps multiple providers and tries them in order.
 * If the primary fails with a retryable error, it falls back to the next.
 *
 * @extends BaseProvider
 */
class FallbackProvider extends BaseProvider {
  /**
   * @param {Array<BaseProvider>} providers - Ordered list of providers.
   * @param {object} [options={}]
   * @param {boolean} [options.testOnCreation=false]
   * @param {Function|null} [options.onFallback=null]
   */
  constructor(providers, options = {}) {
    super({
      model: providers[0]?.defaultModel || 'fallback',
    });

    this.name = 'fallback';
    this.providers = providers;
    this.testOnCreation = options.testOnCreation ?? false;
    this.onFallback = options.onFallback ?? null;
    this.capabilities = this._buildCapabilities();

    // Merge capabilities from all providers (union)
    for (const provider of providers) {
      const caps = provider.getCapabilities();
      for (const [key, value] of Object.entries(caps)) {
        if (key === 'supportedFeatures') {
          this.capabilities.supportedFeatures.push(...caps.supportedFeatures);
        } else if (value === true) {
          this.capabilities[key] = true;
        }
      }
    }
  }

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
      tokenCounting: false,
      rateLimitInfo: false,
      supportedFeatures: ['fallback-chain'],
    };
  }

  /**
   * Try each provider in order until one succeeds.
   * @private
   * @param {string} method - Method name to call.
   * @param {Array} args - Arguments to pass.
   * @returns {Promise<*>}
   */
  async _tryWithFallback(method, args) {
    let lastError;

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      try {
        const result = await provider[method](...args);
        this._updateRateLimitInfo(provider.rateLimitInfo() || {});
        return result;
      } catch (error) {
        lastError = error;
        const isLast = i === this.providers.length - 1;

        if (isLast || !error.retryable) {
          throw error;
        }

        // Trigger fallback callback
        if (this.onFallback) {
          try {
            this.onFallback({
              from: provider.name,
              fromIndex: i,
              error: error.message,
              remaining: this.providers.length - i - 1,
            });
          } catch {
            // callback errors are non-fatal
          }
        }
      }
    }

    throw lastError;
  }

  /** @inheritDoc */
  async chat(messages, options = {}) {
    return this._tryWithFallback('chat', [messages, options]);
  }

  /** @inheritDoc */
  async complete(prompt, options = {}) {
    return this._tryWithFallback('complete', [prompt, options]);
  }

  /** @inheritDoc */
  async embed(text) {
    return this._tryWithFallback('embed', [text]);
  }

  /** @inheritDoc */
  async listModels() {
    // Collect models from all providers
    const allModels = [];
    const seen = new Set();

    for (const provider of this.providers) {
      try {
        const models = await provider.listModels();
        for (const model of models) {
          if (!seen.has(model.id)) {
            seen.add(model.id);
            allModels.push({ ...model, provider: provider.name });
          }
        }
      } catch {
        // skip failing providers
      }
    }

    return allModels;
  }

  /** @inheritDoc */
  async testConnection() {
    const start = Date.now();
    const results = [];

    for (const provider of this.providers) {
      try {
        const result = await provider.testConnection();
        results.push({ ...result, provider: provider.name });
        if (result.success) {
          return {
            success: true,
            latencyMs: Date.now() - start,
            model: result.model,
            provider: provider.name,
            allResults: results,
          };
        }
      } catch (error) {
        results.push({
          success: false,
          provider: provider.name,
          error: error.message,
        });
      }
    }

    return {
      success: false,
      latencyMs: Date.now() - start,
      model: null,
      provider: null,
      allResults: results,
      error: `All ${results.length} providers failed`,
    };
  }
}

// ===========================================================================
// Private helpers
// ===========================================================================

/**
 * Resolve the provider type from config.
 * @private
 * @param {string|undefined} type
 * @param {object} config
 * @returns {string}
 */
function _resolveProviderType(type, config) {
  // Explicit type
  if (type && typeof type === 'string') {
    return type.toLowerCase().trim();
  }

  // Auto-detect from config shape
  if (config.baseUrl && !type) {
    // Has a baseUrl but no type → generic OpenAI-compatible
    return 'generic';
  }

  // Default to OpenAI
  return 'openai';
}

/**
 * Resolve a provider class from a type name.
 * @private
 * @param {string} type
 * @returns {typeof BaseProvider}
 * @throws {ProviderError} If type is unknown.
 */
function _resolveProviderClass(type) {
  // Check custom providers first (they override built-ins)
  const custom = CUSTOM_PROVIDERS.get(type);
  if (custom) return custom;

  // Check built-in providers
  const builtin = BUILTIN_PROVIDERS.get(type);
  if (builtin) return builtin;

  // Try fuzzy matching for common aliases
  const fuzzyMap = {
    'zero': 'zeroclaw',
    'zeroclaw': 'zeroclaw',
    'piagent': 'pi-agent',
    'pi-agent': 'pi-agent',
    'anthropic': 'claude',
    'claude': 'claude',
    'oai': 'openai',
    'openai': 'openai',
    'gpt': 'openai',
    'ollama': 'generic',
    'litellm': 'generic',
    'openrouter': 'generic',
    'proxy': 'generic',
    'custom': 'generic',
  };

  const fuzzy = fuzzyMap[type];
  if (fuzzy) {
    const clazz = BUILTIN_PROVIDERS.get(fuzzy) || CUSTOM_PROVIDERS.get(fuzzy);
    if (clazz) return clazz;
  }

  const knownTypes = ProviderFactory.getRegisteredTypes();
  throw new ProviderError(
    `Unknown provider type: "${type}". Known types: ${knownTypes.join(', ')}`,
    { retryable: false }
  );
}

export default ProviderFactory;
export { FallbackProvider };
