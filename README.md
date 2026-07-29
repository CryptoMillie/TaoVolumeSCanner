# TaoVolumeScanner

A terminal-styled dashboard of scanners for Bittensor subnets — volume, risk,
health, institutional, alpha, purity, gem-finding, conviction locks, burn,
whale concentration, and (since the v440 runtime update) **The Bar**, the
emission-gate proximity tab. See `NOTES.md` for what was verified against the
live chain source while building the v440 support.

## The v440 emission gate — `q` and `h` are governance-mutable

Since runtime spec 440 (2026-07-27), each subnet's emission share is no
longer linear in demand — it passes through a Hill-function gate centered on
`theta` (the bar), with two on-chain parameters:

- **`q`** (`EmissionBarQuantile`) — the quantile that defines where theta
  sits. Default `0.61`.
- **`h`** (`EmissionGateExponent`) — how sharp the cliff at the bar is.
  Default `3`.

Both are `sudo`-settable `StorageValue`s on-chain and can change at any time.
**Every tab that derives from emission share depends on these** — a
governance change to either one re-prices every position in the tool. Never
hardcode `q`/`h` at a call site; they're read from
[`src/lib/GateConfigContext.jsx`](src/lib/GateConfigContext.jsx)
(`useGateConfig()`), which The Bar tab's header also exposes as an editable
local scenario-preview (editing it does not touch chain state). The pure gate
math itself lives in [`src/lib/gate.js`](src/lib/gate.js).

---

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
