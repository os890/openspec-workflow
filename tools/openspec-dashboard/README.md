# OpenSpec dashboard

A live, local dashboard for following the progress of OpenSpec changes while an agent (or a team) works through
them, e.g. with the [ticket workflow](../../README.md). No dependencies, no build step, no install: one Node
script and one HTML page. Needs Node 20 or newer.

```sh
cd <your project>                                   # the folder that contains openspec/
node <path-to>/tools/openspec-dashboard/server.mjs  # opens http://127.0.0.1:4590/
```

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
CLI calls for all projects run one at a time.

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
  With `--agent`, changes that have not started can be reordered (see below).
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

## Agent panel (optional)

Started with `--agent`, the dashboard talks to Claude Code in two places:

- **Chat** (in the header and on the full-screen board) is a messenger, independent of any ticket:
  - **Assistant**: chat about the project (plan, specs, code, progress, ideas). It reads the project with
    read-only tools (Read, Grep, Glob), never changes it, knows the project status when the chat starts and
    remembers the conversation; **New chat** starts over.
  - **Session · <ticket>**: every session started from the dashboard is a conversation with its steps and replies.
    Your messages go straight to it; you can end it after the current turn or stop it, and a message to an ended
    session continues it. `claude --resume <session-id>` takes it over in a terminal.
  - **Terminal session**: messages for a session running elsewhere (a terminal, an IDE), delivered at its next
    step through the hook below; its replies appear there.
  - **⤢ Maximize** gives the chat the whole window (`Esc` restores it, a second `Esc` closes it).
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
speak (default: the browser's language). With a fixed language a short clip takes a few seconds; **Auto** detects
the language first, which takes noticeably longer on a CPU.

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
reason to continue. It also records a heartbeat, so the panel shows that a session is active and what it did
last. Queued messages can be cancelled until they are delivered.

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

The dashboard runs `openspec validate --all --json` and `openspec list --json` after file changes and every
60 seconds, one call at a time, and shows the result per change. It uses `openspec` from `PATH`. If OpenSpec runs
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
