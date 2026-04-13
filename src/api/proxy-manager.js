/**
 * @module proxy-manager
 * @description Proxy management for the superz-twin API layer.
 *
 * Handles proxy configuration, health monitoring, rotation, and
 * authentication management. Supports:
 *
 *   - Single proxy configuration
 *   - Multiple proxy rotation (round-robin or failover)
 *   - Periodic health checks
 *   - Custom headers and auth per-proxy
 *   - Proxy blacklisting on persistent failure
 *
 * @example
 * import { ProxyManager } from './proxy-manager.js';
 *
 * const pm = new ProxyManager();
 *
 * // Add proxies
 * pm.addProxy({ url: 'https://proxy1.example.com', weight: 3 });
 * pm.addProxy({ url: 'https://proxy2.example.com', weight: 1 });
 *
 * // Get the best proxy for the next request
 * const proxy = pm.getProxy(); // returns the proxy URL string
 *
 * // Test all proxies
 * const results = await pm.testAllProxies();
 *
 * // Start health monitoring
 * pm.startHealthMonitor(60000); // check every 60s
 */

import { ProviderError } from './provider-interface.js';

/**
 * Health status of a proxy.
 * @typedef {object} ProxyHealthStatus
 * @property {boolean} healthy - Whether the proxy is healthy.
 * @property {number} latencyMs - Last measured latency in ms.
 * @property {string} [error] - Error message if unhealthy.
 * @property {number} lastCheckAt - Timestamp of last health check.
 * @property {number} successCount - Number of consecutive successes.
 * @property {number} failureCount - Number of consecutive failures.
 */

/**
 * Proxy configuration.
 * @typedef {object} ProxyConfig
 * @property {string} url - Proxy URL (full URL with protocol).
 * @property {string} [id] - Optional unique identifier (auto-generated if omitted).
 * @property {string} [authToken] - Auth token for the proxy.
 * @property {string} [username] - Username for proxy auth.
 * @property {string} [password] - Password for proxy auth.
 * @property {number} [weight=1] - Weight for weighted rotation (higher = more traffic).
 * @property {object} [headers={}] - Additional headers to send via this proxy.
 * @property {number} [timeoutMs=10000] - Health check timeout.
 * @property {boolean} [enabled=true] - Whether this proxy is active.
 */

/**
 * ProxyManager — manages proxy configuration, health, and rotation.
 */
export class ProxyManager {
  /**
   * Create a ProxyManager.
   * @param {object} [options={}]
   * @param {ProxyConfig[]} [options.proxies=[]] - Initial proxy configurations.
   * @param {number} [options.healthCheckIntervalMs=120000] - Default health check interval.
   * @param {number} [options.maxFailuresBeforeBlacklist=5] - Failures before blacklisting.
   * @param {number} [options.blacklistDurationMs=300000] - How long to keep a proxy blacklisted.
   * @param {string} [options.rotationStrategy='weighted'] - 'weighted' | 'round-robin' | 'lowest-latency' | 'failover'.
   */
  constructor(options = {}) {
    /** @type {Map<string, ProxyConfig>} */
    this.proxies = new Map();

    /** @type {Map<string, ProxyHealthStatus>} */
    this.healthStatus = new Map();

    /** @type {number} */
    this._roundRobinIndex = 0;

    /** @type {Map<string, number>} */
    this._blacklist = new Map(); // proxy id → blacklist expiry timestamp

    /** @type {number|null} */
    this._healthMonitorTimer = null;

    /** @type {number} */
    this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? 120_000;

    /** @type {number} */
    this.maxFailuresBeforeBlacklist = options.maxFailuresBeforeBlacklist ?? 5;

    /** @type {number} */
    this.blacklistDurationMs = options.blacklistDurationMs ?? 300_000;

    /** @type {string} */
    this.rotationStrategy = options.rotationStrategy ?? 'weighted';

    /** @type {boolean} */
    this.monitoring = false;

    // Add initial proxies
    if (Array.isArray(options.proxies)) {
      for (const proxy of options.proxies) {
        this.addProxy(proxy);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Proxy CRUD
  // -------------------------------------------------------------------------

  /**
   * Add a proxy to the pool.
   *
   * @param {ProxyConfig} config - Proxy configuration.
   * @returns {string} The proxy ID.
   * @throws {ProviderError} If config is invalid.
   */
  addProxy(config) {
    if (!config || !config.url) {
      throw new ProviderError('Proxy config must include a url', { retryable: false });
    }

    const id = config.id || _generateProxyId(config.url);
    const proxy = {
      url: config.url.replace(/\/+$/, ''),
      id,
      authToken: config.authToken || null,
      username: config.username || null,
      password: config.password || null,
      weight: config.weight ?? 1,
      headers: config.headers || {},
      timeoutMs: config.timeoutMs ?? 10_000,
      enabled: config.enabled ?? true,
    };

    this.proxies.set(id, proxy);
    this.healthStatus.set(id, {
      healthy: null, // unknown until tested
      latencyMs: 0,
      error: null,
      lastCheckAt: 0,
      successCount: 0,
      failureCount: 0,
    });

    this._blacklist.delete(id);
    return id;
  }

  /**
   * Remove a proxy from the pool.
   *
   * @param {string} id - Proxy ID.
   * @returns {boolean} Whether the proxy was found and removed.
   */
  removeProxy(id) {
    this._blacklist.delete(id);
    return this.proxies.delete(id) && this.healthStatus.delete(id);
  }

  /**
   * Update a proxy's configuration.
   *
   * @param {string} id - Proxy ID.
   * @param {Partial<ProxyConfig>} updates - Fields to update.
   * @returns {boolean} Whether the proxy was found.
   */
  updateProxy(id, updates) {
    const proxy = this.proxies.get(id);
    if (!proxy) return false;

    if (updates.url) proxy.url = updates.url.replace(/\/+$/, '');
    if (updates.authToken !== undefined) proxy.authToken = updates.authToken;
    if (updates.username !== undefined) proxy.username = updates.username;
    if (updates.password !== undefined) proxy.password = updates.password;
    if (updates.weight !== undefined) proxy.weight = updates.weight;
    if (updates.headers) proxy.headers = { ...proxy.headers, ...updates.headers };
    if (updates.timeoutMs !== undefined) proxy.timeoutMs = updates.timeoutMs;
    if (updates.enabled !== undefined) proxy.enabled = updates.enabled;

    return true;
  }

  /**
   * Get a proxy configuration by ID.
   *
   * @param {string} id - Proxy ID.
   * @returns {ProxyConfig|null}
   */
  getProxy(id) {
    return this.proxies.get(id) ?? null;
  }

  /**
   * List all proxy IDs and their URLs.
   *
   * @returns {Array<{id: string, url: string, enabled: boolean, healthy: boolean|null}>}
   */
  listProxies() {
    return [...this.proxies.entries()].map(([id, proxy]) => ({
      id,
      url: proxy.url,
      enabled: proxy.enabled,
      healthy: this.healthStatus.get(id)?.healthy ?? null,
      weight: proxy.weight,
    }));
  }

  // -------------------------------------------------------------------------
  // Proxy selection / rotation
  // -------------------------------------------------------------------------

  /**
   * Get the best available proxy URL for the next request.
   * Follows the configured rotation strategy.
   *
   * @returns {{url: string, id: string, headers: object}|null} Proxy info, or null if none available.
   */
  getProxy() {
    const now = Date.now();
    const available = [...this.proxies.entries()]
      .filter(([id, proxy]) => {
        if (!proxy.enabled) return false;
        if (this._blacklist.has(id) && this._blacklist.get(id) > now) return false;
        return true;
      });

    if (available.length === 0) return null;

    switch (this.rotationStrategy) {
      case 'round-robin':
        return this._selectRoundRobin(available);
      case 'lowest-latency':
        return this._selectLowestLatency(available);
      case 'failover':
        return this._selectFailover(available);
      case 'weighted':
      default:
        return this._selectWeighted(available);
    }
  }

  /**
   * Report that a request via a proxy succeeded.
   * Updates health stats and removes from blacklist if present.
   *
   * @param {string} proxyId - Proxy ID.
   * @param {number} [latencyMs=0] - Request latency.
   */
  reportSuccess(proxyId, latencyMs = 0) {
    const status = this.healthStatus.get(proxyId);
    if (!status) return;

    status.healthy = true;
    status.latencyMs = latencyMs;
    status.lastCheckAt = Date.now();
    status.successCount++;
    status.failureCount = 0;
    this._blacklist.delete(proxyId);
  }

  /**
   * Report that a request via a proxy failed.
   * Updates health stats and may blacklist the proxy.
   *
   * @param {string} proxyId - Proxy ID.
   * @param {string} [error='Unknown error'] - Error description.
   */
  reportFailure(proxyId, error = 'Unknown error') {
    const status = this.healthStatus.get(proxyId);
    if (!status) return;

    status.healthy = false;
    status.error = error;
    status.lastCheckAt = Date.now();
    status.failureCount++;
    status.successCount = 0;

    if (status.failureCount >= this.maxFailuresBeforeBlacklist) {
      this._blacklist.set(proxyId, Date.now() + this.blacklistDurationMs);
    }
  }

  // -------------------------------------------------------------------------
  // Health checking
  // -------------------------------------------------------------------------

  /**
   * Test a single proxy's connectivity.
   *
   * @param {string} id - Proxy ID.
   * @returns {Promise<ProxyHealthStatus & {id: string, url: string}>}
   */
  async testProxy(id) {
    const proxy = this.proxies.get(id);
    if (!proxy) {
      throw new ProviderError(`Proxy not found: ${id}`, { retryable: false });
    }

    const start = Date.now();
    const status = this.healthStatus.get(id);

    try {
      // Make a lightweight GET request to the proxy
      const response = await fetch(proxy.url, {
        method: 'GET',
        headers: this._buildProxyHeaders(proxy),
        signal: AbortSignal.timeout(proxy.timeoutMs),
      });

      const latencyMs = Date.now() - start;
      const healthy = response.ok || response.status < 500;

      status.healthy = healthy;
      status.latencyMs = latencyMs;
      status.lastCheckAt = Date.now();
      status.error = healthy ? null : `HTTP ${response.status}`;

      if (healthy) {
        status.successCount++;
        status.failureCount = 0;
        this._blacklist.delete(id);
      } else {
        status.failureCount++;
      }

      return { ...status, id, url: proxy.url };
    } catch (error) {
      status.healthy = false;
      status.latencyMs = Date.now() - start;
      status.lastCheckAt = Date.now();
      status.error = error.message;
      status.failureCount++;

      if (status.failureCount >= this.maxFailuresBeforeBlacklist) {
        this._blacklist.set(id, Date.now() + this.blacklistDurationMs);
      }

      return { ...status, id, url: proxy.url };
    }
  }

  /**
   * Test all proxies and return results.
   *
   * @returns {Promise<Array<ProxyHealthStatus & {id: string, url: string}>>}
   */
  async testAllProxies() {
    const ids = [...this.proxies.keys()];
    const results = await Promise.allSettled(ids.map((id) => this.testProxy(id)));

    return results.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      const proxy = this.proxies.get(ids[index]);
      return {
        id: ids[index],
        url: proxy?.url ?? 'unknown',
        healthy: false,
        latencyMs: 0,
        error: result.reason?.message ?? 'Test failed',
        lastCheckAt: Date.now(),
        successCount: 0,
        failureCount: 1,
      };
    });
  }

  /**
   * Start periodic health monitoring.
   *
   * @param {number} [intervalMs] - Override the default interval.
   */
  startHealthMonitor(intervalMs) {
    this.stopHealthMonitor();
    const ms = intervalMs ?? this.healthCheckIntervalMs;

    const check = async () => {
      try {
        await this.testAllProxies();
      } catch {
        // non-fatal
      }
    };

    this._healthMonitorTimer = setInterval(check, ms);
    this.monitoring = true;

    // Run initial check
    check();
  }

  /**
   * Stop periodic health monitoring.
   */
  stopHealthMonitor() {
    if (this._healthMonitorTimer) {
      clearInterval(this._healthMonitorTimer);
      this._healthMonitorTimer = null;
    }
    this.monitoring = false;
  }

  // -------------------------------------------------------------------------
  // Convenience
  // -------------------------------------------------------------------------

  /**
   * Configure a single proxy (replaces all existing proxies).
   * Convenience method for the common "single proxy" use case.
   *
   * @param {string} proxyUrl - Full proxy URL.
   * @param {object} [options={}] - Additional options.
   * @returns {string} The proxy ID.
   */
  configureProxy(proxyUrl, options = {}) {
    this.proxies.clear();
    this.healthStatus.clear();
    this._blacklist.clear();
    return this.addProxy({ url: proxyUrl, ...options });
  }

  /**
   * Get the total number of proxies (including disabled).
   * @returns {number}
   */
  get proxyCount() {
    return this.proxies.size;
  }

  /**
   * Get the number of healthy, available proxies.
   * @returns {number}
   */
  get healthyProxyCount() {
    let count = 0;
    for (const [id, proxy] of this.proxies) {
      if (!proxy.enabled) continue;
      const status = this.healthStatus.get(id);
      if (!status) continue;
      if (status.healthy === false) continue;
      if (this._blacklist.has(id) && this._blacklist.get(id) > Date.now()) continue;
      count++;
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Internal: rotation strategies
  // -------------------------------------------------------------------------

  /**
   * Weighted random selection.
   * @private
   * @param {Array} available
   * @returns {{url: string, id: string, headers: object}}
   */
  _selectWeighted(available) {
    const totalWeight = available.reduce((sum, [, p]) => sum + p.weight, 0);
    let random = Math.random() * totalWeight;

    for (const [id, proxy] of available) {
      random -= proxy.weight;
      if (random <= 0) {
        return { url: proxy.url, id, headers: this._buildProxyHeaders(proxy) };
      }
    }

    // Fallback to first
    const [id, proxy] = available[0];
    return { url: proxy.url, id, headers: this._buildProxyHeaders(proxy) };
  }

  /**
   * Round-robin selection.
   * @private
   * @param {Array} available
   * @returns {{url: string, id: string, headers: object}}
   */
  _selectRoundRobin(available) {
    const index = this._roundRobinIndex % available.length;
    this._roundRobinIndex++;
    const [id, proxy] = available[index];
    return { url: proxy.url, id, headers: this._buildProxyHeaders(proxy) };
  }

  /**
   * Select proxy with lowest recent latency.
   * @private
   * @param {Array} available
   * @returns {{url: string, id: string, headers: object}}
   */
  _selectLowestLatency(available) {
    const sorted = [...available].sort((a, b) => {
      const aLat = this.healthStatus.get(a[0])?.latencyMs ?? Infinity;
      const bLat = this.healthStatus.get(b[0])?.latencyMs ?? Infinity;
      return aLat - bLat;
    });

    const [id, proxy] = sorted[0];
    return { url: proxy.url, id, headers: this._buildProxyHeaders(proxy) };
  }

  /**
   * Failover — always pick the first healthy proxy.
   * @private
   * @param {Array} available
   * @returns {{url: string, id: string, headers: object}}
   */
  _selectFailover(available) {
    // Prefer known-healthy proxies
    for (const [id, proxy] of available) {
      const status = this.healthStatus.get(id);
      if (status?.healthy === true) {
        return { url: proxy.url, id, headers: this._buildProxyHeaders(proxy) };
      }
    }

    // No known-healthy, pick first
    const [id, proxy] = available[0];
    return { url: proxy.url, id, headers: this._buildProxyHeaders(proxy) };
  }

  /**
   * Build headers for a proxy request.
   * @private
   * @param {ProxyConfig} proxy
   * @returns {object}
   */
  _buildProxyHeaders(proxy) {
    const headers = { ...proxy.headers };

    if (proxy.authToken) {
      headers.Authorization = `Bearer ${proxy.authToken}`;
    } else if (proxy.username && proxy.password) {
      headers['Proxy-Authorization'] = 'Basic ' +
        Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
    }

    return headers;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Generate a short proxy ID from a URL.
 * @private
 * @param {string} url
 * @returns {string}
 */
function _generateProxyId(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/\./g, '-');
    const port = parsed.port || 'default';
    return `proxy-${host}-${port}`;
  } catch {
    return `proxy-${Date.now().toString(36)}`;
  }
}

export default ProxyManager;
