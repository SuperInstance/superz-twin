# superz-twin API Provider Layer

The API abstraction layer makes **superz-twin API-agnostic** — the agent works with any LLM backend by swapping providers or pointing at a proxy. Every provider implements the same `BaseProvider` interface, so the rest of the agent code is completely independent of which LLM it talks to.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Provider Interface](#provider-interface)
- [Built-in Providers](#built-in-providers)
  - [ZeroClaw](#zeroclaw)
  - [Pi Agent](#pi-agent)
  - [Claude (Anthropic)](#claude-anthropic)
  - [OpenAI](#openai)
  - [Generic OpenAI-Compatible](#generic-openai-compatible) ⭐
- [Provider Factory](#provider-factory)
- [Proxy Manager](#proxy-manager)
- [Rate Limiter](#rate-limiter)
- [Adding a New Provider](#adding-a-new-provider)
- [Environment Variable Reference](#environment-variable-reference)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌───────────────────────────────────────────────────┐
│                   superz-twin                      │
│              (agent logic layer)                   │
├───────────────────────────────────────────────────┤
│              Provider Factory                      │
│         (creates & manages providers)              │
├────────┬────────┬────────┬────────┬───────────────┤
│ZeroClaw│Pi Agent│ Claude │ OpenAI │  Generic      │
│Provider│Provider│Provider│Provider│  Provider  ⭐  │
├────────┴────────┴────────┴────────┴───────────────┤
│           Proxy Manager  │  Rate Limiter           │
│         (rotation,       │  (token bucket,         │
│          health checks)  │   retry, queue)         │
├───────────────────────────────────────────────────┤
│              BaseProvider (interface)               │
│  chat() · complete() · embed() · listModels()     │
│  testConnection() · getCapabilities()              │
└───────────────────────────────────────────────────┘
```

**Key design decisions:**

| Decision | Rationale |
|----------|-----------|
| All providers extend `BaseProvider` | Uniform interface — agent code never knows which provider it's using |
| OpenAI-compatible message format as the lingua franca | Most providers support it; easy to map to/from provider-specific formats |
| `GenericOpenAIProvider` is the escape hatch | Works with *any* endpoint (Ollama, LiteLLM, vLLM, etc.) |
| Factory pattern with fallback chains | Primary provider fails → automatically try the next one |
| Built-in rate limiter and proxy manager | No need for external dependencies |

---

## Provider Interface

### `BaseProvider` — Abstract Base Class

Every provider extends `BaseProvider`. The interface defines these methods:

| Method | Signature | Description |
|--------|-----------|-------------|
| `chat()` | `chat(messages, options)` | Multi-turn chat completion |
| `complete()` | `complete(prompt, options)` | Simple text completion |
| `embed()` | `embed(text)` | Generate text embeddings (optional) |
| `listModels()` | `listModels()` | List available models |
| `testConnection()` | `testConnection()` | Health check / connectivity test |
| `getCapabilities()` | `getCapabilities()` | Return capability flags |
| `rateLimitInfo()` | `rateLimitInfo()` | Return current rate limit status |

Unimplemented methods throw `NotImplementedError`.

### Error Types

- **`NotImplementedError`** — Method not overridden in subclass
- **`ProviderError`** — Structured provider failure with `statusCode`, `retryable`, `retryAfterMs`

### Standard Response Format

All `chat()` calls return:

```js
{
  id: "claude-abc123",
  content: "Hello! How can I help?",
  role: "assistant",
  model: "claude-sonnet-4-20250514",
  usage: { promptTokens: 10, completionTokens: 8, totalTokens: 18 },
  finishReason: "stop",
  tools: null  // or array of tool calls
}
```

### Standard Message Format

```js
[
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi there!" },
  { role: "user", content: "How are you?" }
]
```

---

## Built-in Providers

### ZeroClaw

OpenAI-compatible API with ZeroClaw-specific rate limiting and retry.

```js
import { ProviderFactory } from './api/index.js';

const provider = ProviderFactory.createProvider({
  type: 'zeroclaw',
  settings: {
    apiKey: 'zc-...',
    model: 'zeroclaw-v1-turbo',
    timeoutMs: 60000,
    retry: { maxRetries: 3, baseDelayMs: 1000 },
  },
});
```

**Supported models:** `zeroclaw-v1`, `zeroclaw-v1-turbo`, `zeroclaw-v1-mini`

**Capabilities:** Chat, streaming, function calling, system prompts, token counting

| Env Variable | Description |
|-------------|-------------|
| `ZEROCLAW_API_KEY` | API key |
| `ZEROCLAW_BASE_URL` | Override base URL (default: `https://api.zeroclaw.ai/v1`) |
| `ZEROCLAW_MODEL` | Default model (default: `zeroclaw-v1`) |

---

### Pi Agent

Pi Agent uses a top-level `system` parameter (not system-role messages).

```js
const provider = ProviderFactory.createProvider({
  type: 'pi-agent',
  settings: {
    apiKey: 'pi-...',
    model: 'pi-2',
    systemPrompt: 'You are a git expert.',
    fallbackModels: ['pi-1', 'pi-2-turbo'],
    timeoutMs: 90000,
  },
});
```

**Supported models:** `pi-1`, `pi-2`, `pi-2-turbo`, `pi-code`

**Capabilities:** Chat, streaming, system prompts, token counting, agent mode

| Env Variable | Description |
|-------------|-------------|
| `PI_AGENT_API_KEY` | API key |
| `PI_AGENT_BASE_URL` | Override base URL (default: `https://api.pi-agent.dev/v1`) |
| `PI_AGENT_MODEL` | Default model (default: `pi-2`) |

---

### Claude (Anthropic)

Uses Anthropic Messages API with `x-api-key` authentication (not Bearer tokens). System prompts are passed as a separate `system` parameter, not as messages.

```js
const provider = ProviderFactory.createProvider({
  type: 'claude',
  settings: {
    apiKey: 'sk-ant-...',
    model: 'claude-sonnet-4-20250514',
    anthropicVersion: '2023-06-01',
    maxTokens: 8192,
  },
});
```

**Supported models:** `claude-sonnet-4-20250514`, `claude-opus-4-20250514`, `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, `claude-3-opus-20240229`

**Capabilities:** Chat, streaming, function calling (tool use), vision, system prompts, token counting, PDF input

| Env Variable | Description |
|-------------|-------------|
| `ANTHROPIC_API_KEY` | API key |
| `ANTHROPIC_BASE_URL` | Override base URL (default: `https://api.anthropic.com/v1`) |
| `CLAUDE_MODEL` | Default model (default: `claude-sonnet-4-20250514`) |

**Important Claude-specific behaviors:**

- Auth header is `x-api-key`, not `Authorization: Bearer`
- System prompts go in the `system` parameter, not as role=system messages
- First message must be role=human (we auto-prepend if needed)
- Tool results are sent as `tool_result` content blocks with role=user

---

### OpenAI

Standard OpenAI Chat Completions API with full support for function calling, vision, and JSON mode.

```js
const provider = ProviderFactory.createProvider({
  type: 'openai',
  settings: {
    apiKey: 'sk-...',
    model: 'gpt-4o',
    orgId: 'org-...',      // optional
    maxTokens: 4096,
  },
});

// With function calling
const result = await provider.chat(
  [{ role: 'user', content: 'What is the weather?' }],
  {
    tools: [{
      name: 'get_weather',
      description: 'Get current weather',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string' },
        },
      },
    }],
  }
);
```

**Supported models:** `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-4`, `gpt-3.5-turbo`, `o1`, `o1-mini`, `o3-mini`

**Capabilities:** Chat, streaming, function calling, vision, embeddings, system prompts, token counting, JSON mode, structured outputs

| Env Variable | Description |
|-------------|-------------|
| `OPENAI_API_KEY` | API key |
| `OPENAI_BASE_URL` | Override base URL (default: `https://api.openai.com/v1`) |
| `OPENAI_MODEL` | Default model (default: `gpt-4o`) |
| `OPENAI_ORG_ID` | Organisation ID |

---

### Generic OpenAI-Compatible ⭐

**This is the most important provider.** It makes superz-twin work with *any* OpenAI-compatible endpoint — proxies, local models, self-hosted servers, anything.

```js
// Ollama (local)
const ollama = ProviderFactory.createProvider({
  baseUrl: 'http://localhost:11434/v1',
  model: 'llama3',
});

// LiteLLM proxy (routes to any backend)
const litellm = ProviderFactory.createProvider({
  baseUrl: 'https://my-litellm.example.com/v1',
  apiKey: 'sk-...',
  model: 'claude-3-5-sonnet',
});

// OpenRouter (access any model via one API)
const openrouter = ProviderFactory.createProvider({
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-or-...',
  model: 'anthropic/claude-3.5-sonnet',
});

// LM Studio (local GUI)
const lmstudio = ProviderFactory.createProvider({
  baseUrl: 'http://localhost:1234/v1',
  model: 'my-fine-tune',
});

// vLLM (serving engine)
const vllm = ProviderFactory.createProvider({
  baseUrl: 'http://localhost:8000/v1',
  model: 'meta-llama/Llama-3-70b',
});

// No auth needed for local models
const local = ProviderFactory.createProvider({
  baseUrl: 'http://localhost:8080/v1',
  model: 'default',
  skipAuth: true,
});
```

**Auto-detection:** The provider automatically detects known endpoints (Ollama, LM Studio, LiteLLM, etc.) from the URL and applies sensible defaults for timeout, model, and auth.

**Capability probing:**

```js
const provider = ProviderFactory.createProvider({ baseUrl: 'http://localhost:11434/v1' });

// Probe what the endpoint actually supports
const caps = await provider.probeCapabilities();
console.log(caps);
// { chat: true, functionCalling: false, vision: false, ... }
```

**Best-effort response normalisation:** Handles varied response formats from different endpoints gracefully.

| Env Variable | Description |
|-------------|-------------|
| `GENERIC_API_KEY` | API key (may not be needed for local) |
| `GENERIC_BASE_URL` | **Required** — Base URL of the endpoint |
| `GENERIC_MODEL` | Default model |
| `GENERIC_TIMEOUT_MS` | Request timeout in ms (default: 120000) |

---

## Provider Factory

The factory is the single entry point for creating providers.

### Creating a provider

```js
import { ProviderFactory } from './api/index.js';

// By explicit type
const claude = ProviderFactory.createProvider({
  type: 'claude',
  apiKey: 'sk-ant-...',
  model: 'claude-sonnet-4-20250514',
});

// By explicit type with settings object
const openai = ProviderFactory.createProvider({
  type: 'openai',
  settings: { apiKey: 'sk-...' },
});

// Auto-detect (has baseUrl → generic)
const generic = ProviderFactory.createProvider({
  baseUrl: 'http://localhost:11434/v1',
  model: 'llama3',
});

// Just an API key → defaults to OpenAI
const defaultProvider = ProviderFactory.createProvider({
  apiKey: 'sk-...',
});
```

### Fallback chains

```js
const provider = ProviderFactory.createWithFallback([
  // Try Claude first
  { type: 'claude', settings: { apiKey: 'sk-ant-...' } },
  // Fall back to OpenAI
  { type: 'openai', settings: { apiKey: 'sk-...' } },
  // Final fallback to local Ollama
  { baseUrl: 'http://localhost:11434/v1', model: 'llama3' },
], {
  onFallback: (info) => {
    console.warn(`Provider ${info.from} failed: ${info.error}. Trying fallback (${info.remaining} remaining)`);
  },
});

// Use it like any other provider
const result = await provider.chat([{ role: 'user', content: 'Hello' }]);
```

### Custom provider registration

```js
import { ProviderFactory, BaseProvider } from './api/index.js';

class GeminiProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'gemini';
  }

  async chat(messages, options) { /* ... */ }
  async complete(prompt, options) { /* ... */ }
  async listModels() { /* ... */ }
  async testConnection() { /* ... */ }
}

// Register
ProviderFactory.registerProvider('gemini', GeminiProvider);

// Use
const gemini = ProviderFactory.createProvider({
  type: 'gemini',
  apiKey: '...',
});
```

---

## Proxy Manager

The proxy manager handles HTTP proxy configuration, rotation, and health monitoring.

```js
import { ProxyManager } from './api/index.js';

const pm = new ProxyManager({
  rotationStrategy: 'weighted', // 'weighted' | 'round-robin' | 'lowest-latency' | 'failover'
  healthCheckIntervalMs: 60_000,
  maxFailuresBeforeBlacklist: 5,
});

// Add proxies with weights
pm.addProxy({ url: 'https://proxy1.example.com', weight: 3, authToken: '...' });
pm.addProxy({ url: 'https://proxy2.example.com', weight: 1, authToken: '...' });

// Get the best proxy for the next request
const proxy = pm.getProxy();
// { url: 'https://proxy1.example.com', id: 'proxy-proxy1-example-com-default', headers: {...} }

// Report results
pm.reportSuccess(proxy.id, 150); // latency 150ms
pm.reportFailure(proxy.id, 'Connection timeout');

// Test all proxies
const results = await pm.testAllProxies();

// Start background health monitoring
pm.startHealthMonitor(60_000); // check every 60s

// Single proxy convenience
pm.configureProxy('https://my-proxy.example.com', { authToken: '...' });
```

### Rotation strategies

| Strategy | Description |
|----------|-------------|
| `weighted` | Random selection weighted by proxy weight (default) |
| `round-robin` | Sequential rotation through proxies |
| `lowest-latency` | Always pick the fastest-responding proxy |
| `failover` | Use first healthy proxy; only switch on failure |

---

## Rate Limiter

Token-bucket rate limiter with priority queue and automatic retry.

```js
import { RateLimiter, Priority } from './api/index.js';

const limiter = new RateLimiter({
  requestsPerMinute: 60,
  burstSize: 10,
  maxRetries: 3,
  baseDelayMs: 1000,
});

// Wrap any API call
const result = await limiter.execute('openai', async () => {
  return await provider.chat(messages, options);
});

// Update rate limits from API response headers
limiter.updateFromResponse('openai', response.headers);

// Check current status
const info = limiter.getRateLimitInfo('openai');
// { requestsLimit: 60, requestsRemaining: 42, ... }

// Get stats for all providers
const stats = limiter.getStats();
```

### Priority levels

```js
import { Priority } from './api/index.js';

await limiter.execute('openai', myFn, { priority: Priority.HIGH });   // goes first
await limiter.execute('openai', myFn, { priority: Priority.NORMAL }); // normal
await limiter.execute('openai', myFn, { priority: Priority.LOW });    // queued last
```

---

## Adding a New Provider

1. **Create the provider file** at `src/api/providers/my-provider.js`:

   ```js
   import { BaseProvider, ProviderError } from '../provider-interface.js';

   export class MyProvider extends BaseProvider {
     constructor(config = {}) {
       super({
         apiKey: config.apiKey,
         baseUrl: config.baseUrl || 'https://api.my-provider.com/v1',
         model: config.model || 'default-model',
       });
       this.name = 'my-provider';
       this.capabilities = this._buildCapabilities();
     }

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
         rateLimitInfo: false,
         supportedFeatures: [],
       };
     }

     async chat(messages, options = {}) {
       const model = this._resolveModel(options.model);
       // 1. Build your provider-specific payload
       // 2. Call _request() or fetch directly
       // 3. Normalise response to standard format
       // 4. Return { id, content, model, usage, finishReason }
     }

     async complete(prompt, options = {}) {
       // Delegate to chat() or implement separately
       const result = await this.chat([{ role: 'user', content: prompt }], options);
       return { id: result.id, text: result.content, model: result.model, usage: result.usage, finishReason: result.finishReason };
     }

     async listModels() { /* ... */ }
     async testConnection() { /* ... */ }
   }
   ```

2. **Export from the barrel** in `src/api/index.js`:

   ```js
   export { MyProvider } from './providers/my-provider.js';
   ```

3. **Register with the factory** (optional, for `type: 'my-provider'` support):

   ```js
   import { MyProvider } from './providers/my-provider.js';
   ProviderFactory.registerProvider('my-provider', MyProvider);
   ```

4. **Add environment variables** to your config:

   ```
   MY_PROVIDER_API_KEY=...
   MY_PROVIDER_BASE_URL=https://api.my-provider.com/v1
   MY_PROVIDER_MODEL=default-model
   ```

---

## Environment Variable Reference

| Variable | Provider | Description |
|----------|----------|-------------|
| `ZEROCLAW_API_KEY` | ZeroClaw | API key |
| `ZEROCLAW_BASE_URL` | ZeroClaw | Override base URL |
| `ZEROCLAW_MODEL` | ZeroClaw | Default model |
| `PI_AGENT_API_KEY` | Pi Agent | API key |
| `PI_AGENT_BASE_URL` | Pi Agent | Override base URL |
| `PI_AGENT_MODEL` | Pi Agent | Default model |
| `ANTHROPIC_API_KEY` | Claude | Anthropic API key |
| `ANTHROPIC_BASE_URL` | Claude | Override base URL |
| `CLAUDE_MODEL` | Claude | Default model |
| `OPENAI_API_KEY` | OpenAI | OpenAI API key |
| `OPENAI_BASE_URL` | OpenAI | Override base URL (for Azure, etc.) |
| `OPENAI_MODEL` | OpenAI | Default model |
| `OPENAI_ORG_ID` | OpenAI | Organisation ID |
| `GENERIC_API_KEY` | Generic | API key (may not be needed) |
| `GENERIC_BASE_URL` | Generic | **Required** — endpoint base URL |
| `GENERIC_MODEL` | Generic | Default model |
| `GENERIC_TIMEOUT_MS` | Generic | Request timeout (ms) |

---

## Troubleshooting

### "Provider config must include a baseUrl" (GenericOpenAIProvider)

The generic provider **requires** a `baseUrl`. Set it via:
```js
{ baseUrl: 'http://localhost:11434/v1' }
```
Or the `GENERIC_BASE_URL` environment variable.

### "Unknown provider type: xyz"

Check the provider type is correct. Built-in types: `zeroclaw`, `pi-agent`, `claude`, `openai`, `generic`. Use `ProviderFactory.getRegisteredTypes()` to list all available.

### Claude: "messages must alternate between user and assistant"

Claude requires the first message to be `role: user`. The provider auto-handles this, but if you're passing pre-formatted messages, ensure they follow the pattern: `user → assistant → user → ...`

### Rate limiting (429 errors)

- The rate limiter automatically retries with exponential backoff
- Increase `baseDelayMs` or `maxRetries` in the retry config
- Use a fallback chain to distribute load across providers
- Set up a proxy with rotation to distribute across multiple API keys

### Ollama timeouts

Ollama can be slow on large models. Increase the timeout:
```js
{ baseUrl: 'http://localhost:11434/v1', timeoutMs: 300000 }
```

### Streaming not working

Not all endpoints support streaming. Check with:
```js
const caps = provider.getCapabilities();
console.log(caps.streaming); // true or false
```

### Proxy health checks failing

- Ensure the proxy URL is reachable
- Check auth tokens are correct
- Increase `timeoutMs` for slow proxies
- Use `pm.testProxy(id)` to get detailed error info
