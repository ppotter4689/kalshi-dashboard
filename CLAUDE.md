# CLAUDE.md — Kalshi Trading Bot Dashboard

## Project Overview

A real-time trading bot dashboard for the **Kalshi prediction market** platform. The frontend monitors prediction markets (weather, economic, crypto, equity indices), evaluates automated trading strategies, displays live positions and P&L, and manages risk parameters. It operates in two modes:

- **Live mode**: Connects to a backend API (expected at `localhost:8000` or a deployed Railway URL) which proxies the Kalshi demo API.
- **Simulation mode**: Falls back to simulated market data when no backend is available.

**Version**: 2.0.0

## Tech Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Framework   | React 18.2 (functional components, hooks) |
| Build tool  | Vite 5.0 with `@vitejs/plugin-react` |
| Language    | JavaScript (JSX) — no TypeScript    |
| Styling     | Inline CSS in JSX (no CSS files, no Tailwind) |
| Font        | JetBrains Mono (loaded from Google Fonts) |
| Module type | ES Modules (`"type": "module"`)     |
| Testing     | None configured                     |
| Linting     | None configured                     |

## Repository Structure

```
kalshi-dashboard/
├── index.html              # HTML entry point (loads /src/main.jsx)
├── package.json            # Dependencies and scripts
├── vite.config.js          # Vite config with /api proxy to localhost:8000
└── src/
    ├── main.jsx            # React root render (StrictMode wrapper)
    └── Dashboard.jsx       # Entire application (~850 lines, single file)
```

This is a single-file application. All logic and UI live in `src/Dashboard.jsx`.

## Commands

```bash
npm run dev       # Start Vite dev server with HMR
npm run build     # Production build (output to dist/)
npm run preview   # Preview the production build locally
```

There are **no test, lint, or format commands**. The project has no testing framework, ESLint, or Prettier configured.

## Architecture

### Source Organization (`src/Dashboard.jsx`)

The entire application is a single monolithic file organized into clearly commented sections:

| Lines     | Section                | Description |
|-----------|------------------------|-------------|
| 1–6       | Imports & Config       | React hooks import; `BACKEND_URL` constant |
| 8–13      | `getBackendUrl()`      | Resolves backend URL (config → localhost → empty) |
| 16–40     | `parseMarkets()`       | Transforms raw Kalshi API data into dashboard format |
| 43–80     | Simulation helpers     | `generateSimMarkets()` creates 8 mock markets; `driftSimMarkets()` adds random price movement |
| 83–124    | Strategy functions     | `evaluateValueStrategy()` — value-based edge detection; `evaluateMMStrategy()` — market-making bid/ask quoting |
| 127–140   | `Sparkline`            | SVG mini-chart component |
| 143–266   | `EquityChart`          | Interactive SVG equity curve with hover tooltip |
| 271–827   | `Dashboard`            | Main component: state, effects, data fetching, strategy loop, full UI |
| 829–836   | `Panel`                | Reusable container with title header |
| 838–849   | `Slider`              | Range input control for parameter tuning |

### Components

| Component      | Props | Purpose |
|----------------|-------|---------|
| `Dashboard`    | None (root) | Main app: state management, data fetching, strategy execution, full layout |
| `EquityChart`  | `data`, `height` | Interactive P&L equity curve (SVG with hover crosshairs) |
| `Sparkline`    | `data`, `width`, `height`, `color` | Inline mini-chart for price trends |
| `Panel`        | `title`, `children`, `style` | Card-style container with header bar |
| `Slider`       | `label`, `value`, `min`, `max`, `step`, `unit`, `format`, `onChange` | Parameter tuning range input |

### State Management

All state lives in the `Dashboard` component via `useState` hooks. There is no Redux, Context API, or external state management. Key state variables:

- `mode` — `"detecting"` | `"live"` | `"sim"`
- `markets` — array of market objects
- `portfolio` — balance, positions, closed trades, equity curve, fees
- `signals` — current strategy signals (approved/rejected)
- `valueParams` / `mmParams` / `riskParams` — strategy configuration
- `isRunning` — whether the bot loop is active

### Data Flow

1. **Mount**: Auto-detect backend via `GET /api/status` → set mode to `live` or `sim`
2. **Main loop** (when running): `setInterval` at 3s (sim) or 5s (live)
   - Fetch or drift market data
   - Evaluate strategies against all markets
   - Apply risk checks to signals
   - Simulate P&L (open/close positions, compute unrealized)
   - Update equity curve (capped at 100 data points)
   - Append to activity log (capped at 150 entries)

## Backend API

The dashboard expects a backend at the configured URL with these endpoints:

| Endpoint | Method | Purpose | Key Response Fields |
|----------|--------|---------|---------------------|
| `/api/status` | GET | Check Kalshi connection | `{ connected: bool, error?: string }` |
| `/api/dashboard?market_limit=20` | GET | Fetch all dashboard data | `{ markets, orderbooks, balance, positions, fills, errors }` |

The Vite dev server proxies `/api` requests to `http://localhost:8000` (configured in `vite.config.js`).

## Key Data Models

### Market
```
{ ticker, title, yesBid, yesAsk, noBid, noAsk, mid, spread, volume, status, openInterest, expirationTime }
```
Prices are in **cents** (1–99). `mid` is the midpoint of yesBid and yesAsk.

### Portfolio
```
{ balance, totalPnl, positions: { [ticker-side]: { side, count, avgPrice, ticker, entryTime } },
  closedTrades: [{ ticker, side, entryPrice, exitPrice, count, pnl, time }],
  equityCurve: number[], totalFees }
```
Balance and P&L values are in **cents**. Display divides by 100 for dollar amounts.

### Signal
```
{ ticker, title, side ("YES"|"NO"), action ("BUY"), price, count,
  reason, confidence (0–1), edge, status ("APPROVED"|"REJECTED"), rejectReason? }
```

## Trading Strategies

- **Value Strategy** (`evaluateValueStrategy`): Estimates fair value with random noise, buys when ask price is below fair value by at least `threshold` cents with sufficient confidence.
- **Market-Making Strategy** (`evaluateMMStrategy`): Places symmetric bid/ask quotes at `mid ± spread/2` on both YES and NO sides.
- **Risk Management**: Signals are rejected if cost exceeds `maxExposure` or confidence is below `minConfidence`.

## Design Conventions

### Styling
- **Dark theme**: Background `#0a0e17`, card background `#111827`, borders `#1e293b`
- **Accent colors**: Cyan `#22d3ee` (primary), Green `#22c55e` (profit/YES), Red `#ef4444` (loss/NO), Amber `#f59e0b` (warnings/fees), Slate `#475569`/`#94a3b8` (muted text)
- **All CSS is inline** in JSX `style` props — no external stylesheets or CSS-in-JS libraries
- **Font**: JetBrains Mono throughout, base size 13px

### Code Patterns
- Functional components with hooks only (`useState`, `useEffect`, `useCallback`, `useRef`)
- Section separators: `// ── SECTION NAME ──` and `// ═══════` for major breaks
- Time display: 24-hour format via `toLocaleTimeString("en-US", { hour12: false })`
- Large numbers: Volume formatted as `12.5K` when over 1000
- Currency: Displayed as `$X.XX` (divide cents by 100); prices shown as `X¢`

### When Modifying This Codebase
- The entire app is in one file (`src/Dashboard.jsx`). If refactoring, consider extracting components into separate files under `src/components/`.
- There are no tests. If adding tests, Vitest is the natural choice given the Vite build system.
- There is no linting. If adding, use ESLint with a React-focused config.
- There is no `.gitignore` — add one if introducing `node_modules/`, `dist/`, or `.env` files.
- The `BACKEND_URL` on line 6 of `Dashboard.jsx` is the only configuration point. For environment-based config, migrate to Vite's `import.meta.env` system.
- All prices are in cents internally. Always divide by 100 for display.
