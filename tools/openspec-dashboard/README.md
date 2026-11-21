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
  panel (`#board:<change>` links to it directly), `Esc` closes it.

Everything updates within a second of a file change (file watching + Server-Sent Events).

## How status is derived

The board is read-only on purpose: a change's column follows from its files, so dragging a card could not write a
design or tasks, and editing files an agent is working on would race with it.

| Column | Rule |
|---|---|
| Blocked | draft in `openspec/backlog/<name>.md` (or a change with only `proposal.md`), a hard prerequisite is not done |
| Ready | same, all hard prerequisites done |
| Specified | `design.md`, spec deltas or `tasks.md` written, no task checked |
| In progress | at least one task checked |
| Tasks done | all tasks checked, not archived yet |
| Archived | in `openspec/changes/archive/YYYY-MM-DD-<name>` |

Prerequisites come from the *Depends on* column of `openspec/roadmap.md` (row numbers; ranges like `5–8`;
numbers in parentheses are soft and never block). Milestones come from lines like
`- **M1 "First release"** (3–9): …`. Both formats match the templates of the
[`openspec-ticket-workflow`](../../skills/openspec-ticket-workflow/references/templates.md) skill. Without a
roadmap the dashboard still works and lists every change.

A **parking lot** (a change that collects deferred items and is never archived) is recognized by the words
"parking lot" at the top of its `tasks.md`, or named with `--parking-lot=<change>`. It is kept out of the board,
the totals and "next up", and shown as its own chip.

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

Nine styles, picked in the header: Flat, Glass, Paper, Whiteboard, Notebook and Comic (each in light and dark), Blackboard, Matrix and Terminal (always dark). In the address, `?style=flat|glass|paper|whiteboard|blackboard|notebook|matrix|terminal|comic` and `?theme=light|dark` choose the look (otherwise the header buttons and the
system setting decide), `?panel=chat` opens the chat, and `?snapshot` loads the data once without the live stream (useful for screenshots).

## Notes

- The history (checked-off tasks, status changes, the chart) is recorded only while the server runs; it is kept
  outside the project so nothing needs to be ignored in git.
- The "files written" signal scans the project tree every 10 seconds, skipping `.git`, `node_modules`, `target`,
  `build`, `dist` and similar folders.
- The server only serves `openspec/**/*.md` from the project and binds to `127.0.0.1` by default. Without
  `--agent` it never writes to the project or starts anything.
