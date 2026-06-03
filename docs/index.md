# DeNoti — Documentation Index

## For Users

| Document | Description |
|---|---|
| [README](../README.md) | Project overview, installation, configuration reference, packaging |
| [Welcome guide](../assets/welcome.md) | In-app welcome shown on first launch; source-type overview and everyday usage |
| [Setup guide](../assets/setup-guide.md) | Step-by-step: GitHub Gist + Claude Code Routine + DeNoti end-to-end |

## For Developers

| Document | Description |
|---|---|
| [Architecture](architecture.md) | Process model, data model, IPC channels, polling system, renderer state, key invariants |

## Source Files

| File | Purpose |
|---|---|
| `src/main/index.ts` | Main process — polling timers, IPC handlers, tray, window lifecycle |
| `src/preload/index.ts` | `contextBridge` — exposes `window.api` to the renderer |
| `renderer/index.html` | All UI — tab bar, content view, settings form, vanilla JS state |
| `renderer/styles.css` | Dark-theme CSS — variables, markdown typography, tab bar, toast |
| `assets/welcome.md` | Default local-file source on fresh install |
| `assets/setup-guide.md` | End-user Claude Routines + Gists walkthrough |
| `assets/tray-icon.png` | System tray icon |
| `tsconfig.json` | TypeScript config — targets ES2020, outputs to `dist/` |
| `package.json` | Scripts (`build`, `start`, `package:*`), electron-builder config |
