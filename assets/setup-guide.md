# Setting Up DeNoti with Claude Routines and GitHub Gists

This guide walks you through the recommended end-to-end flow: connect GitHub, have your LLM create and manage a Gist, then import it into DeNoti so updates appear on your desktop automatically.

---

## How It Works

```
Your LLM creates a Gist and writes to it on a schedule
  └─ DeNoti imports the Gist as a tab
       └─ DeNoti polls the Gist
            └─ new content appears on your desktop when it changes
```

No inbox, no notifications to dismiss — DeNoti surfaces the report exactly when it's ready.

---

## Prerequisites

- A **GitHub account**
- **Claude Code** installed (`npm install -g @anthropic/claude-code` or the desktop app)

---

## Step 1 — Connect DeNoti with GitHub

1. Open DeNoti and click the **⚙** icon (top-right) to open Global Settings
2. Click **Connect GitHub** — your browser will open to `github.com/login/device`
3. Enter the code shown in DeNoti and click **Authorize**
4. DeNoti shows ✓ Connected when the flow completes
5. Click **Save** and return to the main view

> You only need to do this once. The token is stored securely on your machine.

---

## Step 2 — Have Your LLM Create a Gist

Ask your LLM (e.g. a Claude Code Routine or an interactive session) to create a GitHub Gist for you. A simple prompt:

```
Create a new private GitHub Gist called "daily-briefing.md" with placeholder content.
Return the Gist ID and URL when done.
```

The LLM will use the GitHub API to create the Gist and give you its URL. Keep that URL handy.

> **Alternatively**, if you prefer to create the Gist yourself inside DeNoti: click **+** in the tab bar, name the tab, make sure **Create a new Gist** is toggled on, and click **Save**. DeNoti creates the Gist and shows you the URL. Skip to Step 4.

---

## Step 3 — Set Up a Schedule or Routine with Your LLM

Create a recurring routine that researches a topic and writes the output to the Gist. In Claude Code, type `/schedule` to open the scheduling assistant, then describe the task. A good prompt includes:

1. **What to research** — topics, symbols, sources, depth
2. **How to format the output** — Markdown headings, tables, bullet points, or raw HTML
3. **The Gist to update** — paste the URL or ID from Step 2
4. **Schedule** — daily, weekly, or a custom cron expression

### Gist PATCH snippet

Include this in your routine prompt as the final delivery step:

```
Use WebFetch to PATCH the Gist with your report:
- URL: https://api.github.com/gists/YOUR_GIST_ID
- Method: PATCH
- Headers:
    Authorization: Bearer YOUR_GITHUB_TOKEN
    Content-Type: application/json
    Accept: application/vnd.github+json
- Body (JSON):
    {
      "description": "Report title – [TODAY'S DATE]",
      "files": {
        "daily-briefing.md": { "content": "<full report text>" }
      }
    }
```

> Use `report.html` as the filename if your agent generates HTML — DeNoti detects the extension and renders it correctly.
> Your GitHub token is shown in Global Settings (the same one used to connect DeNoti).

### Example full prompt

```
You are a research agent. Follow these steps:

**Step 1 — Research**
Search the web for the latest news on [your topic]. Summarise the
top 5 developments with source URLs and a 2–3 sentence description each.

**Step 2 — Deliver**
Post the full report to the GitHub Gist by making a PATCH request via WebFetch:
- URL: https://api.github.com/gists/YOUR_GIST_ID
- Method: PATCH
- Headers: Authorization: Bearer YOUR_GITHUB_TOKEN,
           Content-Type: application/json,
           Accept: application/vnd.github+json
- Body (JSON): {"description": "Daily Briefing – [TODAY'S DATE]",
                "files": {"daily-briefing.md": {"content": "<full report>"}}}
```

### Common cron schedules

| Schedule | Expression |
|---|---|
| Every day at 8 am UTC | `0 8 * * *` |
| Weekdays at 7 am UTC | `0 7 * * 1-5` |
| Every Monday at 9 am UTC | `0 9 * * 1` |
| Every 6 hours | `0 */6 * * *` |

> The minimum interval for a Routine is 1 hour.

---

## Step 4 — Import the Gist into DeNoti

1. Click **+** in the tab bar
2. Click **↓ Import from GitHub**
3. DeNoti fetches all your Gists and shows a checklist — already-tracked Gists are excluded automatically
4. Select the Gist your LLM created, then click **Add Selected**

DeNoti adds the tab, starts polling, and will notify you the moment new content arrives.

---

## You're Done

When the Routine runs, it writes to the Gist. DeNoti detects the change and the tab lights up. If the window is hidden, a notification appears.

Adjust the **Poll Interval** in tab settings to roughly match your Routine's schedule — every 30 minutes works well for a daily routine.

---

## Managing Multiple Reports

- **One tab per Routine** — add a tab for each Claude Routine you run
- **Different poll intervals** — a fast-moving feed can poll every 5 minutes; a weekly report every few hours
- **Rename tabs** — double-click any tab to rename it inline
- **Bulk import** — use **↓ Import from GitHub** any time to add more Gists in one go

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| *Create a new Gist* toggle is disabled | Not connected to GitHub | Connect in Global Settings (Step 1) |
| Gist doesn't appear in the import list | Already tracked as a tab | DeNoti skips duplicates automatically |
| DeNoti shows *Gist not found* | Wrong Gist ID | Copy the ID from the Gist URL and re-enter it in tab settings |
| DeNoti shows *Unauthorized* | Invalid or expired token | Reconnect GitHub in Global Settings |
| Routine runs but Gist doesn't update | Wrong Gist ID or token in the routine prompt | Edit the routine and correct the values |
| Content looks like raw HTML tags | File extension is `.md` but content is HTML | Rename the Gist file to `.html` or adjust the routine prompt |
| DeNoti doesn't pop up | Poll interval is long | Click ⟳ to poll immediately, or shorten the interval in tab settings |
