/**
 * @module onboarding/providers
 * @description API provider detection, health checks, and connection testing.
 *              Supports ZeroClaw, Pi Agent, Claude (Anthropic), OpenAI, and
 *              custom proxy endpoints. Each provider type has a specific
 *              health-check URL and authentication mechanism.
 */

/** @typedef {import('../utils/logger.js').default} Logger */

/**
 * Provider type definitions with their configuration schemas and endpoints.
 * @type {Record<string, { name: string, description: string, defaultBaseUrl: string, healthEndpoint: string, needsApiKey: boolean, defaultModel: string }>}
 */
export const PROVIDERS = {
  zeroclaw: {
    name: 'ZeroClaw',
    description: 'ZeroClaw AI — High-performance FLUX-native inference',
    defaultBaseUrl: 'https://api.zeroclaw.ai/v1',
    healthEndpoint: '/health',
    needsApiKey: true,
    defaultModel: 'zeroclaw-latest',
  },
  piagent: {
    name: 'Pi Agent',
    description: 'Pi Agent — Intelligent reasoning with code specialization',
    defaultBaseUrl: 'https://api.piagent.dev/v1',
    healthEndpoint: '/health',
    needsApiKey: true,
    defaultModel: 'piagent-code-v2',
  },
  claude: {
    name: 'Claude (Anthropic)',
    description: 'Anthropic Claude — Advanced reasoning and code generation',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    healthEndpoint: null, // Claude doesn't have a dedicated health endpoint
    needsApiKey: true,
    defaultModel: 'claude-sonnet-4-20250514',
  },
  openai: {
    name: 'OpenAI',
    description: 'OpenAI GPT — Industry-standard language models',
    defaultBaseUrl: 'https://api.openai.com/v1',
    healthEndpoint: '/models',
    needsApiKey: true,
    defaultModel: 'gpt-4o',
  },
  proxy: {
    name: 'Custom Proxy',
    description: 'Self-hosted or third-party OpenAI-compatible proxy',
    defaultBaseUrl: '',
    healthEndpoint: '/health',
    needsApiKey: false,
    defaultModel: 'default',
  },
};

/**
 * Test a provider connection by attempting a lightweight API call.
 *
 * @param {object} opts
 * @param {string} opts.type — Provider type key (e.g., 'openai').
 * @param {string} [opts.apiKey] — API key for authentication.
 * @param {string} [opts.baseUrl] — Override the default base URL.
 * @param {number} [opts.timeout=10000] — Request timeout in milliseconds.
 * @param {Logger} [opts.logger] — Logger for debug output.
 * @returns {Promise<{ success: boolean, latency: number, message: string, capabilities: object|null }>}
 */
export async function testProvider({ type, apiKey, baseUrl, timeout = 10_000, logger }) {
  const provider = PROVIDERS[type];
  if (!provider) {
    return { success: false, latency: 0, message: `Unknown provider type: ${type}`, capabilities: null };
  }

  const url = baseUrl || provider.defaultBaseUrl;
  if (!url) {
    return { success: false, latency: 0, message: 'No base URL configured for this provider', capabilities: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const startTime = Date.now();

  try {
    let response;
    let responseBody;

    switch (type) {
      case 'openai': {
        // Test by listing models (lightweight authenticated call)
        response = await fetch(`${url}/models`, {
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        });
        responseBody = await response.json();
        break;
      }

      case 'claude': {
        // Anthropic uses x-api-key header; test with a minimal messages request
        response = await fetch(`${url}/messages`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: provider.defaultModel,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
        });
        responseBody = await response.json();
        // Claude returns 200 even for tiny requests — just confirm auth works
        break;
      }

      default: {
        // Generic OpenAI-compatible health/model check
        const endpoint = provider.healthEndpoint || '/models';
        const isPost = endpoint.includes('chat') || endpoint.includes('message');
        response = await fetch(`${url}${endpoint}`, {
          method: isPost ? 'POST' : 'GET',
          signal: controller.signal,
          headers: {
            ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
            'Content-Type': 'application/json',
          },
        });
        responseBody = await response.json();
      }
    }

    const latency = Date.now() - startTime;
    clearTimeout(timer);

    if (response && response.ok) {
      const capabilities = extractCapabilities(type, responseBody);
      logger?.debug('Provider test succeeded', { type, latency, capabilities });
      return {
        success: true,
        latency,
        message: `Connected to ${provider.name} (${latency}ms)`,
        capabilities,
      };
    }

    const statusMsg = response ? `HTTP ${response.status}` : 'No response';
    const errorDetail = responseBody?.error?.message || responseBody?.message || '';
    const msg = `${provider.name} returned ${statusMsg}${errorDetail ? `: ${errorDetail}` : ''}`;
    logger?.warn('Provider test failed', { type, statusMsg, errorDetail });

    return { success: false, latency: Date.now() - startTime, message: msg, capabilities: null };

  } catch (err) {
    clearTimeout(timer);
    const latency = Date.now() - startTime;
    const msg = err.name === 'AbortError'
      ? `Connection to ${provider.name} timed out after ${timeout}ms`
      : `Failed to connect to ${provider.name}: ${err.message}`;

    logger?.error('Provider connection error', { type, error: err.message });
    return { success: false, latency, message: msg, capabilities: null };
  }
}

/**
 * Extract provider capabilities from a successful test response.
 * @param {string} type — Provider type.
 * @param {object} body — Parsed response body.
 * @returns {object} Capabilities summary.
 */
function extractCapabilities(type, body) {
  try {
    switch (type) {
      case 'openai': {
        const models = body?.data || [];
        return {
          modelCount: models.length,
          models: models.slice(0, 10).map(m => m.id),
        };
      }
      case 'claude': {
        return {
          model: body?.model || 'claude',
          stopReason: body?.stop_reason,
        };
      }
      default: {
        return { raw: typeof body === 'object' ? Object.keys(body) : null };
      }
    }
  } catch {
    return { raw: null };
  }
}

/**
 * Get the list of available provider types for interactive selection.
 * @returns {{ value: string, name: string, description: string }[]}
 */
export function getProviderChoices() {
  return Object.entries(PROVIDERS).map(([key, p]) => ({
    value: key,
    name: p.name,
    description: p.description,
  }));
}

/**
 * Build a full provider configuration object from user answers.
 * @param {object} answers
 * @param {string} answers.providerType — Selected provider type.
 * @param {string} [answers.apiKey] — API key (if applicable).
 * @param {string} [answers.baseUrl] — Custom base URL (for proxy).
 * @returns {object} Provider config ready for the main config file.
 */
export function buildProviderConfig(answers) {
  const provider = PROVIDERS[answers.providerType];
  return {
    type: answers.providerType,
    apiKey: answers.apiKey || null,
    baseUrl: answers.baseUrl || provider?.defaultBaseUrl || null,
    model: provider?.defaultModel || null,
  };
}
