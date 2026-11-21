---
name: openspec-dashboard
description: Starts, sets up and explains the OpenSpec dashboard - a live local web page for the progress of OpenSpec changes (board, roadmap, backlog, charts, git history) with optional Claude Code features (chat, sessions on tickets, onboarding projects, joining and writing to sessions running in a terminal). Use when the user wants to see or follow the progress of OpenSpec work, start or stop the dashboard, add or onboard projects, install it as an app, connect a running Claude Code session to it, or when something in it does not work.
---

# OpenSpec dashboard

A zero-dependency Node script (`tools/openspec-dashboard/server.mjs`, Node 20 or newer) and one HTML page. It reads
each project's `openspec/` folder (roadmap, backlog, changes, archive), updates the page within a second of every
file change and never changes a project unless the user asks for it in the page. Find the tool in this repository
(`tools/openspec-dashboard/`) or ask the user where their copy is; below, `<dash>` stands for that folder.

## Start it

| Goal | Command |
|---|---|
| The project in the current folder | `node <dash>/server.mjs` |
| Several projects, with an overview | `node <dash>/server.mjs ~/code/app ~/code/api` |
| Every project below a folder | `node <dash>/server.mjs --scan=~/code` |
| With the Claude Code features | add `--agent` (needs the `claude` command and its login) |

Useful options: `--port=4590` (the default), `--cli=<command>` for the OpenSpec CLI if `openspec` is not on the PATH
(`--no-cli` without it), `--no-open` to not open the browser, `--host=127.0.0.1` (keep it local). It opens
`http://127.0.0.1:<port>/`. Before starting, check whether one already runs:
`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4590/api/projects` (200: it runs; open it instead).
Run it in the background (`nohup … &`) so the session can go on; stop it with its process.

**As an app** (macOS: Launchpad and Dock; Linux: application menu), opening in a window of its own:
`node <dash>/launcher.mjs install -- <the server options>` (`--port=`, `--name=`, `--tab` for a browser tab).
`launcher.mjs stop` ends a dashboard it started, `launcher.mjs uninstall` removes the app. Run `install` again
after changing the options. For an icon of its own in the Dock, the user installs the page as a web app (Chrome:
Install in the address bar; Safari: File › Add to Dock); add `--service` to `install` so the dashboard runs from
login on and the pinned web app always finds it (macOS LaunchAgent, Linux systemd user service).

## With `--agent`

Everything runs the user's local Claude Code (`claude -p`, their subscription), only on 127.0.0.1, and every
action needs a per-start token that only the served page knows. Tell the user before the first session:

- A started session cannot answer permission prompts: the workflow's commands (the quality gate, `openspec`,
  `git add`/`git commit`) must be allowed in the project's `.claude/settings.json`.
- Claude Code ignores a project's permission rules until the folder is trusted: run `claude` there once and
  accept the trust dialog (a trusted parent folder does not count).

What it adds: a chat about the project (read-only), sessions on tickets, new tickets and ideas, onboarding of
folders with a `CLAUDE.md`/`AGENTS.md` (overview › Onboard more projects), new projects from a brainstorm (with an
expert mode for quality gates, docs, diagrams, containers, branches, version control and license), and the
**terminal sessions** button (`>_`): every running Claude Code session, followed live; in macOS Terminal the
dashboard can type messages into it (no setup); elsewhere it needs the hook:
`node <dash>/agent-hook.mjs install <project>` (then restart that session). Messages from the dashboard reach a
session in fixed forms; the ticket workflow skill explains them (`openspec-ticket-workflow`,
`references/dashboard-messages.md`).

Optional local models (Podman or Docker): speech-to-text (a whisper.cpp image) and rephrasing (a container with an
LLM, or an OpenAI-compatible URL); the page's ⚙ Settings (in the ☰ menu) picks them.

## What it expects in a project

The formats of the ticket workflow (`openspec-ticket-workflow` skill, `references/templates.md`): `tasks.md` with
check boxes and `verify:` criteria, `openspec/roadmap.md` with ordered rows and milestones, drafts in
`openspec/backlog/`, an optional parking-lot change. Without a roadmap it still shows the changes and their tasks.

## Where its state lives

Outside the projects, in `$XDG_STATE_HOME/openspec-dashboard/` (default `~/.local/state/openspec-dashboard/`): the
recorded history per project, `settings.json` (local models, the file manager for the folder button), the
discovery list and onboarded projects (`discovery.json`), archived and unfollowed projects (`projects.json`), the
hook's inbox, and attachments of new-project brainstorms. Browser-side choices (style, theme, chat size, the
write-mode look, the background list) are kept in the browser.

## When something does not work

- **The port is taken**: another dashboard (check `/api/projects`) or another program; pick `--port=`.
- **"openspec CLI error" in the header**: the CLI is missing or fails; pass `--cli=<command>` or `--no-cli`.
- **A project is missing**: it needs an `openspec/` folder; `--scan` looks three levels deep. Archived or unfollowed
  projects are listed below the overview.
- **No Chat / no terminal button**: start with `--agent`; the `claude` command must be on the PATH (or
  `--claude=<command>`).
- **A terminal session is not listed**: it must still run; sessions are found in `~/.claude/sessions` and their
  transcripts in `~/.claude/projects`.
- **Writing to a session does nothing**: in macOS Terminal, macOS may ask once whether the dashboard may control
  Terminal; elsewhere set up the hook and restart the session. While the session asks something (a permission, a
  choice), the dashboard does not type, since Return would answer it.
- **Details**: the user guide (`docs/user-guide.md`) and `<dash>/README.md` cover every feature and endpoint.
