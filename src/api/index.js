/**
 * @module api
 * @description Barrel export for the superz-twin API abstraction layer.
 *
 * This is the single entry point for all API-related functionality.
 * Import everything you need from here:
 *
 * ```js
 * import {
 *   BaseProvider,
 *   ProviderFactory,
 *   ProxyManager,
 *   RateLimiter,
 *   ZeroClawProvider,
 *   PiAgentProvider,
 *   ClaudeProvider,
 *   OpenAIProvider,
 *   GenericOpenAIProvider,
 *   Priority,
 * } from './api/index.js';
 * ```
 */

// ---------------------------------------------------------------------------
// Provider interface (base class and error types)
// ---------------------------------------------------------------------------
export {
  BaseProvider,
  NotImplementedError,
  ProviderError,
} from './provider-interface.js';

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------
export { ZeroClawProvider } from './providers/zeroclaw.js';
export { PiAgentProvider } from './providers/pi-agent.js';
export { ClaudeProvider } from './providers/claude.js';
export { OpenAIProvider } from './providers/openai.js';
export { GenericOpenAIProvider } from './providers/generic-openai.js';

// ---------------------------------------------------------------------------
// Factory and fallback
// ---------------------------------------------------------------------------
export { ProviderFactory, FallbackProvider } from './provider-factory.js';

// ---------------------------------------------------------------------------
// Supporting modules
// ---------------------------------------------------------------------------
export { ProxyManager } from './proxy-manager.js';
export { RateLimiter, Priority } from './rate-limiter.js';
