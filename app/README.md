# Cycle Tools × FintaChart — integration test

Project-scoped sandbox that exercises a candidate **FintaChart** charting skill against the existing **cycle-tools-api** skill. The pipeline mirrors the original `cycle-analyzer/` demo (which used lightweight-charts v5), but every chart-rendering call goes through FintaChart instead.

```
SearchSymbols → EnsureCompleteDataset → WaitUntilUpdateCompleted → GetDatasetSeries
       ↓
   OHLC bars  ─────────────────────────►  FintaChart (candlesticks, primary pane)
       ↓
   closes[]  →  CycleScanner  →  pick dominant cycle  →  sine wave overlay (custom indicator)
                                                ↓
                                            CRSI  →  oscillator pane (custom indicator)
```

## Run

```bash
cd app
npm install
npm run dev
```

Then open http://localhost:5174, paste your **cycle.tools API key**, search for a symbol (e.g. `AAPL`, `MSFT`, `BTCUSDT`), and pick it from the dropdown. The chart loads bars, runs the cycle scanner, picks the dominant cycle, runs CRSI, and renders three layers via FintaChart.

The API key is persisted in `localStorage` (key `cycletools.apiKey`).

## What this app validates

| Capability | Where in code |
|------------|---------------|
| Chart bootstrap from a non-bundled global (`window.FintaChart`) | [src/main.jsx](src/main.jsx) |
| Custom datafeed pushing pre-fetched bars | [src/CycleToolsDatafeed.js](src/CycleToolsDatafeed.js) |
| Custom indicator on the price pane (sine wave overlay) | [src/indicators.js](src/indicators.js) (`CycleSine`) |
| Custom indicator in its own pane below price (CRSI + bands) | [src/indicators.js](src/indicators.js) (`CycleCRSI`) |
| Runtime instrument change re-running the pipeline | [src/App.jsx](src/App.jsx) |
| Resource path setup before chart construction | [src/main.jsx](src/main.jsx) |
| Asset copy from `node_modules` into `/public` for HTTP serving | [vite.config.js](vite.config.js) |

## Notes

- FintaChart is **free for local development only**; deployed use needs a commercial license.
- The `/vendor/fintachart/` folder is regenerated from `node_modules/@fintatech/fintachart/` on every `vite` start — no need to commit it (git-ignored).
- The skill being tested lives at `../.claude/skills/fintachart/` (project-scoped). It is not installed globally yet — that happens after this test confirms the integration works.
