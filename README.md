# ⚡ Super Z Twin

**Digital twin of Super Z — standalone API-agnostic git-agent with FLUX-native cognition**

Super Z Twin captures the cognition and working style of Super Z, a FLUX Fleet Architect AI agent. It operates as a standalone git-agent that can work with multiple AI providers, making autonomous code changes through a structured, configurable workflow.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SUPER Z TWIN ARCHITECTURE                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────────────┐  │
│  │  CLI      │───▶│  Config      │───▶│  Cognitive Profile       │  │
│  │  (bin/)   │    │  Manager     │    │  ┌─ Identity             │  │
│  │           │    │  ~/.superz/  │    │  ├─ Risk Tolerance       │  │
│  │  • onboard│    │  .superz/    │    │  ├─ Code Style           │  │
│  │  • init   │    │              │    │  └─ Git Behavior         │  │
│  │  • run    │    │  • YAML load │    └──────────┬───────────────┘  │
│  │  • status │    │  • Validation│               │                  │
│  │  • config │    │  • Merging   │               │                  │
│  └──────────┘    │  • Env vars  │               │                  │
│                   └──────────────┘               │                  │
│                                                   ▼                  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    AGENT CORE (index.js)                      │   │
│  │                                                              │   │
│  │  ┌──────────┐  ┌──────────────┐  ┌──────────────────────┐   │   │
│  │  │  State    │  │  Task Loop   │  │  Metrics             │   │   │
│  │  │  Machine  │  │  Processor   │  │  • Tasks processed   │   │   │
│  │  │           │  │              │  │  • Success/fail rate  │   │   │
│  │  │ IDLE ──▶  │  │  • Parse     │  │  • Uptime            │   │   │
│  │  │ RUNNING ─▶│  │  • Execute   │  │  • Error log         │   │   │
│  │  │ PAUSED  ─▶│  │  • Validate  │  └──────────────────────┘   │   │
│  │  │ STOPPED   │  │  • Commit    │                              │   │
│  │  └──────────┘  └──────┬───────┘                              │   │
│  └────────────────────────┼──────────────────────────────────────┘   │
│                           │                                          │
│                    ┌──────▼───────┐                                  │
│                    │  Provider     │                                  │
│                    │  Adapter      │                                  │
│                    │  Layer        │                                  │
│                    ├───────────────┤                                  │
│                    │ ZeroClaw      │                                  │
│                    │ Pi Agent      │                                  │
│                    │ Claude        │                                  │
│                    │ OpenAI        │                                  │
│                    │ Custom Proxy  │                                  │
│                    └───────────────┘                                  │
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐   │
│  │  Git Utils   │    │  Logger      │    │  Onboarding          │   │
│  │              │    │              │    │                      │   │
│  │  • Repo info │    │  • Colorized │    │  • Provider select   │   │
│  │  • Branching │    │  • File logs │    │  • Connection test   │   │
│  │  • Commit    │    │  • Timestamps│    │  • Preferences       │   │
│  │  • PR create │    │  • Verbose   │    │  • Repo setup        │   │
│  └──────────────┘    └──────────────┘    └──────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- **Node.js** >= 18.0.0
- **Git** installed and available in PATH
- An API key for your chosen AI provider

### Installation

```bash
# Clone the repository
git clone <repo-url> superz-twin
cd superz-twin

# Install dependencies
npm install

# Run the interactive onboarding wizard
npm run onboarding
# or directly:
./bin/superz.js onboard
```

### First Run

```bash
# Initialize in your target repository
npx superz init ./my-project

# Start the agent
npx superz run

# Check status
npx superz status
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `superz onboard` | Run the interactive setup wizard |
| `superz init <repo>` | Initialize the agent in a repository |
| `superz run` | Start the agent loop |
| `superz run --verbose` | Start with detailed logging |
| `superz run --dry-run` | Simulate without making changes |
| `superz status` | Show current agent state |
| `superz status -v` | Show detailed configuration |
| `superz configure` | Reconfigure provider and settings |
| `superz --version` | Show version number |

## API Provider Setup

Super Z Twin is API-agnostic and supports multiple providers through a unified adapter layer.

### ZeroClaw

```bash
export SUPERZ_API_KEY="zc-your-api-key"
# or set during onboarding
```

**Default base URL:** `https://api.zeroclaw.ai/v1`  
**Default model:** `zeroclaw-latest`

### Pi Agent

```bash
export SUPERZ_API_KEY="pi-your-api-key"
```

**Default base URL:** `https://api.piagent.dev/v1`  
**Default model:** `piagent-code-v2`

### Claude (Anthropic)

```bash
export SUPERZ_API_KEY="sk-ant-your-api-key"
```

**Default base URL:** `https://api.anthropic.com/v1`  
**Default model:** `claude-sonnet-4-20250514`

### OpenAI

```bash
export SUPERZ_API_KEY="sk-your-api-key"
```

**Default base URL:** `https://api.openai.com/v1`  
**Default model:** `gpt-4o`

### Custom Proxy

For self-hosted or third-party OpenAI-compatible endpoints:

```bash
# During onboarding, select "Custom Proxy" and enter your URL
# or set via environment:
export SUPERZ_BASE_URL="https://your-proxy.example.com/v1"
export SUPERZ_PROVIDER_TYPE="proxy"
```

## Configuration Reference

Configuration is stored at `~/.superz/config.yaml` (user-level) and `.superz/config.yaml` (repo-level). Repo-level settings override user-level settings.

```yaml
version: "0.1.0"

provider:
  type: openai              # zeroclaw | piagent | claude | openai | proxy
  apiKey: sk-...            # API key (stored locally)
  baseUrl: null             # Override default URL (for proxy)
  model: gpt-4o             # Override default model

agent:
  name: Super Z
  parallelism: 3            # Max concurrent tasks (1-10)
  riskTolerance: balanced   # conservative | balanced | aggressive
  autoCommit: true          # Auto-commit after tasks
  autoPush: false           # Auto-push commits to remote
  branchPrefix: superz/     # Prefix for agent-created branches
  commitStyle: conventional # conventional | descriptive | minimal
  maxRetries: 3             # API call retry count
  timeout: 120000           # API call timeout (ms)

preferences:
  languages:
    - javascript
    - typescript
  frameworks: []
  codeStyle: clean
  testFirst: false
  documentation: standard   # minimal | standard | comprehensive
  verbose: false

paths:
  configDir: ~/.superz
  logsDir: ~/.superz/logs
  cacheDir: ~/.superz/cache
```

### Environment Variable Overrides

All configuration values can be overridden via environment variables:

| Variable | Config Path |
|----------|-------------|
| `SUPERZ_PROVIDER_TYPE` | `provider.type` |
| `SUPERZ_API_KEY` | `provider.apiKey` |
| `SUPERZ_BASE_URL` | `provider.baseUrl` |
| `SUPERZ_MODEL` | `provider.model` |
| `SUPERZ_PARALLELISM` | `agent.parallelism` |
| `SUPERZ_RISK_TOLERANCE` | `agent.riskTolerance` |
| `SUPERZ_AUTO_COMMIT` | `agent.autoCommit` |
| `SUPERZ_AUTO_PUSH` | `agent.autoPush` |
| `SUPERZ_BRANCH_PREFIX` | `agent.branchPrefix` |
| `SUPERZ_VERBOSE` | `preferences.verbose` |
| `GITHUB_TOKEN` | `agent.githubToken` (for PR creation) |

## Development

### Project Structure

```
superz-twin/
├── bin/
│   └── superz.js              # CLI entry point (5 commands)
├── src/
│   ├── index.js                # Main SuperZTwin class + state machine
│   ├── config/
│   │   └── index.js            # YAML config loader/merger/validator
│   ├── onboarding/
│   │   ├── index.js            # 6-step interactive wizard
│   │   └── providers.js        # Provider detection + health checks
│   ├── cognitive/
│   │   ├── profile.js          # Super Z's cognitive profile (the "brain")
│   │   ├── decision-engine.js  # Task → parallel execution plans
│   │   ├── prioritizer.js      # Weight-based task scoring (5 dimensions)
│   │   ├── risk-assessor.js    # Risk classification + mitigation
│   │   ├── iteration-manager.js # Round tracking (5-round minimum)
│   │   └── report-generator.js # Bottle protocol + session logs
│   ├── api/
│   │   ├── provider-interface.js   # Abstract base provider
│   │   ├── provider-factory.js     # Factory + fallback chains
│   │   ├── proxy-manager.js        # Proxy rotation + health monitoring
│   │   ├── rate-limiter.js         # Token bucket + priority queue
│   │   ├── providers/
│   │   │   ├── zeroclaw.js         # ZeroClaw adapter
│   │   │   ├── pi-agent.js         # Pi Agent adapter
│   │   │   ├── claude.js           # Anthropic Claude adapter
│   │   │   ├── openai.js           # OpenAI adapter
│   │   │   └── generic-openai.js   # ⭐ Any OpenAI-compatible endpoint
│   │   └── index.js
│   ├── agent/
│   │   ├── agent-loop.js       # Main loop: IDLE→PLAN→EXECUTE→REVIEW→REPORT
│   │   ├── task-executor.js    # Parallel task execution + retry
│   │   ├── git-workflow.js     # Full Git workflow (fork→branch→PR→CI)
│   │   ├── session-manager.js  # Session persistence + restore
│   │   └── progress-tracker.js # Metrics + milestones + persistence
│   ├── flux/
│   │   ├── flux-native.js      # ⭐ FLUX ISA-level thinking (unique!)
│   │   ├── vocabulary.js       # 80+ opcodes, 21 registers, ISA spec
│   │   └── polyglot-analyzer.js # Cross-language pattern analysis (6 langs)
│   └── utils/
│       ├── git.js              # Git utility functions
│       └── logger.js           # Color-coded structured logger
├── docs/
│   └── API-PROVIDERS.md        # Provider setup guide
├── package.json
├── LICENSE                     # MIT
└── README.md
```

### Running in Development

```bash
# Watch mode (auto-restart on changes)
npm run dev

# Run directly
node bin/superz.js run --verbose

# Run tests
npm test

# Lint
npm run lint
```

### Extending with a New Provider

1. Add your provider definition in `src/onboarding/providers.js`:

```js
export const PROVIDERS = {
  // ... existing providers
  myprovider: {
    name: 'My Provider',
    description: 'Description here',
    defaultBaseUrl: 'https://api.myprovider.com/v1',
    healthEndpoint: '/health',
    needsApiKey: true,
    defaultModel: 'my-model-v1',
  },
};
```

2. Implement the provider adapter in `src/providers/myprovider.js` (future module).

3. The onboarding wizard and config system will automatically pick up the new provider.

## How It Works

1. **Onboarding** — Interactive wizard configures the AI provider, working preferences, and target repository
2. **Initialization** — Agent loads config, builds a cognitive profile, and sets up the provider adapter
3. **Agent Loop** — The core loop processes tasks: receives instructions, generates code, validates changes, commits and optionally creates PRs
4. **Cognitive Profile** — Encodes Super Z's working style including risk tolerance, code conventions, and decision-making patterns
5. **Graceful Shutdown** — SIGINT/SIGTERM signals trigger clean shutdown with metrics reporting

## License

MIT
