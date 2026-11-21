# OpenSpec dashboard

A live, local dashboard for following the progress of OpenSpec changes while an agent (or a team) works through
them, e.g. with the [ticket workflow](../../README.md). No dependencies, no build step, no install: one Node
script and one HTML page. Needs Node 20 or newer.

```sh
cd <your project>                                   # the folder that contains openspec/
node <path-to>/tools/openspec-dashboard/server.mjs  # opens http://127.0.0.1:4590/
```

**As an app:** `node launcher.mjs install [--name=…] [--port=4590] [--tab] [--service] [--no-app] -- <server options>` creates a
launcher with the logo (`logo.svg`, and `logo-1024.png` for the macOS icon): on macOS `~/Applications/<name>.app`
(an `Info.plist`, an `.icns` made with `sips` and `iconutil`, and a start script), on Linux a `.desktop` entry in
`~/.local/share/applications`. The start script checks `http://localhost:<port>/api/projects`; if nothing answers,
it starts `server.mjs` with the options in the folder `install` ran in (with that Node.js, by its stable path, and
that PATH, since an app from the Dock has no shell), logs to `~/Library/Logs/<name>.log` (macOS) or the state
folder, waits until it answers and opens the page in a window of its own (Chrome, Edge, Brave or Chromium with
`--app=`, found at install time), or with `--tab` (or without such a browser) in a tab of the default browser;
once the page is installed as a web app (`/manifest.webmanifest`, `icon-192.png`, `icon-512.png`; Chrome puts it
into `~/Applications/Chrome Apps.localized/`), it opens that app, which has its own icon in the Dock.
`--service --no-app` installs only the service and removes the launcher app (with the web app installed, it is not
needed). `--service` runs the dashboard from login on: a LaunchAgent (`~/Library/LaunchAgents/local.openspec-dashboard.<name>-<port>.plist`,
`RunAtLoad`, `KeepAlive`; it starts Node.js through a link named after the app (`<state>/bin/<name>`), and names
the launcher app, if there is one, in `AssociatedBundleIdentifiers`, so Activity Monitor and the login items show the dashboard's name instead of
"node") or a systemd user unit (`~/.config/systemd/user/<name>-<port>.service`). `launcher.mjs stop` ends a dashboard it started (its pid is in the state folder), `uninstall`
removes the launcher. The logo is also the page's icon and sits in the header (`GET /logo.svg`).

## Several projects

One dashboard can follow several projects. Name them, or let it find every folder with an `openspec/` folder up to
three levels below a directory:

```sh
node server.mjs ~/code/shop ~/code/blog            # or --project=<dir>, repeatable
node server.mjs --scan=~/code                       # every project below ~/code
```

With more than one project, the start page is an overview: one card per project with the change being worked on,
its current task and progress, the status mix, the current milestone, validation problems and the last activity,
most recently active first and updated live. A card (or the project picker in the header) opens that project's
dashboard; `?project=<id>` in the address links to it directly. Each project keeps its own history, and OpenSpec
CLI calls for all projects run one at a time. Projects with the same folder name (followed, archived or unfollowed)
are labelled with the shortest end of their path that tells them apart (`examples/todo-app`, `acme/todo-app`) on the
cards, in the picker, the title and the history panel; candidates to onboard likewise (also against followed
projects), in the list, the chat and the progress dialog.

**Daily digest** (overview, below the cards): `GET /api/digest?days=1|7` computes per followed project, from the
charts' timeline (`git log` of `openspec/` merged with the recorded history), the window since the start of the
previous working day (Monday: Friday) or the last 7 days: tasks checked (per change), changes that reached
in-progress, complete or archived, new ones, `git rev-list --count --since` commits; stuck ones (in progress with no
check, status change or file write for 2 days; complete but not archived for a day; failing validation) and the next
change and task. `POST /api/digest?days=` (with `--agent`, token) runs `claude -p --tools ''` with that JSON as the
only input for a briefing of at most six sentences, kept in `digest.json` in the state folder until the window
changes. The page asks for the digest at most once a minute and remembers the period (`osd-digest-days`).

**What a followed project costs.** A watcher on `openspec/` plus a re-read every 5 s; the workspace scan (the
modification time of every file, up to 40,000, without `node_modules`, `.git` and the like, for "files written
lately") every 10 s while the project is open in a browser, every 2 minutes otherwise, and never more often than 20
times as long as its last scan took; `openspec validate` only when `openspec/` changed (checked every 60 s), one
container run each with a containerised CLI; `git log` only for the charts and the history, cached per commit; with
`--agent` the inbox for sessions in other terminals every 10 s. An onboarding is one Claude Code run; no Claude
process stays after it.

**Archive and unfollow** (with `--agent`). Each card has **Archive** and **Unfollow** (shown on hover). Both stop
everything above for that project (watchers, scans, validation, the inbox; idle chats end and can be resumed) and
are remembered in `projects.json` in the state folder, also for projects given with `--project` or `--scan`. An
archived project stays on the overview in a folded **Archived** section with the status it had and **Reactivate**;
an unfollowed one is listed there by name with **Follow again**, **Archive** (moves it to the archived ones) and ✕
(removes it from the list). A project followed again keeps its id, so its links stay the same. The project's files
are not touched. One project always stays followed, and a project with a running session or onboarding cannot be
put aside. A page of a project that is no longer followed shows the overview. `POST /api/project` with `action`
`archive`, `unfollow` (and `project`), `reactivate`, `follow` or `forget` (and `root`).

## Onboarding more projects (with `--agent`)

Below the project cards, the overview has **Onboard more projects**: enter a folder (e.g. `~/workspace`) and
**Discover** lists every folder below it, up to four levels deep, with a `CLAUDE.md`, `AGENTS.md`, `AGENT.md` or
`.claude/CLAUDE.md`: projects an agent already works in, which the dashboard does not follow yet. Each one shows its
markers, the first line of its README, and when it was last committed; the most recently active come first.

- **Onboard** starts Claude Code in that folder in the background. It reads the project and the
  `openspec-ticket-workflow` skill, sets up `openspec/` (config with the quality gate, specs for what clearly
  exists, a roadmap with a first milestone and backlog drafts) and commits nothing. It may write files and run the
  OpenSpec CLI, `git status`/`git log`, `ls` and `mkdir`, nothing else. When it is done, the project is followed:
  it appears in the overview and in the project picker. Claude first writes its plan with its task tools
  (`TaskCreate`/`TaskUpdate`, `TodoWrite` in older versions) and keeps it current; the server records it, so
  **Show progress** (while it runs; **What it did** afterwards) opens a dialog with the plan (done, now, open, a
  progress bar), the elapsed time, every step so far and, at the end, Claude's summary, live.
- **Chat about it** opens a read-only conversation about the project: what it is, whether it is still developed,
  whether it has a build and tests, and whether the ticket workflow pays off. Claude ends with a recommendation;
  you decide with **Onboard it** (the onboarding continues that conversation, so it knows what you agreed) or
  **Skip → next candidate**.
- **Skip** hides a candidate; **show skipped** brings them back. A folder that has `openspec/` already gets
  **Follow** instead.

**＋ Start a new project** brainstorms a project that does not exist yet, full screen (**⤡ Restore** or `Esc` makes it
a side panel; remembered). Pick the parent folder (e.g. `~/code`) and
describe the idea: Claude asks about the problem and the users, the scope of a first version and what is out, the
stack and the quality gate, and proposes a first milestone of tickets (the first sets up the skeleton, the second is
the first vertical slice). It works read-only in the parent folder. Once you agree, it shows the project as a card;
**Create project…** asks for the folder name, creates the folder, runs `git init` and starts the same background
setup as an onboarding, with the agreed brief: `CLAUDE.md`, `README.md`, `openspec/` with the roadmap and a backlog
draft per ticket, no application code, nothing committed. When it is done the project is followed like an
onboarded one.

**📎 Attach** (or dropping files on the panel) sends up to 5 files of 10 MB with a message of the brainstorm. The
server keeps them in `$XDG_STATE_HOME/openspec-dashboard/attachments/` (not in the project), names their paths in the
message (the chat shows a 📎 chip with the names) and lets Claude read that folder (`--add-dir`); **Create** lists
them in the brief as "Attached files", and the setup reads them from there.

With expert mode, **Create** also takes the version control (no `git init` with "No version control"), the license
(the setup writes `LICENSE` with its text and the SPDX identifier in the README) and the hosting (noted in
CLAUDE.md, the brief's "Repository" section). The setup never creates a remote or pushes; for GitHub, the new
project's panel offers **Create it on GitHub** afterwards: `gh repo create <name> --private|--public --source .
--remote origin` (needs the GitHub CLI, signed in; a public repository asks first; nothing is pushed). For GitLab and
other platforms it shows what to run.

**⚙ Expert mode** in that panel sets the workflow the project starts with: quality gates, what every task is
checked for, what every change is reviewed for, the workflow steps, the documentation to keep, the diagram format
(Mermaid, PlantUML or both; one choice), the branches (everything on main, a branch per ticket or per milestone,
merged when it is done; one choice) and the diagram types to draw (C4 context and containers, sequence, ER,
state, deployment, …), the container engine (Podman, Docker or none; one choice), how tools
and services are run, version control (git local only, on GitHub, GitLab or another platform, or none; one choice),
the repository's visibility (private or public; only with a platform) and the license (none yet, MIT, Apache-2.0,
BSD-3-Clause, MPL-2.0, GPL-3.0-or-later, AGPL-3.0-or-later or proprietary), as toggle chips with defaults and your own entries (remembered in the browser). With "Check
local containers and images for services to reuse" on, the server adds the list of local containers and images
(`ps -a` and `images` of the chosen engine; nothing is started) to the message, so Claude suggests reusing e.g. a
running database instead of installing one; the chat shows it as a 📦 chip with the list as its tooltip, and
**Create** puts it into the brief as "Local containers" (the setup reuses what was chosen, without copying the list). Once the choices went with a
message, the panel folds into one line (**Show** opens it again), so the brainstorm keeps its room. They are sent to the brainstorm with the next message when they change, and
with **Create** as the brief's "Workflow" section; the setup makes them binding in `openspec/config.yaml` (quality
gate, task rules, review rules, ticket workflow) and CLAUDE.md, and the first ticket sets up the chosen gates.

The folder, the skipped candidates and the projects added this way are remembered
(`$XDG_STATE_HOME/openspec-dashboard/discovery.json`), so added projects are followed again after a restart. With
`--agent` the overview is reachable from the project picker (**All projects**) also when only one project is
followed (`?overview` in the address).

## What it shows

- **Current change**: the change being worked on (tasks in progress), otherwise the one waiting to be archived,
  otherwise the next one the roadmap allows. Its progress per task group, the current task with its `verify:`
  criterion, when the last task was checked off and when a project file was last written. Tabs for tasks,
  proposal, design, spec deltas and `openspec validate` issues.
- **Milestone and activity**: the milestone of that change with its other changes, and a feed of checked-off
  tasks and status changes, with a chart of tasks done over time.
- **Board**: all changes in six columns derived from the files, filterable by milestone. **⤢ Full screen**
  (or `#board` in the address) shows only the board, still live; clicking a card opens its details in a side
  panel (`#board:<change>` links to it directly), `Esc` closes it. **○ Focus** hides the archived changes and
  folds empty columns into narrow strips, so the open work gets the space.
- **Backlog**: the roadmap as a list per milestone, like the backlog of an issue tracker, with area, prerequisites,
  progress and status per change. The change you opened last stays highlighted, so you find your place again.
  With `--agent`, changes that have not started can be reordered, and new tickets and ideas can be added or
  brainstormed (see below).
- **Charts**: how the work flows over time (see below).

Everything updates within a second of a file change (file watching + Server-Sent Events).

## How status is derived

The board is read-only on purpose: a change's column follows from its files, so dragging a card could not write a
design or tasks, and editing files an agent is working on would race with it. Only the *order* of changes that have
not started can be changed, in the backlog.

| Column | Rule |
|---|---|
| Blocked | draft in `openspec/backlog/<name>.md` (or a change with only `proposal.md`), a hard prerequisite is not done |
| Ready | same, all hard prerequisites done |
| Specified | `design.md`, spec deltas or `tasks.md` written, no task checked |
| In progress | at least one task checked |
| Tasks done | all tasks checked, not archived yet |
| Archived | in `openspec/changes/archive/YYYY-MM-DD-<name>` |

Prerequisites come from the *Depends on* column of `openspec/roadmap.md` (row numbers; ranges like `5–8`;
numbers in parentheses are soft and never block). A row added later between two others can carry a letter (`2a`,
`10b`, ranges like `10a–10c`), and a mark after the number (`3 ✓`) is ignored; a lettered row belongs to the
milestone of its number. Milestones come from lines like
`- **M1 "First release"** (3–9): …`. Both formats match the templates of the
[`openspec-ticket-workflow`](../../skills/openspec-ticket-workflow/references/templates.md) skill. Without a
roadmap the dashboard still works and lists every change.

A **parking lot** (a change that collects deferred items and is never archived) is recognized by the words
"parking lot" at the top of its `tasks.md`, or named with `--parking-lot=<change>`. It is kept out of the board,
the totals and "next up", and shown as its own chip.

## Reordering the backlog (with `--agent`)

In the **Backlog**, drag a change that has not started (⠿) to another place in its milestone, or move it with
Alt+↑/↓. The dashboard rewrites `openspec/roadmap.md`: the rows swap places, every position keeps its number, and
every *Depends on* reference in the table follows the change it points to. A move is refused when it would put a
change before one of its hard prerequisites, pass a change that has started, or leave the milestone, and when the
file changed since it was read. Nothing else in the file is touched.

## New tickets, ideas and brainstorming (with `--agent`)

**＋ New ticket** in the backlog opens a form: name (kebab-case), area, milestone, prerequisites, a one-line goal
and the proposal. Then:

- **Add to roadmap** writes `openspec/backlog/<name>.md` and a roadmap row at the end of the milestone. The row
  gets the next free number after the milestone's last row (`9` → `9a`, `9a` → `9b`), so no other number changes;
  without a milestone it gets the next number at the end of the table. The ticket is ready to start (**Start a
  session…**).
- **Save as idea** writes only the draft, marked as an idea that needs refinement, and no roadmap row. Ideas are
  listed in their own group at the end of the backlog (and as a chip on the board) and count nowhere else: not on
  the board, in the totals, in "next up" or in the charts. **Plan…** adds an idea to the roadmap, **Delete**
  removes it.
- If the name is a ticket that is planned but has not started, **Update draft** replaces its proposal and keeps
  its row.

**💡 Brainstorm** (in the backlog, on an idea as **Refine**, or in the form as **Brainstorm it first**) opens a
brainstorming conversation in the chat. Claude asks questions, challenges assumptions, checks the roadmap, the
specs and the code for overlaps and prerequisites, and keeps the ticket to one reviewable slice. It works
read-only. Once you agree, it writes the ticket as a card in the chat; nothing is saved until you press **Review and
save…**, which opens the form with the ticket filled in. A brainstorming that ends without a good ticket leaves no
trace in the project.

An idea is an ordinary backlog draft with a marker after its title, so it stays readable for people and agents:

```markdown
# Proposal

> **Idea**: needs refinement before it is planned.
> Goal: Todos that repeat daily, weekly or monthly.

## Why
…
```

## Charts

**Charts** (next to Board and Backlog, or `?view=charts`) shows, for the milestone picked above or all changes:

- **Cumulative flow**: the number of changes per status over time; a band that widens is work piling up there.
- **Milestone burn-up**: changes done against changes planned (the line rises when a change is added), with a
  forecast from the recent pace once two changes are done. It counts changes, not tasks, because tasks only exist
  once a change is specified.
- **Work in progress: age**: how long each open change has been in its status, against the typical (median) time
  of finished changes in that status; much longer than usual is flagged.
- **Cycle time per change**: each change from specified to archived, split into specifying, implementing and
  review/archive, with the median per phase. "+n tasks" marks tasks added after work started.
- **Dependencies and critical path**: the roadmap as a graph; the longest chain of open changes is highlighted.
  Click a change to open it.
- **When tasks get checked off**: check-offs per day and hour.

**○ Focus** works here too: the flow leaves out the archived band (so the open statuses get the scale), and the cycle
times and the dependency graph show only changes that are not archived; the medians still come from all finished
changes.

The data comes from two sources. **git**: every commit that touched `openspec/changes` or `openspec/backlog`
(when a draft, a design or tasks appeared, a task was checked, a change was archived), so the charts cover the
whole history, but only as finely as the commits: a ticket committed once shows up as done in one step. **The
dashboard's own history**, recorded within seconds while it runs. Per change and status (and per task) the earlier
time wins. Hover a chart for the values; **Data** under a chart shows them as a table.

## Git history

**⎇** in the header (on a project's page) opens a read-only history of the project's repository, like a file
manager's history view: the commits of HEAD and of every branch, tag and remote branch, newest first, with a graph
of the branches and badges for the refs (150 at a time, more on scroll); below (side by side when maximized) the
selected commit with author, date, message, parents (click to jump), the changed files (status, +/−) and their
unified diff, a merge against its first parent. **openspec/ only** keeps the commits that changed `openspec/`.
↑/↓, j/k, Page Up/Down, Home/End move; `Esc` restores, then closes; it reloads when the newest commit or the branch
changes. `GET /api/git/log?skip=&only=1` and `GET /api/git/commit?h=` serve it. An orange dot on ⎇ marks
uncommitted changes: the workspace scan (every 10 s while a page is open) also runs `git status --porcelain` and
sends the number as `workspace.uncommitted`. The style picker, the light/dark switch and the settings sit in the
header's ☰ menu, so the header stays short on small screens.

A repository's content and configuration are untrusted: git runs without pager, external diff or textconv drivers,
fsmonitor, prompts, optional locks or any transport (a partial clone does not fetch missing objects), with a
timeout of 20 s and output limits (a diff is cut at 2 MB, a file's diff at 3000 lines, a line at 2000 characters);
commit ids are checked before they reach git.

**Back in time**: a double-click on a commit (or Enter), or a branch in the history's **Board:** picker, asks
`GET /api/state-at?rev=<commit or branch>`: the server resolves it (`git log -1 --end-of-options <rev>`; a revision
must start with a letter or digit and contain no `..`), unpacks `openspec/` of that commit into a temporary folder
(`git archive <commit>:<prefix>openspec | tar -x`, kept for the last 40 commits), sets each file's time to its last
commit up to that one (one `git log --name-only`), and reads it with the same code as the working tree, without the
CLI's validation and without recording history; the result carries `at` (commit, time, subject) and the events up
to that time. `GET /api/file?at=<commit>` serves the files of such a snapshot. The page keeps the live state aside
(SSE updates go there), hides the controls that would change something, shows an orange bar with ◀ Earlier,
Later ▶ and Back to now, and shrinks the history to a box; ↑/↓ there travel along (debounced). Closing the history
returns to the live state.

**The folder button** (with `--agent`, on a project's page) opens the project's folder: `POST /api/open-folder` runs
the command from `settings.json` (`files.open`, set in **⚙ Settings › General**). Empty: `open` (macOS), `explorer`
(Windows) or `xdg-open`; an app name on macOS: `open -a <app> <folder>`; a command with `{dir}`: split into words
(quotes keep spaces), `{dir}` replaced by the folder, run without a shell and detached. `open` reports a missing app,
which the page shows.

## Agent panel (optional)

Started with `--agent`, the dashboard talks to Claude Code in two places:

- **Chat** (in the header and on the full-screen board) is a messenger, independent of any ticket:
  - **Assistant**: chat about the project (plan, specs, code, progress, ideas). It reads the project with
    read-only tools (Read, Grep, Glob), never changes it, knows the project status when the chat starts and
    remembers the conversation; **New chat** starts over.
  - **💡 Brainstorm**: shape an idea into a ticket (see above); **New brainstorm** starts over.
  - **Session · <ticket>**: every session started from the dashboard is a conversation with its steps and replies.
    Your messages go straight to it; you can end it after the current turn or stop it, and a message to an ended
    session continues it. `claude --resume <session-id>` takes it over in a terminal.
  - **Terminal sessions** (its own button in the header, a terminal window with a prompt `>_`, with the number of running sessions; not a chat tab; on
    the overview it lists every running session, and one of a followed project opens that project): join a session
    running elsewhere (a terminal, an IDE). On macOS, a session running in Terminal is written to by typing: the server finds
    its tty (`ps`), checks that Claude Code is the foreground process there and that it is not asking something (a
    permission prompt in the tab's contents), and types the message with AppleScript (`do script … in` the tab with
    that tty), one line, sent with Return; no hook needed, and it works while the session waits at its prompt. A long
    text arrives in Claude Code as a paste, where the Return becomes part of it; the server then reads the tab and,
    while the text still sits in the input box (between the last two rules) and nothing is being asked, sends Return
    on its own. The end of a joined session's thread shows its state (working with the current step, done and
    waiting, listening, ended), polled with the transcript every 2 s from Claude Code's own idle/busy. In write mode
    the bar folds into one line (**Details ▾** unfolds it), and Claude's answers get the reactions, requests and
    quotes of the chat; **⤓ Background** puts the session into the background list (`localStorage` `osd-bg`), a
    header button with its states polled every 4 s from `GET /api/sessions/status?ids=…` (token in the header):
    `working`, `waiting` (done), `asking` (Claude Code's own status `waiting`: a permission or question is open; for a
    session in macOS Terminal also a menu in its tab), `ended` (the process is gone) or `error` (the last reply is an
    API error), with the last prompt and the start of the last reply; a session-only session gets the quick path next to **Read only**: **Onboard as
    project** (a confirmation, then `add` and `onboard` of the discovery API, and the overview with its onboarding
    chat) or **Follow now** when the folder has `openspec/` (following it again removes it from the unfollowed or
    archived ones); a quote typed into a terminal is one line, so the dashboard reads `[Replying to …] text`
    with a space as well as with a line break. **▣ Terminal** cycles terminal colors for the conversation (with the
    steps CLI-style: `⏺ Tool(argument)` and `⎿` the first four lines of its result, taken from the transcript's
    `tool_result`), for the whole panel, and back; **A− / A / A+** set the text size. While the session has been working
    for more than 30 s since your message, a rain canvas (the Matrix style's falling code, fading to transparent)
    runs behind the conversation and is removed when it is done (a still image with reduced motion); the **Write
    mode** tab of the settings (⚙ below the input box opens it there) turns it off, sets the delay (5–600 s) and the
    color of your messages (highlighted, the style's accent, or an own color with a readable text color). Both only apply in write mode
    and are kept in `localStorage` (`osd-term-view`: `look`, `fs`, `matrix`, `rainAfter`, `me`, `ctxWin`). **Set up the hook** is
    only offered for a picked session that cannot be typed into. The drop-down lists the project's sessions of the last 12 hours: the ones the
    hook below reports, and also those it has not seen (no hook, or started before it), found in Claude Code's own
    records: `~/.claude/sessions/<pid>.json` (session id, folder, idle or busy; the process must still run) for the
    running ones and the interactive transcripts in `~/.claude/projects/<folder>/` for the ended ones (`claude -p`
    runs are left out). Those can only be followed, marked ◌ … read-only; **Set up the hook** writes the hook into
    `.claude/settings.local.json` and lists that file in `.git/info/exclude`. Running sessions in other folders are
    listed too: under **Other projects** (picking one switches to that project with `?panel=chat&term=<session>`) and
    **Session only** (a folder that is not followed: read-only, with **Onboard it as a project…**, which adds the
    folder as a candidate and opens its onboarding chat, or **Follow it** when it has `openspec/`). The hook works in
    such a folder too: **Set up the hook** there (or `agent-hook.mjs install <folder>`) installs it in that folder, the
    hook then uses the folder with the hook in its `.claude` settings as the session's root when there is no
    `openspec/` above, and the panel writes to that folder's inbox (messages and listening as for the project).
    `OPENSPEC_DASHBOARD_CLAUDE_DIR` reads these records from another folder than `~/.claude`. Each group of the list has the latest session on top (by its last activity), with the last prompt typed there, working or
    waiting, last step); a joined session shows its transcript live, read-only, until **✎ Write to it**; then
    messages go to that session only, as if typed there. **👂 Keep it listening** makes the session wait for a
    message when it is done instead of stopping. **Any session** sends to the next session that takes a step.
    **＋ New session** (`POST /api/agent/new-session`) opens a terminal with `cd <project> && claude`: on macOS a
    Terminal window via AppleScript (`do script`), in the background, or in front when the folder is not trusted yet
    (Claude Code's trust question comes first; the session record only exists after it); on Linux the first of
    x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal, kitty, alacritty, xterm with `$SHELL -lc`; on
    Windows `cmd /k`; or the command in the settings file (`terminal.open`, with `{cmd}` and `{dir}`, run without a
    shell). The page joins the first session of the project whose `startedAt` is after the click, in write mode.
    AppleScript calls to Terminal time out after 8 s; when macOS has not allowed the dashboard to control Terminal
    (an unanswered or denied Automation request, typical for a LaunchAgent), the server says so and does not try
    again for a minute.
  - **Side by side**: an overlay with two frames of the page itself, each with `?embed` (only the terminal sessions
    panel, filling the frame; no header, no close or maximize) and `term=<session>&write=1` on the session's project
    page (or the overview); each half polls, joins and writes on its own. The left one is the joined session, the
    right one the most recent other running session.
  - **Context gauge**: the session list, the transcript and `/api/sessions/status` carry `ctx` (`used`, `window`,
    `compactions`): `used` from the last main-chain assistant message's `usage` (input + cache creation + cache read
    + output tokens) or, after a `compact_boundary`, its `postTokens`; `window` is 1M when the model id has `[1m]` or
    the transcript was ever above 200k tokens (the largest `usage` and `preTokens` of the whole transcript, read once
    in the background in 4 MB steps and then only what was added), 200k when Claude Code compacted it on its own
    below that, else `null` (the page uses `osd-term-view.ctxWin`, 200k by default). **Compact now** (from 70 %,
    while the session waits at its prompt in macOS Terminal) types `/compact`. A `compact_boundary` shows in the
    thread as a divider with the tokens before and after; the summary Claude Code adds after it is left out.
  - **⤢ Maximize** gives the chat the whole window (`Esc` restores it, a second `Esc` closes it).
  - **Reactions and quotes**: each of Claude's answers has a faint ⋯; hovering the answer (or tapping ⋯) shows a
    row where 👍 ✅ 🌿 🙏 🎉 💡 send a short answer at once ("I agree
    with this.", "Yes, go ahead with this.", …; 🌿 accepts but on a new git branch, unmerged), 🔁 asks Claude to say it again in simpler words, 📝 to summarize
    it in a few bullet points, 📊 to turn it into an overview table and 🔄 to try it again (e.g. a failed run after
    a change), and **↩ Quote** replies to that answer (select a part of it first
    to quote just that part). Claude sees no timestamps of the dashboard, so the reference it gets is the answer's
    first sentence, or the selected part, in a fixed form (`[Reaction 👍 to your message: "…"]`,
    `[Request 📝 about your message: "…"]`, `[Replying to your message: "…"]`), which it finds in its own conversation; the whole answer is not sent again. **⋯ under the input box** holds
    quick messages about no answer in particular, in groups (👀 status, ❓ blockers, 🔍 changes so far, 📍 ticket
    progress · ⏸ pause after this step, 🎯 stay on the ticket, 🧹 wrap up · 🧪 run the quality gate), sent as they
    are and shown short in the thread. A message typed into a working terminal session is absorbed mid-turn; Claude Code keeps it as a
    `queued_command` attachment in the transcript, which the thread shows like a prompt.
    Reactions show as small badges on the answer they belong to.
- **A question box under each tab** of a change (Tasks, Proposal, Design, Spec deltas, Validation): the question
  goes to the assistant with that part as context (`[About the design of the change x: <file>] …`), the answers
  about that tab show inline, and the chat marks such messages with their context.
- **Proposed updates**: **✎ Propose update…** under a tab opens a dialog with the change, the file and its current
  content and asks what should change (with suggestions per tab; the discussion of that tab can be included);
  **Propose** (or a request in the chat) makes the assistant write the complete new version of the file in a ```` ```edit <path> ```` block. The dashboard shows it as a diff against the
  file as it is now; **Accept** writes it, **Reject** drops it. The assistant stays read-only: only Accept writes,
  only Markdown under `openspec/` (new files only below `openspec/changes/`), and only if the file is unchanged
  since the preview.
- **Agent…** on a ticket, with the ticket's context added automatically:
  - **Ask**: a read-only question about the ticket; "Ask about this task" next to the current task prefills one.
  - **Start session**: a new Claude Code session that works on the ticket with the ticket workflow; it opens as a
    conversation in the chat.

```sh
node server.mjs --agent                              # in the project folder, or with --project/--scan
```

**Voice input.** If Podman (or Docker) has a speech-to-text image, every text box of the panel gets a microphone.
The recording is transcribed locally in that container, never by Claude, and the text only goes into the box, so
you can check and correct it before sending. The dashboard looks for an image whose entrypoint is whisper.cpp's
`whisper-cli` with its model (`whisper-cli -m <model> …`) and checks again every minute; `--stt-image` names one.
Each recording runs in a throwaway container without network, with a read-only root and memory limits; the audio
goes in on stdin and is never written to a file. The small selector next to the microphone is the language you
speak (default: the browser's language). With a fixed language a short clip takes a few seconds (Whisper's audio
window is sized to the clip, with a floor that keeps it from repeating itself); **Auto** detects the language
first, which takes noticeably longer on a CPU.

**Rephrase.** If a local language model is available, **✨ Rephrase** next to the microphone rewrites the draft in
the box into a clear prompt: to the point, nothing important dropped, in the language of the draft. The result is a
suggestion: **Accept** replaces the text (you can still edit it), **Reject** keeps yours. Like the transcription it
runs locally, never through Claude. Two ways to provide a model:

- `--rephrase-url=<url>`: any OpenAI-compatible server (e.g. llama.cpp's `llama-server` or Ollama, such as
  `http://127.0.0.1:11434/v1`).
- A Podman (or Docker) image whose entrypoint is an LLM adapter (`*-llm-adapter`) that speaks JSON lines on stdin
  and stdout in front of llama.cpp and takes `--model <file.gguf> --ctx <n>`. The dashboard finds such an image and a
  GGUF chat model (in a Hugging Face cache layout under `~/.cache/huggingface/hub`, or `--rephrase-models=<dir>`,
  or `--rephrase-model=<file>`), starts the container on the first request without network and with the model
  folder read-only, and ends it after 10 idle minutes. On a CPU the first request waits for the model to load.

**Local models (⚙).** The ⚙ button in the header (and next to Rephrase) opens a dialog that shows which local models
are in use and lets you choose:

- **Rephrase**: the dialog always shows the setup in use (**In use**, and the matching option with its image and
  model filled in). With **Choose automatically** (the default) the dashboard picks: the server from
  `--rephrase-url`, otherwise the first LLM container found with the largest chat model, otherwise Apple's on-device
  model. Untick it to keep the current setup as a fixed choice or change it: a *Container* (pick the image and the
  GGUF model), a *Local server* with an
  OpenAI-compatible API (e.g. Ollama at `http://127.0.0.1:11434/v1` with a model name, LM Studio or `llama-server`;
  the dashboard checks that it answers), *Apple's on-device model* (macOS 26 with Apple Intelligence; the dashboard
  builds a small Swift helper once with the Xcode command line tools; not tested yet, as no macOS 26 machine was at
  hand), or *Off*. **Test** rephrases a sample sentence; **Load now** starts a container model ahead of the first
  request.
- **Speech-to-text**: the whisper image, or off.

The choice is saved in `$XDG_STATE_HOME/openspec-dashboard/settings.json`, applies at once and overrides the
command-line options. If a model container ends while loading, the panel says why: how much memory the model needs,
how much the VM has available, and which other model container is running.

**Podman (⚙ › Podman; on the overview also the box button in the header).** Local models, speech-to-text and a containerised OpenSpec CLI all share one Podman VM on
macOS and Windows, so the second tab shows how it is doing: the VM's memory, CPU load and disk (with images and how
much of it is reclaimable), and its containers with their state and memory: the 15 used last at the top (running
ones count as in use now, never-started ones as not used), then all others by name. Containers can be started and
stopped there; the list keeps its place while it refreshes. **Restart the VM** stops it (every container in it stops) and starts it again, then
starts the containers checked as "start after restart" and checks the local models and the OpenSpec CLI again; the
dialog shows each step. Containers started with `--rm` (like the dashboard's model container) disappear when they
stop and cannot be checked. The checked containers are saved in the same `settings.json`.

It runs the `claude` command (Claude Code) in the project folder, so it uses Claude Code's own login and counts
towards the same plan or account as your other sessions; there is no separate key. Each question and session is
a normal Claude Code run.

**Messages to sessions started elsewhere** need a small hook in the project (once, written to the git-ignored
`.claude/settings.local.json`; sessions that are already running pick it up after a restart):

```sh
node <path-to>/tools/openspec-dashboard/agent-hook.mjs install <project>     # uninstall removes it again
```

Messages wait in an inbox outside the project (`$XDG_STATE_HOME/openspec-dashboard/inbox/`). The hook hands them
to the session after its next tool call, with your next prompt, or, when the session is about to stop, as the
reason to continue. A message for a joined session only goes to that session and reads like what you type there.
It also records a heartbeat (the session's state, its last tool, the last prompt typed there, its working folder
and the path of its transcript), so the panel shows that a session is active and can show it live: the server
reads the transcript (only files below `~/.claude/projects`, a long one from its last 2 MB on) as it grows and
shows prompts, replies, steps and errors; Claude Code's own messages (`<task-notification>` and the like) are left
out. **Keep it listening** writes `listen/<session>.json` in the inbox; while it exists, the Stop hook waits (up to
its timeout of 30 minutes, which `install` sets) for a message for that session and hands it over as the reason to
continue. A hook installed before this has a 10-second Stop timeout; the panel asks to run `install` again. Queued
messages can be cancelled until they are delivered. No hook runs while a session waits at its prompt (also right
after it started or was resumed), so a message for it waits for the next prompt typed there; listening only takes
effect at the end of its next answer. Whether a session works or waits comes from Claude Code's own record
(`~/.claude/sessions/<pid>.json`: `idle`, `busy`) when there is one, else from the hook's last event.

**Sessions started from the dashboard** run without anyone to answer permission prompts, so prompts are declined.
Allow what the ticket workflow needs (the quality gate, `openspec`, `git add`/`git commit`) in the project's
`.claude/settings.json`; edits are accepted by the default permission mode `acceptEdits`. Claude Code applies a
project's permission rules only once the folder is trusted: run `claude` in it once and accept the trust dialog
(the panel warns when it is not). Before starting, the dashboard checks that no other change has unarchived work,
that the ticket's prerequisites are done and that no other session is active; "Start anyway" overrides that.
Only one session started from the dashboard runs per project.

**Safety.** `--agent` only runs on `127.0.0.1`. Every action needs a token that is created at each start and
only handed to pages served under the dashboard's own address; requests from other origins or host names are
refused. Questions and the assistant cannot change files. Questions, chats and sessions are listed while the server runs
(the conversations themselves stay in Claude Code, so `claude --resume` finds them); an idle chat process ends after
20 minutes and the next message resumes the same conversation.

## OpenSpec CLI

The dashboard runs `openspec validate --all --json` and `openspec list --json` when something under `openspec/`
changed (checked every 60 seconds and after file changes), one call at a time across all projects, and shows the
result per change. A call that takes longer than two minutes is stopped and not repeated; after a failure the next
try waits 1, 2, 4 … up to 15 minutes. For each active change it also runs `openspec show <change> --json`, so the
**Validation** tab shows what was checked (every spec delta with its requirement and number of scenarios, a missing
scenario marked) next to the errors, warnings and notes. It also says what the CLI is doing, and that drafts in
`openspec/backlog/` and archived changes are not validated by it. Validation checks the structure of a change
(requirements with SHALL/MUST and at least one scenario), so it matters from the moment a change is specified. It uses `openspec` from `PATH`. If OpenSpec runs
somewhere else (a container, a wrapper script), point the dashboard at it:

```sh
node server.mjs --cli=./tools/openspec      # or: OPENSPEC_CLI=./tools/openspec node server.mjs
node server.mjs --no-cli                    # files only
```

Without a working CLI everything except the validation results still works.

## Options

| Option | Default | |
|---|---|---|
| `<dir>` or `--project=<dir>` | current directory | a folder that contains `openspec/`; repeatable |
| `--scan=<dir>` | | follow every project up to three levels below `<dir>`; repeatable |
| `--port=<n>` | `4590` (or `PORT`) | |
| `--host=<addr>` | `127.0.0.1` | use `0.0.0.0` only on a trusted network |
| `--cli=<command>` | `openspec` (or `OPENSPEC_CLI`) | bare names are looked up on `PATH` |
| `--no-cli` | | do not run the OpenSpec CLI |
| `--parking-lot=<change>` | auto-detected | |
| `--history=<file-or-dir>` | `$XDG_STATE_HOME/openspec-dashboard/<project>-<hash>.json` (`~/.local/state/…`) | activity history; a directory with several projects |
| `--no-open` | | do not open the browser (macOS) |
| `--agent` | off | the agent panel (see above) |
| `--claude=<command>` | `claude` (or `CLAUDE_CLI`) | the Claude Code command |
| `--agent-permission-mode=<mode>` | `acceptEdits` | permission mode of started sessions (`acceptEdits`, `auto`, `dontAsk`, `plan`, …) |
| `--agent-model=<model>` | Claude Code's default | model for questions and sessions, e.g. `sonnet` |
| `--agent-prompt=<file>` | built in | first message of a started session; `{change}` is replaced by the change name |
| `--stt-image=<image>` | detected (or `OPENSPEC_DASHBOARD_STT_IMAGE`) | speech-to-text image: entrypoint `whisper-cli -m <model>` |
| `--stt-language=<code>` | `auto` | language when the page sends none |
| `--no-stt` | | no voice input |
| `--rephrase-url=<url>` | | an OpenAI-compatible server for **Rephrase** |
| `--rephrase-image=<image>` | detected | an LLM adapter image for **Rephrase** |
| `--rephrase-model=<file.gguf>` | the largest chat model found | the model the adapter image loads |
| `--rephrase-models=<dir>` | | another folder to look for models in |
| `--no-rephrase` | | no **Rephrase** |

Ten styles, picked in the header: Flat, Glass, Clay, Paper, Whiteboard, Notebook and Comic (each in light and
dark), Blackboard, Matrix and Terminal (always dark). In the address, `?style=flat|glass|clay|paper|whiteboard|blackboard|notebook|matrix|terminal|comic`
and `?theme=light|dark` choose the look (otherwise the header buttons and the system setting decide),
`?view=board|backlog|charts` the view of the board, `?focus` turns on focus mode, `?panel=chat` opens the chat,
and `?snapshot` loads the data once without the live stream (useful for screenshots).

## Notes

- The history (checked-off tasks, status changes, the chart) is recorded only while the server runs; it is kept
  outside the project so nothing needs to be ignored in git.
- The "files written" signal scans the project tree every 10 seconds, skipping `.git`, `node_modules`, `target`,
  `build`, `dist` and similar folders.
- The server only serves `openspec/**/*.md` from the project and binds to `127.0.0.1` by default. Without
  `--agent` it never writes to the project or starts anything; it only reads (including `git log` for the charts).
