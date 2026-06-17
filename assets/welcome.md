# 👋 Welcome to DeNoti

DeNoti watches a data source and **automatically surfaces this window whenever the content changes**. The rest of the time it sits quietly in your system tray — no inbox, no noise.

---

## 🚀 Getting Started

### 1. 🔗 Connect GitHub

Click the **⚙** icon in the top-right to open Global Settings, then click **Connect GitHub**. Authorize in your browser — no token to copy or paste. You only need to do this once.

### 2. 🤖 Have your LLM create a Gist

Ask your LLM to create a GitHub Gist and set up a schedule or routine to write output to it periodically. Your prompt could be as simple as:

*"Create a private GitHub Gist called daily-briefing.md, then set up a daily routine that researches [your topic] and updates that Gist with a summary."*

Prefer to create the Gist yourself? Click **+**, name the tab, leave **Create a new Gist** toggled on, and click **Save**. DeNoti creates the Gist and shows you the URL to hand to your LLM.

### 3. 📥 Import the Gist into DeNoti

Go to **⚙ → Import Gists from GitHub**. DeNoti lists all your Gists, skipping any already tracked. Select the one your LLM created and click **Add Selected**.

DeNoti starts polling immediately — when the LLM writes new content, the tab lights up and a notification appears. ✨

---

## 📂 Data Sources

| Source | When to use |
|---|---|
| ☁️ **GitHub Gist** | Default. Connect GitHub and import, or paste a Gist ID manually. |
| 📁 **Local File** | Click **+**, switch to **Local File**, and pick any `.md`, `.html`, or `.txt` file. |

> **Tip:** Clicking any local file link inside a tab opens it as a new DeNoti tab automatically.

---

## 🖥️ Everyday Use

| Action | How |
|---|---|
| Show / hide the window | Left-click the tray icon |
| Check for updates right now | **⟳** button, or tray → poll |
| Open settings | **⚙** button |
| Rename a tab | Double-click the tab label |
| Quit completely | Tray → **Quit DeNoti** |

Closing the window hides it to the tray — DeNoti keeps polling in the background.

---

📖 For the full setup walkthrough, see the [Setup Guide](setup-guide.md).
