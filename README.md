# DeNoti

A lightweight cross-platform desktop app that monitors a **GitHub Gist** or a **local file** and automatically pops up a window whenever new content is detected.

Supports **macOS**, **Linux**, and **Windows**.

---

## How It Works

DeNoti runs quietly in your system tray and polls your chosen source at a configurable interval. When the source changes, the app brings itself to the foreground and displays the new content — rendered as Markdown.

On first launch it shows a built-in welcome guide (`assets/welcome.md`) so you have something to see while you configure your own source.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm (bundled with Node.js)

### Install & Run

```bash
git clone https://github.com/joshuadamasio/DeNoti.git
cd DeNoti
npm install
npm start
```

On first launch the window opens automatically showing the welcome guide. After that, no window opens until new content is detected (or you click the tray icon).

---

## Configuration

Click the **⚙** button in the app header or open the tray menu → **Settings**, then choose a **Data Source**.

### Local File

| Setting | Description |
|---|---|
| **File Path** | Any text or Markdown file to watch. Click **Browse…** or paste a path. DeNoti pops up when the file's contents change on disk. |

This is the default source on a fresh install (pointed at the bundled welcome guide).

### GitHub Gist

| Setting | Description |
|---|---|
| **Gist ID** | The ID from your Gist URL: `gist.github.com/user/`**`GIST_ID`** |
| **GitHub Token** | Optional. Required for private Gists; also raises API rate limits for public ones. Create one at [github.com/settings/tokens](https://github.com/settings/tokens) with the `gist` scope. |

### Common

| Setting | Description |
|---|---|
| **Poll Interval** | How often to check for updates. Pick a preset (1 min, 5 min, 30 min, 1 hr, 6 hr) or choose **Custom…** to enter any number of minutes or hours. |

Click **Save & Start Polling** to apply. The app resets its cache and polls the new source immediately.

---

## System Tray

| Action | Result |
|---|---|
| **Left-click** tray icon | Toggle the window |
| **Right-click** tray icon | Open context menu |
| **Show DeNoti** | Bring the window to the front |
| **Poll Now** | Trigger an immediate check |
| **Settings** | Open the settings panel |
| **Quit DeNoti** | Exit the app completely |

Closing the window hides it to the tray — the app keeps running and polling in the background.

---

## Packaging for Distribution

Build a distributable for your platform:

```bash
npm run package:mac    # macOS → .dmg
npm run package:linux  # Linux → AppImage
npm run package:win    # Windows → .exe (NSIS installer)
```

Output is placed in the `release/` folder.

> Cross-compiling (e.g. building a Windows installer on macOS) requires additional tooling. See [electron-builder docs](https://www.electron.build/multi-platform-build) for details.

---

## Development

```bash
npm run build   # Compile TypeScript once
npm start       # Build + launch
```

Source layout:

```
src/
  main/index.ts       Main process: polling, tray, window management
  preload/index.ts    Context bridge between main and renderer
renderer/
  index.html          UI: content view + settings panel
  styles.css          Dark-theme styles
assets/
  tray-icon.png       Tray icon (replace to customise)
```

---

## Using DeNoti with Scheduled Briefings

DeNoti was built to display automated reports written to a GitHub Gist by a Claude Code scheduled routine. To wire them together:

1. Create a GitHub Gist (public or private) and note its ID.
2. In your Claude Code scheduled routine prompt, add a final step:
   ```
   Write the full briefing to GitHub Gist ID <YOUR_GIST_ID> using the GitHub API via Bash/curl,
   replacing the existing content of the file named "briefing.md".
   ```
3. Open DeNoti → Settings, paste the Gist ID, and set your poll interval.

Every time the routine runs and updates the Gist, DeNoti will pop up and display the new briefing.
