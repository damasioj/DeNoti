# DeNoti — Claude Code Instructions

## Before Making Changes

Read these two documents first — they describe what exists and why:

- **[docs/architecture.md](docs/architecture.md)** — process model, data model, IPC channels, polling system, renderer state, key invariants
- **[docs/index.md](docs/index.md)** — map of every source file and documentation page

## Key Invariants to Preserve

- **`set-tabs` is the single write path.** The renderer always sends the full updated `Tab[]`; the main process diffs it. Never add a separate "update one tab" channel.
- **Only latest content is kept per tab.** `tabContents[tabId]` is overwritten on each delivery. Do not accumulate history unless explicitly asked.
- **Timers are never leaked.** Any code path that removes or replaces a tab must call `clearInterval` and delete the entry from `pollTimers`.
- **The renderer has no direct store access.** All reads and writes go through IPC.
- **Content type travels with the payload.** `tab-content` always includes `contentType: 'markdown' | 'html'`. Do not hardcode `marked.parse()` in new render paths.

## Architecture Summary

Three layers:

1. **`src/main/index.ts`** — Node.js main process. Owns polling (`Map<id, NodeJS.Timeout>`), `electron-store` persistence, tray, window, and all IPC handlers.
2. **`src/preload/index.ts`** — `contextBridge` only. Thin pass-through; no logic.
3. **`renderer/index.html` + `renderer/styles.css`** — Chromium renderer. Vanilla JS IIFE, no framework. State: `tabs`, `activeTabId`, `tabContents`, `freshTabIds`, `editingTabId`.

IPC push events from main: `tab-content`, `tab-error`, `navigate`.  
IPC invocations from renderer: `get-tabs`, `set-tabs`, `poll-now`, `pick-file`.

## When to Update the Docs

- **`docs/architecture.md`** — update when adding/removing IPC channels, changing the data model (`Tab`, `TabPollState`, `StoreSchema`), or altering the polling lifecycle.
- **`docs/index.md`** — update when adding or removing source files or documentation pages.
- **`assets/welcome.md`** / **`assets/setup-guide.md`** — update when the UI or setup flow changes in a user-visible way.

## Build

```bash
npm run build   # tsc only
npm start       # build + launch (opens DevTools in non-packaged mode)
```

Always run `npm run build` after editing TypeScript to confirm the changes compile cleanly before committing.
