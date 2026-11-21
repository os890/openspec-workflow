#!/usr/bin/env node
// Claude Code hook for the OpenSpec dashboard — zero dependencies, Node >= 20.
//
//   node agent-hook.mjs install [<project-dir>]     add the hook to <project>/.claude/settings.local.json
//   node agent-hook.mjs uninstall [<project-dir>]   remove it again
//   node agent-hook.mjs                             (run by Claude Code as a hook; reads the hook input on stdin)
//
// Messages sent from the dashboard to a Claude Code session the dashboard did not start (e.g. one running in a
// terminal) wait as files in the project's inbox outside the project:
//   $XDG_STATE_HOME/openspec-dashboard/inbox/<project>-<hash>/pending/*.json
// This hook hands them to the session at its next step: after a tool call or with the next prompt as additional
// context, or, when the session is about to stop, as the reason to continue. Every hook call also leaves a
// heartbeat (sessions/<session-id>.json), so the dashboard can show that a session is active and what it did last,
// and where its transcript is, so the dashboard can show the session live (read-only) when you join it.
// A message can be for one session (joined in the dashboard) or for whichever session takes the next step. While the
// dashboard listens to a joined session (listen/<session-id>.json), the hook waits when that session is about to stop
// until a message comes (or listening ends), so the message continues the session as if it was typed there.
// Sessions started by the dashboard get their messages on stdin instead; for them the hook only records heartbeats.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const STATE_DIR = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'openspec-dashboard');
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
export const inboxDir = (root) => {
  const r = real(root);
  return path.join(STATE_DIR, 'inbox', `${path.basename(r)}-${createHash('sha256').update(r).digest('hex').slice(0, 8)}`);
};
export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd'];
// the Stop hook may wait for a message while the dashboard listens; Claude Code ends a hook after its timeout
export const STOP_TIMEOUT = 1800;
const LISTEN_MAX = STOP_TIMEOUT - 30;

export function findProjectRoot(dir) {
  for (let d = real(dir); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'openspec'))) return d;
    if (path.dirname(d) === d) return null;
  }
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };

// ---------------------------------------------------------------- inbox (also used by server.mjs)
export function queueMessage(root, { change, text, session }) {
  const t = Date.now();
  const msg = { id: `${t}-${randomBytes(3).toString('hex')}`, change: change || null, text, t, session: session || null };
  writeJson(path.join(inboxDir(root), 'pending', `${msg.id}.json`), msg);
  return msg;
}
export function recordDelivered(root, msg) {
  writeJson(path.join(inboxDir(root), 'delivered', `${msg.id}.json`), msg);
}
export function cancelMessage(root, id) {
  if (!/^[\w-]+$/.test(id)) return false;
  try { fs.unlinkSync(path.join(inboxDir(root), 'pending', `${id}.json`)); return true; } catch { return false; }
}
export function readInbox(root, { since = Date.now() - 24 * 3600e3 } = {}) {
  const dir = inboxDir(root);
  const list = (sub) => { try { return fs.readdirSync(path.join(dir, sub)).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(dir, sub, f))).filter(Boolean); } catch { return []; } };
  const messages = [...list('pending').map((m) => ({ ...m, state: 'queued' })), ...list('delivered').map((m) => ({ ...m, state: 'delivered' }))]
    .filter((m) => m.t >= since).sort((a, b) => b.t - a.t).slice(0, 60);
  const sessions = list('sessions').sort((a, b) => b.t - a.t);
  return { messages, sessions };
}
// Listening: the dashboard follows a joined session and wants messages to continue it even when it is about to stop.
export const listenFile = (root, sid) => path.join(inboxDir(root), 'listen', `${String(sid).replace(/[^\w-]/g, '')}.json`);
export function setListening(root, sid, on) {
  if (on) writeJson(listenFile(root, sid), { until: Date.now() + LISTEN_MAX * 1000 });
  else { try { fs.unlinkSync(listenFile(root, sid)); } catch { /* not listening */ } }
}
const listening = (root, sid) => (readJson(listenFile(root, sid))?.until ?? 0) > Date.now();
// Moves pending messages to delivered/ (a rename, so two hooks never hand out the same message twice). A message for
// one session (joined in the dashboard) only goes to that session.
function takePending(root, sessionId, via) {
  const dir = inboxDir(root);
  let files;
  try { files = fs.readdirSync(path.join(dir, 'pending')).filter((f) => f.endsWith('.json')).sort(); } catch { return []; }
  const out = [];
  for (const f of files) {
    const from = path.join(dir, 'pending', f);
    const forSession = readJson(from)?.session;
    if (forSession && forSession !== sessionId) continue;
    const to = path.join(dir, 'delivered', f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try { fs.renameSync(from, to); } catch { continue; }
    const msg = readJson(to);
    if (!msg) continue;
    Object.assign(msg, { deliveredAt: Date.now(), sessionId, via });
    writeJson(to, msg);
    out.push(msg);
  }
  return out;
}
// messages to a joined session read like what the user types there
export function formatMessages(msgs) {
  if (msgs.every((m) => m.session)) return msgs.length === 1 ? `The user writes (from the OpenSpec dashboard, as if typed here):\n\n${msgs[0].text}`
    : `The user writes (from the OpenSpec dashboard, as if typed here):\n\n${msgs.map((m) => m.text).join('\n\n')}`;
  return formatGeneral(msgs);
}
function formatGeneral(msgs) {
  const one = (m) => `${m.change ? `About the change \`${m.change}\`` : 'About the project'} (sent ${new Date(m.t).toLocaleTimeString()}):\n${m.text}`;
  return `The user sent ${msgs.length === 1 ? 'a message' : `${msgs.length} messages`} from the OpenSpec dashboard while you work. `
    + 'Take it into account at the next sensible point; if it is a question, answer it briefly in your next reply, then continue.\n\n'
    + msgs.map(one).join('\n\n');
}

// ---------------------------------------------------------------- the hook
async function runHook() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { return; }
  const root = findProjectRoot(input.cwd || process.cwd());
  if (!root) return;
  const ev = input.hook_event_name;
  const sid = input.session_id || 'unknown';
  const fromDashboard = process.env.OPENSPEC_DASHBOARD_JOB || null;

  const hb = path.join(inboxDir(root), 'sessions', `${sid.replace(/[^\w-]/g, '')}.json`);
  const prev = readJson(hb) ?? { sessionId: sid, started: Date.now() };
  const beat = (extra = {}) => writeJson(hb, {
    ...prev, t: Date.now(), event: ev, ended: ev === 'SessionEnd',
    tool: ev === 'PostToolUse' ? input.tool_name : prev.tool, dashboardJob: fromDashboard,
    transcript: input.transcript_path || prev.transcript || null, cwd: input.cwd || prev.cwd || null,
    // the label in the dashboard: the last prompt the user typed (not Claude Code's own, like <task-notification>)
    prompt: ev === 'UserPromptSubmit' && input.prompt && !/^\s*</.test(input.prompt) ? String(input.prompt).slice(0, 200) : prev.prompt ?? null,
    waiting: ev === 'Stop', ...extra,
  });
  beat();

  if (fromDashboard || input.agent_id || !['PostToolUse', 'UserPromptSubmit', 'Stop'].includes(ev)) return;
  let msgs = takePending(root, sid, `hook:${ev}`);
  // about to stop while the dashboard listens: wait for a message (the terminal shows the hook running; Esc there
  // takes the session back)
  if (!msgs.length && ev === 'Stop' && listening(root, sid)) {
    const end = Date.now() + LISTEN_MAX * 1000;
    beat({ listening: true });
    while (!msgs.length && Date.now() < end && listening(root, sid)) {
      await new Promise((r) => setTimeout(r, 1000));
      msgs = takePending(root, sid, 'hook:Stop (listening)');
    }
    beat({ listening: false });
  }
  if (!msgs.length) return;
  const text = formatMessages(msgs);
  if (ev === 'Stop') process.stdout.write(JSON.stringify({ decision: 'block', reason: text }));
  else process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: ev, additionalContext: text } }));
}

// ---------------------------------------------------------------- install / uninstall
function install(dir, remove = false) {
  const root = findProjectRoot(dir);
  if (!root) { console.error(`No openspec/ folder in ${path.resolve(dir)} or above.`); process.exit(1); }
  const file = path.join(root, '.claude', 'settings.local.json');
  const settings = readJson(file) ?? {};
  const self = fileURLToPath(import.meta.url);
  const isOurs = (h) => (h.hooks ?? []).some((x) => String(x.command ?? '').includes('agent-hook.mjs'));
  settings.hooks ??= {};
  for (const ev of HOOK_EVENTS) {
    const kept = (settings.hooks[ev] ?? []).filter((h) => !isOurs(h));
    if (!remove) kept.push({ ...(ev === 'PostToolUse' ? { matcher: '*' } : {}), hooks: [{ type: 'command', command: `node ${JSON.stringify(self)}`, timeout: ev === 'Stop' ? STOP_TIMEOUT : 10 }] });
    if (kept.length) settings.hooks[ev] = kept; else delete settings.hooks[ev];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  writeJson(file, settings);
  console.log(`${remove ? 'Removed the dashboard hook from' : 'Added the dashboard hook to'} ${file}`);
  if (!remove) console.log('Sessions started from now on pick it up; a running session needs a restart (or a look at /hooks).');
}

if (process.argv[1] && import.meta.url === pathToFileURL(real(process.argv[1])).href) {
  const [cmd, dir = process.cwd()] = process.argv.slice(2);
  if (cmd === 'install') install(dir);
  else if (cmd === 'uninstall') install(dir, true);
  else await runHook().catch(() => {}); // a hook must never break the session
}
