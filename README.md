# DeNoti

A lightweight cross-platform **De**sktop **Noti**fier application that monitors **GitHub Gists** and **local files** and automatically pops up whenever new content is received. It supports multiple sources and is easily combined with AI agents making it easy to automate your daily or weekly research habits and receive everything on your desktop!

No need to fiddle around hosting a local LLM, giving access to your machine, or setting up an MCP - just share a resource with your LLM (or friends) and this application will let you know when it gets updated.

Supports **macOS**, **Linux**, and **Windows**.

---

## How It Works

DeNoti runs quietly in your system tray and polls each configured source on its own schedule. When a source changes, the app pops up and displays the new content — rendered as Markdown or HTML. Close the window to send it back to the tray; it keeps polling in the background.

---

## Typical Workflow

DeNoti is most useful when combined with a scheduled AI agent. The general pattern is:

```
1. Create a shared output location
   └─ a GitHub Gist (URL-accessible, version-controlled)
   └─ or a Google Drive file (synced locally via Google Drive for Desktop)

2. Set up a scheduled agent (e.g. Claude Code Schedules)
   └─ give it a task: research, summarise, monitor, generate
   └─ instruct it to write its output to the Gist or Drive file when done

3. Add a DeNoti tab pointing at that location
   └─ set a poll interval that matches roughly how often the agent runs
   └─ DeNoti pops up automatically the moment new content is detected
```

The key insight is that DeNoti doesn't need access to your agent or its credentials — it only watches the output file. You can swap agents, change schedules, or update prompts without touching your DeNoti configuration.

---

## Setting Up with Claude Code Schedules and GitHub Gists

This is the simplest end-to-end setup: Claude Code Schedules writes reports to a GitHub Gist; DeNoti polls the Gist.

### Step 1 — Create a GitHub Gist

1. Go to [gist.github.com](https://gist.github.com)
2. Give the Gist a description (e.g. *Daily Market Briefing*)
3. Add a filename — use `.md` for Markdown or `.html` for HTML output
4. Add placeholder content, then click **Create public gist** (or secret if you prefer)
5. Copy the **Gist ID** from the URL: `gist.github.com/your-username/`**`GIST_ID`**

### Step 2 — Create a Claude Code Schedule

Claude Code Schedules run agents on a cron schedule in Anthropic's cloud. In Claude Code, type `/schedule` to open the scheduling assistant and describe your task.

A good prompt includes four parts:

1. **What to research or generate** — topic, sources, depth, format
2. **Output format** — Markdown headings, tables, bullet points; or raw HTML
3. **Write to the Gist** — provide the gist link to write to and the gist access token
4. **When to run** — when and how often this job should be run

### Step 3 — Configure DeNoti

1. Click **+** to add a new tab
2. Name it (e.g. *Daily Briefing*)
3. Select **GitHub Gist** as the data source
4. Paste your **Gist ID**
5. Set the **Poll Interval** to slightly shorter than your schedule (e.g. every 30 minutes for a daily schedule)
6. Click **Save**

DeNoti polls immediately and will pop up automatically whenever the Schedule updates the Gist.

---

## Setting Up with Claude Code Schedules and Google Drive

Use this approach if you prefer Google Drive as the output location. The agent writes to a Drive file; Google Drive for Desktop syncs it to your machine; DeNoti monitors the local synced path.

### Step 1 — Install Google Drive for Desktop

Download and install [Google Drive for Desktop](https://www.google.com/drive/download/). Sign in and let it complete its initial sync. Your Drive files will appear at a local path such as:

| Platform | Default path |
|---|---|
| macOS | `~/Library/CloudStorage/GoogleDrive-you@gmail.com/My Drive/` |
| Windows | `G:\My Drive\` |
| Linux | `~/GoogleDrive/My Drive/` *(path varies by distro and mount config)* |

### Step 2 — Create an Output File in Google Drive

1. Open [drive.google.com](https://drive.google.com)
2. Create a new folder for agent outputs (e.g. *Agent Reports*)
3. Create a new file inside it — a Google Doc, or upload a blank `report.md` or `report.html`

If you upload a `.md` or `.html` file (rather than a Google Doc), Drive for Desktop syncs it as a plain file that DeNoti can read directly. This is the recommended approach.

> Google Docs are stored as `.gdoc` stubs on disk and cannot be read as plain text by DeNoti. Use a plain `.md` or `.html` file instead.

### Step 3 — Create a Claude Code Schedule

In Claude Code, type `/schedule` and describe your task. Because Claude Code has access to the Google Drive MCP, your agent can write directly to Drive files without needing API credentials in the prompt.

Note: Inform the agent to always use the same file name if it needs to create a new file as DeNoti will always check by the name.

### Step 4 — Configure DeNoti

1. Open DeNoti and click **+** to add a new tab
2. Name the tab (e.g. *Weekly Summary*)
3. Select **Local File** as the data source
4. Click **Browse** or paste the full local path to the synced file, e.g.:
   - macOS: `~/Library/CloudStorage/GoogleDrive-you@gmail.com/My Drive/Agent Reports/report.md`
   - Windows: `G:\My Drive\Agent Reports\report.md`
5. Set the **Poll Interval** to a value shorter than your schedule (e.g. every 15 minutes for a daily schedule)
6. Click **Save**

DeNoti polls the local file and pops up as soon as Drive for Desktop syncs the new content.

---

## Installation

There are two ways to install DeNoti: download from the [Releases page](https://github.com/damasioj/DeNoti/releases), or run from source.

---

### Option A — Install from a distributable (recommended for most users)

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

---

## First-Time Setup

On first launch, DeNoti opens automatically and shows a built-in **Welcome** tab pointing at the bundled guide. Follow these steps to configure your own sources.

### Step 1 — Add a Tab

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

### Step 2 — Manage tabs

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
| **Poll on startup** | Check all sources immediately when the app launches. |
| **Poll on wake** | Check all sources when the machine wakes from sleep. |

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

**Build your own distributables:**

```bash
npm run package           # all platforms in one go (see note below)
npm run package:mac       # macOS only   → release/*.dmg, *.zip
npm run package:linux     # Linux only   → release/*.AppImage, *.deb
npm run package:win       # Windows only → release/*.exe
```

Artefacts land in the `release/` folder, named `DeNoti-{version}-{os}-{arch}.{ext}`.

> **Cross-platform builds:** running `npm run package` on macOS produces Mac and Linux artefacts natively, but Windows builds require [Wine](https://www.winehq.org/) or a Windows host. Building for macOS on Linux/Windows is not supported by electron-builder.
