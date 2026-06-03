# Setting Up DeNoti with Claude Routines and GitHub Gists

This guide walks you through wiring a **Claude Code Routine** to a **GitHub Gist**, then pointing **DeNoti** at that Gist so each report surfaces automatically on your desktop.

---

## How It Works

```
Claude Code Routine (scheduled)
  └─ researches / generates a report
       └─ writes output to a GitHub Gist
            └─ DeNoti polls the Gist
                 └─ pops up on your desktop when the content changes
```

No inbox, no notifications to dismiss — DeNoti surfaces the report exactly when it's ready and not before.

---

## Prerequisites

- A **GitHub account**
- **Claude Code** installed (`npm install -g @anthropic/claude-code` or the desktop app)
- Access to **Claude.ai** for managing Routines

---

## Step 1 — Create a GitHub Gist

A Gist is a lightweight file hosting service from GitHub. Your routine will write its output here.

1. Go to [gist.github.com](https://gist.github.com)
2. Give the Gist a description (e.g. *Daily Market Briefing*)
3. Add a filename — use `.md` for a Markdown report or `.html` for an HTML report
4. Add any placeholder content, then click **Create public gist** (or secret if you prefer)
5. Copy the **Gist ID** from the URL: `gist.github.com/your-username/`**`GIST_ID`**

Keep this tab open — you'll need the Gist ID in the next steps.

---

## Step 2 — Set Up a Claude Code Routine

Claude Code Routines run scheduled agents in Anthropic's cloud. The agent will do the research and write its output to your Gist.

### Open the Routines panel

In Claude Code, type `/schedule` to open the scheduling assistant.

### Create the routine

When prompted, describe your task. A good routine prompt for a Gist-backed report includes five parts:

1. **What to research** — topics, symbols, sources, depth
2. **How to format the output** — Markdown headings, tables, bullet points, or raw HTML
3. **How to write to the Gist** — a PATCH request via `WebFetch` (shown below)
4. **Schedule** — daily, weekly, or a custom cron expression

### Gist PATCH snippet

Include this in your routine prompt as Step N — Deliver, replacing the placeholders:

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
        "report.md": { "content": "<full report text>" }
      }
    }
```

> Use `report.html` as the filename if your agent generates HTML — DeNoti will detect the extension and render it correctly.

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
                "files": {"briefing.md": {"content": "<full report>"}}}
```

### Schedule

Common cron expressions (all in UTC):

| Schedule | Expression |
|---|---|
| Every day at 8 am UTC | `0 8 * * *` |
| Weekdays at 7 am UTC | `0 7 * * 1-5` |
| Every Monday at 9 am UTC | `0 9 * * 1` |
| Every 6 hours | `0 */6 * * *` |

> The minimum interval for a Routine is 1 hour.

### Confirm and create

Review the summary Claude Code shows you, then confirm. Your routine is now live and will run on schedule. You can also trigger a test run immediately from the Routines panel at [claude.ai/code/routines](https://claude.ai/code/routines).

---

## Step 3 — Configure DeNoti

1. Open DeNoti and click **+** in the tab bar to add a new tab
2. Give the tab a name (e.g. *Daily Briefing*)
3. Select **GitHub Gist** as the data source
4. Paste your **Gist ID** into the Gist ID field
5. Set the **Poll Interval** to how often you want DeNoti to check — matching or slightly shorter than your routine's schedule works well (e.g. every 30 minutes for a daily routine)
6. Click **Save**

DeNoti immediately polls the Gist and will pop up as soon as new content is detected.

---

## Managing Multiple Reports

Each DeNoti tab is independent, so you can monitor several Gists at once:

- **One tab per Routine** — add a tab for each Claude Routine you run
- **Different poll intervals** — a fast-moving feed can poll every 5 minutes; a weekly report every few hours
- **Rename tabs** — double-click any tab to rename it inline

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| DeNoti shows *Gist not found* | Wrong Gist ID | Copy the ID from the Gist URL and re-enter it in tab settings |
| Routine runs but Gist doesn't update | Wrong Gist ID in the routine prompt | Edit the routine at claude.ai/code/routines and correct the Gist ID |
| Content looks like raw HTML tags | File extension is `.md` but content is HTML | Rename the Gist file to `.html` or adjust the routine prompt |
| DeNoti doesn't pop up | Poll interval is long | Click ⟳ to poll immediately, or shorten the interval in tab settings |
