# DeNoti — Architecture

## Overview

DeNoti is a three-layer Electron application. The **main process** owns all I/O (polling, file system, GitHub API, persistence). The **renderer** owns all UI. A **preload script** bridges them over a strictly-typed IPC channel.

```
┌─────────────────────────────────────────────────────────┐
│  Main Process (Node.js)                                 │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Poll Timers│  │ electron-store│  │  Tray / Menu  │  │
│  │  (per tab)  │  │  (JSON store) │  │               │  │
│  └──────┬──────┘  └──────────────┘  └───────────────┘  │
│         │ IPC: tab-content / tab-error / navigate       │
├─────────┼───────────────────────────────────────────────┤
│  Preload (contextBridge)                                │
│         │  exposes window.api                           │
├─────────┼───────────────────────────────────────────────┤
│  Renderer (Chromium)                                    │
│                                                         │
│  ┌──────┴──────┐  ┌─────────────┐  ┌───────────────┐  │
│  │  Tab bar    │  │ Content area│  │ Settings panel │  │
│  │  (dynamic)  │  │ marked/html │  │  (per-tab form)│  │
│  └─────────────┘  └─────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## File Structure

```
src/
  main/index.ts        Main process: polling, IPC handlers, tray, window
  preload/index.ts     contextBridge: exposes window.api to the renderer
renderer/
  index.html           All UI: tab bar, content view, settings view, JS
  styles.css           Dark-theme CSS (variables, markdown styles, tab bar)
  toast.html           macOS custom notification toast window (own styles + JS)
assets/
  welcome.md           Shown on first launch (default local-file tab)
  setup-guide.md       End-user guide: Claude Routines + Gists setup
  tray-icon.png        System tray icon
docs/
  architecture.md      This file
  index.md             Documentation index
dist/                  TypeScript compiler output (gitignored)
```

---

## Data Model

### Tab

Each monitored source is a `Tab`. Tabs are stored as an array in `electron-store`.

```typescript
interface Tab {
  id: string;                   // crypto.randomUUID()
  name: string;                 // display label shown in the tab bar
  sourceType: 'gist' | 'local';
  gistId: string;
  localFilePath: string;
  pollMode: 'interval' | 'time';
  pollIntervalMinutes: number;
  pollTime: string;             // "HH:MM" local time, used when pollMode === 'time'
  soundEnabled: boolean;        // play the notification sound on new content (default true)
}
```

### TabPollState

Change-detection metadata stored per tab. Kept separate from `Tab` so source settings can be updated without losing state unnecessarily.

```typescript
interface TabPollState {
  lastEtag: string;       // GitHub ETag header for 304-based caching
  lastUpdatedAt: string;  // Gist updated_at timestamp or file mtimeMs
}
```

### StoreSchema

```typescript
interface StoreSchema {
  tabs: Tab[];
  tabStates: Record<string, TabPollState>;  // keyed by Tab.id
}
```

Defaults: `{ tabs: [], tabStates: {} }`.

On first run (empty `tabs`), `initDefaultTabs()` either migrates old single-settings format or creates a Welcome tab pointing at `assets/welcome.md`.

---

## Polling System

Each tab has its own independent `setInterval` timer, held in:

```typescript
const pollTimers = new Map<string, NodeJS.Timeout>();
```

### Lifecycle

| Event | Action |
|---|---|
| App ready | `initDefaultTabs()` → `startAllPolling()` → `checkAllTabs()` on first load |
| Tab added | `startTabPolling(id)` + immediate `checkTabForUpdates(id)` |
| Tab source changed | State cleared → `startTabPolling(id)` + immediate check |
| Tab interval changed | `startTabPolling(id)` (timer restarted, state kept) |
| Tab deleted | Timer cleared, `tabStates[id]` deleted from store |

### Change detection

**Local file** — compares `fs.statSync(path).mtimeMs` against `lastUpdatedAt`. Re-reads content only when the mtime changes.

**GitHub Gist** — sends `If-None-Match: <lastEtag>` on every request. A `304 Not Modified` response is a no-op. On `200`, compares `gist.updated_at` against `lastUpdatedAt` as a second guard.

---

## Content Types

```typescript
type ContentType = 'markdown' | 'html';
```

`detectContentType(filename)` checks the file extension:
- `.html` / `.htm` → `'html'`
- everything else → `'markdown'`

Applied to:
- **Local files** — extension of the configured path
- **Gists** — if every file in the gist is `.html`/`.htm` the payload is `'html'`; otherwise `'markdown'`

The `contentType` field travels with every `tab-content` IPC payload. The renderer branches on it:

```javascript
contentArea.innerHTML = contentType === 'html' ? content : marked.parse(content);
```

---

## IPC Channels

All communication uses Electron's `ipcMain.handle` / `ipcRenderer.invoke` (request–response) and `webContents.send` / `ipcRenderer.on` (push events).

### Invocations (renderer → main)

| Channel | Payload | Returns | Description |
|---|---|---|---|
| `get-tabs` | — | `Tab[]` | Load all tabs from store |
| `set-tabs` | `Tab[]` | `{ success: true }` | Full replace; diffs against current to manage timers and state |
| `poll-now` | `tabId?: string` | `void` | Poll one tab or all if omitted |
| `pick-file` | — | `string \| null` | Opens native file-picker dialog |
| `confirm-delete-tab` | `name: string` | `boolean` | Native warning dialog; resolves `true` only if the user confirms deletion |
| `get-update-support` | — | `boolean` | Whether updates are supported here (packaged on any platform) |
| `check-for-updates` | — | `{ supported: boolean }` | Triggers an update check; progress arrives via `update-status` |
| `install-mac-update` | — | `{ success: boolean }` | macOS only: runs install script, quits app, relaunches updated version |
| `start-github-auth` | — | `{ started, userCode?, verificationUri?, message? }` | Begins the GitHub OAuth device flow, opens the browser, starts polling |
| `cancel-github-auth` | — | `void` | Stops the in-flight device-flow polling |
| `toast-dismiss` | — | `void` | macOS toast asks to hide itself (after auto-dismiss) |
| `toast-open-tab` | `tabId: string` | `void` | macOS toast click: restore main window and switch to that tab |

### Push events (main → renderer)

| Channel | Payload | Description |
|---|---|---|
| `tab-content` | `{ tabId, content, contentType, updatedAt, description, source }` | New content available for a tab |
| `tab-error` | `{ tabId, message }` | Polling error for a tab |
| `navigate` | `'settings'` | Tray menu asked to open settings |
| `update-status` | `{ status: 'available' \| 'none' \| 'downloaded' \| 'error', version?, message?, manual? }` | Auto-updater progress; `manual: true` on macOS `downloaded` means user must click Install & Restart |
| `github-auth-status` | `{ status: 'connected' \| 'error', username?, message? }` | GitHub device-flow result for the settings UI |
| `navigate-tab` | `tabId: string` | Switch the main window to a tab (from a clicked notification/toast) |
| `toast-show` | `{ tabId, name }` | Show the macOS custom toast for a tab update |

---

## Update Notifications

When a tab receives new content, `deliverContent` no longer force-shows the main window. Instead:

- **Main window visible** → nothing window-wise; the renderer dots the tab via `freshTabIds`.
- **Main window minimized or hidden to tray** → a notification titled with the tab name and body "File was updated". Clicking it restores the window and switches to that tab via `navigate-tab`.

The notification mechanism is platform-split (`notifyUpdate`):
- **Windows / Linux** → native OS notification (`Notification`), `silent` (the per-tab sound is played separately by the renderer). Works without code-signing.
- **macOS** → a custom frameless toast window (`renderer/toast.html`), because native macOS notifications require a code-signed app. It slides in bottom-right, auto-dismisses after ~4.5s, and is created only on darwin (`createToastWindow`).

Because the force-show was removed, the main window is now shown explicitly on launch (in `did-finish-load`).

---

## Renderer State

All state lives in the IIFE at the bottom of `renderer/index.html`. There is no framework.

```javascript
let tabs = [];           // Tab[] — canonical list, kept in sync with main via set-tabs
let activeTabId = null;  // string | null — which tab's content is displayed
const tabContents = {};  // { [tabId]: { content, contentType, updatedAt, description } }
const freshTabIds = new Set(); // tabs with content received since last viewed (dot indicator)
let editingTabId = null; // null = new-tab form, string = editing existing tab
let currentSource = 'gist'; // tracks the source-toggle state in the settings form
```

Key render functions:

| Function | What it does |
|---|---|
| `renderTabBar()` | Re-renders tab buttons; adds `.active` and `.has-update` classes |
| `setActiveTab(id)` | Sets `activeTabId`, clears `freshTabIds`, re-renders bar and content |
| `renderActiveContent()` | Writes to `#content-area` and `#status-bar` for the active tab |
| `showTabSettings(id \| null)` | Populates and opens the settings form; `null` = new-tab mode |
| `startInlineRename(id, btn, span)` | Replaces tab label with an `<input>`, commits on blur/Enter |

---

## Key Invariants

- **Only the latest content is kept per tab.** `tabContents[tabId]` is overwritten on every delivery; there is no history.
- **`set-tabs` is the single write path.** The renderer always sends the full updated array; the main process diffs it against the current store.
- **Timers are never leaked.** Every code path that removes or replaces a tab calls `clearInterval` before deleting the timer from the map.
- **The renderer never reads from the store directly.** All persistence goes through IPC.
