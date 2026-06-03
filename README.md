# DeNoti

A lightweight cross-platform **Desk**top **Noti**fier application that monitors **GitHub Gists** and **local files** and automatically pops up whenever new content is received. It supports multiple sources and is easily combined with AI agents making it easy to automate your daily or weekly research habits and receive everything on your desktop!

Supports **macOS**, **Linux**, and **Windows**.

---

## How It Works

DeNoti runs quietly in your system tray and polls each configured source on its own schedule. When a source changes, the app brings itself to the foreground and displays the new content — rendered as Markdown or HTML. Close the window to send it back to the tray; it keeps polling in the background.

---

## Installation

There are two ways to install DeNoti: download a pre-built distributable, or run from source. Choose the one that fits your situation.

---

### Option A — Install from a distributable (recommended for most users)

No Node.js or build tools required.

1. Go to the [Releases](https://github.com/joshuadamasio/DeNoti/releases) page and download the file for your platform:

   | Platform | File |
   |---|---|
   | macOS | `.dmg` |
   | Linux | `.AppImage` |
   | Windows | `.exe` (NSIS installer) |

2. **macOS** — Open the `.dmg`, drag **DeNoti** to your Applications folder, then double-click to launch. If macOS blocks the app on first open (Gatekeeper), go to **System Settings → Privacy & Security** and click **Open Anyway**.

3. **Linux** — Make the AppImage executable, then run it:
   ```bash
   chmod +x DeNoti-*.AppImage
   ./DeNoti-*.AppImage
   ```

4. **Windows** — Run the `.exe` installer and follow the prompts. DeNoti will launch automatically when the installer finishes.

---

### Option B — Run from source (for developers)

**Prerequisites:** [Node.js](https://nodejs.org/) v18 or later (includes npm), Git.

```bash
git clone https://github.com/joshuadamasio/DeNoti.git
cd DeNoti
npm install
npm start
```

`npm start` compiles the TypeScript and launches Electron. DevTools open automatically in a detached window.

**Build your own distributables:**

```bash
npm run package           # all platforms in one go (see note below)
npm run package:mac       # macOS only   → release/*.dmg, *.zip
npm run package:linux     # Linux only   → release/*.AppImage, *.deb
npm run package:win       # Windows only → release/*.exe
```

Artefacts land in the `release/` folder, named `DeNoti-{version}-{os}-{arch}.{ext}`.

> **Cross-platform builds:** running `npm run package` on macOS produces Mac and Linux artefacts natively, but Windows builds require [Wine](https://www.winehq.org/) or a Windows host. Building for macOS on Linux/Windows is not supported by electron-builder. For fully automated multi-platform releases, use a CI service (e.g. GitHub Actions) with separate runners per OS.

---

## Using DeNoti with Claude Code Routines

DeNoti pairs naturally with [Claude Code Routines](https://claude.ai/code/routines) — scheduled cloud agents that research a topic and write their output to a GitHub Gist. DeNoti polls the Gist and surfaces the report the moment it's updated.

See **[assets/setup-guide.md](assets/setup-guide.md)** for a complete walkthrough: creating the Gist, generating a token, writing the Routine prompt, and wiring it all up in DeNoti.

---

## First-Time Setup

On first launch, DeNoti opens automatically and shows a built-in **Welcome** tab pointing at the bundled guide. Follow these steps to configure your own sources.

### Step 1 — Set a GitHub Token (optional but recommended)

If you plan to monitor any GitHub Gists, add your token first so all Gist tabs can use it.

1. Click the **⚙** button in the top-right corner to open **Global Settings**
2. Paste a [GitHub Personal Access Token](https://github.com/settings/tokens) with the **`gist`** scope
3. Click **Save**

A token is required for private Gists and raises the API rate limit for public ones. You can skip this step if you only need to monitor local files.

### Step 2 — Add a Tab

1. Click **+** in the tab bar to open the **New Tab** form
2. Give the tab a name (e.g. *Daily Briefing*)
3. Choose a **Data Source**:
   - **Local File** — browse to or paste the path of any `.md`, `.html`, or `.txt` file
   - **GitHub Gist** — paste the Gist ID from the URL: `gist.github.com/user/`**`GIST_ID`**
4. Choose a **Poll Schedule**:
   - **Interval** — check every N minutes or hours
   - **Daily at time** — check once per day at a specific local time
5. Click **Save**

DeNoti immediately checks the new source and pops up if there is content.

### Step 3 — Manage tabs

| Action | How |
|---|---|
| Switch tabs | Click the tab button |
| Rename a tab | Double-click the tab label |
| Edit tab settings | Click **✎** in the tab bar (or click the tab first, then **✎**) |
| Delete a tab | Click **✕** in the tab bar |
| Add another tab | Click **+** in the tab bar |

---

## Configuration Reference

### Global Settings (⚙ button)

| Setting | Description |
|---|---|
| **GitHub Token** | Personal Access Token with `gist` scope. Shared by all Gist tabs. |

### Tab Settings (✎ button)

| Setting | Description |
|---|---|
| **Tab Name** | Label shown in the tab bar. Double-click the tab to rename inline. |
| **Data Source** | Local File or GitHub Gist. |
| **File Path** | Path to a local `.md`, `.html`, or `.txt` file. |
| **Gist ID** | The ID segment from your Gist URL. |
| **Poll Schedule** | Interval (every N minutes/hours) or Daily at a specific local time. |

### Content rendering

| File type | How it's rendered |
|---|---|
| `.md`, `.markdown`, `.txt` | Parsed as Markdown |
| `.html`, `.htm` | Rendered as HTML |

---

## System Tray

| Action | Result |
|---|---|
| **Left-click** icon | Toggle the window |
| **Show DeNoti** | Bring the window to the front |
| **Settings** | Open Global Settings |
| **Poll: Tab Name** | Trigger an immediate check for that tab |
| **Poll All** | Trigger an immediate check for all tabs |
| **Quit DeNoti** | Exit the app completely |

---

## Development

```bash
npm run build   # Compile TypeScript once (output → dist/)
npm start       # Build + launch with DevTools
```

See [docs/architecture.md](docs/architecture.md) for the full technical reference: process model, data model, IPC channels, polling lifecycle, and key invariants.