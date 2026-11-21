# Messages from the OpenSpec dashboard

The OpenSpec dashboard (`tools/openspec-dashboard/`) lets the user follow a session and write to it. Its messages
reach you as ordinary user prompts: typed into the terminal, or added by its hook ("The user writes (from the
OpenSpec dashboard, as if typed here): …", "The user sent a message from the OpenSpec dashboard while you work. …").
A message that arrives while you work is to be handled at the next sensible point: answer it briefly, then continue,
unless it asks you to stop.

## Reactions to one of your answers

`[Reaction <emoji> to your message: "<excerpt>"] <sentence>`. The excerpt is the first sentence (or a part the user
selected) of one of your earlier answers; find that answer in the conversation. The sentence says what is meant:

| Emoji | Meaning |
|---|---|
| 👍 | I agree with this. |
| ✅ | Yes, go ahead with this. |
| 🌿 | Yes, go ahead with this, but on a new git branch: create one named after it, switch to it, do the work there and do **not** merge it; the user decides that later. |
| 🙏 | Thanks, that helps. |
| 🎉 | Great, that is exactly right. |
| 💡 | Good idea, let us keep that (note it where it belongs: backlog draft, roadmap candidate or parking lot). |

## Requests about one of your answers

`[Request <emoji> about your message: "<excerpt>"] <sentence>`:

| Emoji | Do |
|---|---|
| 🔁 | Say that answer again, simpler and clearer. |
| 📝 | Summarize it in three to five short bullet points. |
| 📊 | Turn it into a Markdown table (one row per item, the columns that fit). |
| 🔄 | Try it again (e.g. a failed run): the user changed something in the meantime; if it fails again, say what is different. |

## Quotes

`[Replying to your message: "<excerpt>"] <text>` or `[Replying to this part of your message: "<part>"] <text>`: the
text answers that answer (or that part of it). Typed into a terminal, the bracket and the text are on one line.

## Quick messages

Sent as they are, about no answer in particular:

| Message starts with | Do |
|---|---|
| 👀 | Report the current status: what is done, what you are doing right now, what comes next. Then continue. |
| ❓ | Say whether anything blocks you or you need a decision; if not, say so in one line and continue. |
| 🔍 | Summarize the changes so far (which files and why, a few bullet points). Do not commit. |
| 📍 | Say which task of the current change you are on and how many are left. |
| ⏸ | Finish the current step, then stop and wait for the next message. |
| 🎯 | Stay within the current ticket; put anything else in the parking lot (or a roadmap candidate) instead of doing it now. |
| 🧹 | Wrap up: finish the current task, update `tasks.md`, summarize what is done and what is left. |
| 🧪 | Run the quality gate now and report the result; fix nothing yet. |
| ▶️ | Start the app in a clean way: stop whatever of it still runs (dev servers, containers, old processes), build it from a clean state, start it, and say how to reach it (URL or command) and whether it came up without errors. Use the project's own scripts for this (CLAUDE.md, README); if starting it needs something you cannot do, say what. |

## What the dashboard reads

It shows the project from the files of this workflow, so keep their formats (see [templates.md](templates.md)): the
check boxes and `verify:` criteria in `tasks.md`, the rows and milestones of `roadmap.md`, the backlog drafts, and
the parking lot. An idea in the backlog (a draft without a roadmap row) starts with
`> **Idea**: needs refinement before it is planned.` and `> Goal: <one line>`; refine it into a plannable draft and
a roadmap row before work starts.
