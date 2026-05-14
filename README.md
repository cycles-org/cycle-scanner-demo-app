# Cycle Tools × FintaChart Scanner

A web-based cycle analysis dashboard built on top of the [Cycles API](https://api.cycle.tools) using the [@fintatech/fintachart](https://github.com/fintatech/fintachart) charting library.

## Features

- **Symbol search + load** — debounced search against the Cycle Tools `SearchSymbols` endpoint, picks symbol → fetches OHLCV → runs cycle scanner → computes HP-detrend trend → renders
- **Cycle composite** — multiple selected cycles summed into a single sine wave, projected forward, rendered in its own pane (auto-scaled) or as a price overlay
- **Per-cycle individual panes** — toggle cycles into their own auto-scaled panes for direct comparison
- **CRSI oscillator** — auto-picks an appropriate cycle length from the user's selection, fetches CRSI from the API, renders with dynamic upper/lower bands
- **Spectrum visualization** — bottom pane shows the full amplitude spectrum with Bartels-colored peak triangles; click a peak to toggle the cycle in the composite
- **Interactive cycles table** — sortable, dual checkbox columns (composite / own pane), phase-colored length badges
- **Forward projection** — composite + per-cycle indicators project past the last bar; slider controls projection length
- **Now-bar dot** — small dot on each cycle pane marks the current bar position so you can read where the cycle is in its swing
- **Resizable panes** — drag-to-resize between price/spectrum/right-pane
- **Dark / light theme toggle** — chart + page chrome switch in lockstep
- **Crosshair on chart and spectrum** — full crosshair overlay with hover tooltip on spectrum peaks (cycle length, amp, strength, stability, Bartels, phase status)

## Repository layout

```
.
├── .github/workflows/deploy.yml   GitHub Actions: build + publish to Pages on push to main
├── app/                           the React app
│   ├── src/
│   │   ├── App.jsx                main scanner UI
│   │   ├── api.js                 Cycle Tools REST wrapper
│   │   ├── indicators.js          custom FintaChart indicators (composite, single-cycle, CRSI)
│   │   ├── CycleToolsDatafeed.js  passive datafeed (we push bars via chart.appendBars)
│   │   ├── components/            LoginScreen, CyclesTable, SpectrumChart, IndicatorPanel, ...
│   │   ├── state/                 Zustand store
│   │   └── utils/                 cycle math, phase color mapping
│   ├── public/
│   │   ├── CNAME                  custom-domain config for GitHub Pages
│   │   └── vendor/fintachart/     auto-populated at build time from node_modules
│   └── vite.config.js             Vite + asset-copy plugin
└── README.md                      this file
```

## Local development

```bash
cd app
npm install
npm run dev
```

Open <http://localhost:5174>, paste your Cycle Tools API key on the login screen, search a symbol.

## Deployment

The repo is configured to auto-publish to GitHub Pages at the domain in `app/public/CNAME` on every push to `main`.

**One-time setup:**

1. Set `app/public/CNAME` to your custom domain.
2. Point that domain at GitHub Pages via DNS:
   ```
   Name:   <your-subdomain>
   Type:   CNAME
   Value:  <your-github-username>.github.io
   ```
3. In the repo on github.com: **Settings → Pages → Source = "GitHub Actions"**.
4. Push to `main` — the workflow at `.github/workflows/deploy.yml` builds and publishes automatically.

GitHub provisions Let's Encrypt automatically once DNS resolves. First deploy takes ~2 minutes for the build + ~5–10 minutes for cert issuance.

## License

- This app's source code: see [LICENSE](LICENSE).
- FintaChart bundle: proprietary, requires a commercial license from Fintatech for any deployed/network-accessible use.
- Cycle Tools API: each user supplies their own API key.

## Acknowledgements

- [@fintatech/fintachart](https://github.com/fintatech/fintachart) charting library
- [FSC Cycle Tools API](https://api.cycle.tools)
