# 👋 Welcome to DeNoti

DeNoti watches a data source and **automatically pops up this window whenever the content changes**. The rest of the time it sits quietly in your system tray.

You're seeing this welcome file because it's the default source on a fresh install. Here's how to make DeNoti your own.

---

## Choosing a Data Source

Open **Settings** (the ⚙ button in the top-right, or the tray menu) and pick one of two source types:

### 📁 Local File
Point DeNoti at any text or Markdown file on your computer. DeNoti checks the file on each poll and pops up when its contents change on disk.

- Click **Browse…** to choose a file, or paste a path directly.
- Great for reports written by another script, a synced cloud folder, or notes you update yourself.

### ☁️ GitHub Gist
Point DeNoti at a GitHub Gist by its ID. DeNoti polls the Gist and pops up when it's updated.

- **Gist ID** — the part after your username in the URL: `gist.github.com/you/`**`GIST_ID`**
- **Token** *(optional)* — a [personal access token](https://github.com/settings/tokens) with the `gist` scope. Required for private gists; also raises the API rate limit for public ones.

---

## Setting the Poll Interval

Drag the **Poll Interval** slider to control how often DeNoti checks for changes — anywhere from **1 minute** to **24 hours**. A shorter interval means faster pop-ups; a longer one is gentler on resources and API limits.

Click **Save & Start Polling** to apply your settings. DeNoti immediately checks the new source.

---

## Everyday Use

| Action | How |
|---|---|
| Show / hide the window | Left-click the tray icon |
| Check for updates right now | **⟳** button, or tray → **Poll Now** |
| Open settings | **⚙** button, or tray → **Settings** |
| Quit completely | Tray → **Quit DeNoti**, or ⌘Q / Ctrl-Q |

Closing the window just hides it to the tray — DeNoti keeps polling in the background and will reappear when there's something new.

---

## Tip: Pair It With Automated Reports

DeNoti was designed as a companion for scheduled reports. Have a cron job, a CI pipeline, or a Claude Code routine write its output to a Gist (or a local/synced file), then point DeNoti at it. Each time the report updates, DeNoti surfaces it for you — no inbox required.

For a full walkthrough — creating a Gist, generating a GitHub token, writing a Claude Code Routine that posts its output to that Gist, and wiring it all up in DeNoti — see **`assets/setup-guide.md`** in the application folder.

**Ready?** Open **Settings** and choose your source. 🚀
