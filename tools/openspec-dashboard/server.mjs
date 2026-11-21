#!/usr/bin/env node
// OpenSpec progress dashboard — zero dependencies, Node >= 20.
//
//   node server.mjs [<project-dir> ...] [--project=<dir> ...] [--scan=<dir> ...]
//                  [--port=4590] [--host=127.0.0.1] [--cli=<command>] [--no-cli]
//                  [--parking-lot=<change>] [--history=<file-or-dir>] [--no-open]
//                  [--agent [--claude=<command>] [--agent-permission-mode=<mode>] [--agent-model=<model>]
//                           [--agent-prompt=<file>] [--stt-image=<image>] [--stt-language=<code>] [--no-stt]]
//
// Follows one or more projects (each a folder with openspec/). Without arguments it follows the current folder;
// --scan finds every project with an openspec/ folder up to three levels below the given folder.
// Per project it reads openspec/ (roadmap.md, backlog/, changes/**, changes/archive) on every file change,
// enriches it with the OpenSpec CLI (`openspec validate --all --json`, `openspec list --json`) and pushes the
// result to the browser over Server-Sent Events. The CLI is `openspec` from PATH unless --cli or OPENSPEC_CLI names
// another command; calls are queued across projects, one at a time. Task check-offs observed while the server runs
// are kept per project in a history file outside the project (default: $XDG_STATE_HOME or ~/.local/state, under
// openspec-dashboard/), so the activity feed and the chart survive restarts.
//
// --agent adds an agent panel: ask read-only questions, send messages to a working Claude Code session and start a
// session on a ticket. It runs the local `claude` command (Claude Code, with its own login), only on 127.0.0.1, and
// every action needs a per-start token that only the served page knows. Sessions started elsewhere get messages
// through agent-hook.mjs. If a speech-to-text image (whisper.cpp's whisper-cli) is available in Podman or Docker,
// the text boxes get a microphone: the recording is transcribed locally in that container (no network) and the text
// is only put into the box, never sent by itself.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import os from 'node:os';
import { inboxDir, readInbox, queueMessage, recordDelivered, cancelMessage, formatMessages } from './agent-hook.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- arguments (options may repeat)
const opts = {};
const positional = [];
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (!m) { positional.push(a); continue; }
  (opts[m[1]] ??= []).push(m[2] ?? true);
}
const opt = (k) => opts[k]?.at(-1);
const optList = (k) => (opts[k] ?? []).filter((v) => typeof v === 'string');

const PORT = Number(opt('port') ?? process.env.PORT ?? 4590);
const HOST = typeof opt('host') === 'string' ? opt('host') : '127.0.0.1';
const cliArg = typeof opt('cli') === 'string' ? opt('cli') : process.env.OPENSPEC_CLI || 'openspec';
const CLI = cliArg.includes('/') || cliArg.includes(path.sep) ? path.resolve(cliArg) : cliArg; // bare names resolve via PATH
const USE_CLI = !opt('no-cli');
const PARKING_LOT = typeof opt('parking-lot') === 'string' ? opt('parking-lot') : null;
const AGENT = !!opt('agent');
const claudeArg = typeof opt('claude') === 'string' ? opt('claude') : process.env.CLAUDE_CLI || 'claude';
const CLAUDE = claudeArg.includes('/') || claudeArg.includes(path.sep) ? path.resolve(claudeArg) : claudeArg;
const AGENT_MODE = typeof opt('agent-permission-mode') === 'string' ? opt('agent-permission-mode') : 'acceptEdits';
const AGENT_MODEL = typeof opt('agent-model') === 'string' ? opt('agent-model') : null;
const AGENT_PROMPT = typeof opt('agent-prompt') === 'string' ? fs.readFileSync(path.resolve(opt('agent-prompt')), 'utf8') : null;
const STT_IMAGE_ARG = typeof opt('stt-image') === 'string' ? opt('stt-image') : process.env.OPENSPEC_DASHBOARD_STT_IMAGE || null;
const STT_LANGUAGE = typeof opt('stt-language') === 'string' ? opt('stt-language') : 'auto';
const USE_STT = AGENT && !opt('no-stt');
const TOKEN = randomBytes(18).toString('hex');
if (AGENT && !['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
  console.error('--agent starts Claude Code sessions and only runs on 127.0.0.1 (no --host).');
  process.exit(1);
}
const STATE_DIR = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'openspec-dashboard');
const WORKSPACE_EXCLUDES = new Set(['.git', 'target', 'node_modules', 'node', '.angular', 'dist', 'coverage',
  '.idea', '.vscode', 'test-results', 'playwright-report', '.mvn', '.gradle', 'build', '.venv', '__pycache__']);

// ---------------------------------------------------------------- helpers
const readText = (p) => fsp.readFile(p, 'utf8').catch(() => null);
const statOf = (p) => fsp.stat(p).catch(() => null);
const exists = async (p) => (await statOf(p)) !== null;
const relTo = (root, p) => path.relative(root, p).split(path.sep).join('/');
// Paths shown in the browser: relative to where the dashboard was started, else with the home folder as ~.
const displayPath = (p) => {
  const r = path.relative(process.cwd(), p);
  if (r && !r.startsWith('..') && !path.isAbsolute(r)) return r.split(path.sep).join('/');
  const home = os.homedir();
  return p.startsWith(home + path.sep) ? '~' + p.slice(home.length).split(path.sep).join('/') : p;
};

async function walk(dir, onFile, { excludes = new Set(), maxFiles = Infinity } = {}) {
  let count = 0;
  async function go(d) {
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (count >= maxFiles) return;
      if (excludes.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await go(p);
      else if (e.isFile()) { count++; await onFile(p); }
    }
  }
  await go(dir);
}

function parseRange(s) {
  const m = String(s).match(/(\d+)\s*[–—-]\s*(\d+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  const n = String(s).match(/\d+/);
  return n ? [Number(n[0]), Number(n[0])] : [null, null];
}

function parseNumberList(s) {
  const out = [];
  for (const tok of s.split(',').map((t) => t.trim()).filter(Boolean)) {
    const r = tok.match(/^(\d+)\s*[–—-]\s*(\d+)$/);
    if (r) for (let i = Number(r[1]); i <= Number(r[2]); i++) out.push(i);
    else if (/^\d+$/.test(tok)) out.push(Number(tok));
  }
  return out;
}

function parseDeps(raw) {
  const soft = [];
  const hardText = raw.replace(/\(([^)]*)\)/g, (_, inner) => { soft.push(...parseNumberList(inner)); return ''; });
  return { dependsOn: parseNumberList(hardText), softDependsOn: soft };
}

// ---------------------------------------------------------------- roadmap.md
function parseRoadmap(md) {
  const rows = [];
  const milestones = [];
  let lastMilestone = null;
  for (const line of (md ?? '').split('\n')) {
    const row = line.match(/^\|\s*(\d+)\s*\|(.*)\|\s*$/);
    if (row) {
      const [change = '', context = '', depends = '', goal = ''] = row[2].split('|').map((c) => c.trim());
      rows.push({ order: Number(row[1]), name: change.replace(/`/g, ''), context, dependsRaw: depends, goal, ...parseDeps(depends) });
      lastMilestone = null;
      continue;
    }
    const ms = line.match(/^- \*\*(M\d+)\s+"([^"]+)"\*\*\s*\(([^)]+)\):\s*(.*)$/);
    if (ms) {
      const [from, to] = parseRange(ms[3]);
      lastMilestone = { id: ms[1], title: ms[2], from, to, summary: ms[4].trim() };
      milestones.push(lastMilestone);
      continue;
    }
    if (lastMilestone && /^\s{2,}\S/.test(line)) { lastMilestone.summary += ' ' + line.trim(); continue; }
    lastMilestone = null;
  }
  return { rows, milestones };
}

// ---------------------------------------------------------------- tasks.md / specs
function parseTasks(md) {
  const groups = [];
  let g = null;
  for (const line of md.split('\n')) {
    const h = line.match(/^#{2,3}\s+(.*)$/);
    if (h) { g = { title: h[1].trim(), items: [] }; groups.push(g); continue; }
    const t = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (!t) continue;
    if (!g) { g = { title: 'Tasks', items: [] }; groups.push(g); }
    let text = t[2].trim();
    let id = null;
    const idm = text.match(/^(\d+(?:\.\d+)*)\.?\s+(.*)$/);
    if (idm) { id = idm[1]; text = idm[2]; }
    let verify = null;
    const vi = text.search(/;\s*verify:\s*/i);
    if (vi >= 0) { verify = text.slice(vi).replace(/^;\s*verify:\s*/i, ''); text = text.slice(0, vi); }
    g.items.push({ id: id ?? `${groups.length}.${g.items.length + 1}`, text, verify, done: t[1] !== ' ' });
  }
  const kept = groups.filter((x) => x.items.length);
  for (const x of kept) { x.total = x.items.length; x.done = x.items.filter((i) => i.done).length; }
  return {
    groups: kept,
    total: kept.reduce((a, x) => a + x.total, 0),
    done: kept.reduce((a, x) => a + x.done, 0),
  };
}

async function specStats(root, changeDir) {
  const files = [];
  const specsDir = path.join(changeDir, 'specs');
  if (!(await exists(specsDir))) return { files, requirements: 0, scenarios: 0 };
  await walk(specsDir, async (p) => {
    if (!p.endsWith('.md')) return;
    const md = (await readText(p)) ?? '';
    const ops = {};
    let op = null;
    for (const line of md.split('\n')) {
      const o = line.match(/^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements/i);
      if (o) { op = o[1].toUpperCase(); continue; }
      if (/^###\s+Requirement:/.test(line) && op) ops[op] = (ops[op] ?? 0) + 1;
    }
    files.push({
      path: relTo(root, p),
      capability: path.relative(specsDir, path.dirname(p)).split(path.sep).join('/'),
      requirements: (md.match(/^###\s+Requirement:/gm) ?? []).length,
      scenarios: (md.match(/^####\s+Scenario:/gm) ?? []).length,
      ops,
    });
  });
  files.sort((a, b) => a.capability.localeCompare(b.capability));
  return {
    files,
    requirements: files.reduce((a, f) => a + f.requirements, 0),
    scenarios: files.reduce((a, f) => a + f.scenarios, 0),
  };
}

function sectionParagraph(md, heading) {
  if (!md) return null;
  const re = new RegExp(`^##\\s+${heading}\\s*$`, 'im');
  const m = md.match(re);
  if (!m) return null;
  const rest = md.slice(m.index + m[0].length).split(/\n##\s/)[0].trim();
  return rest.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim() || null;
}

async function readChange(root, dir, name, location, archivedAt = null) {
  const [yaml, proposal, design, tasksMd] = await Promise.all(
    ['.openspec.yaml', 'proposal.md', 'design.md', 'tasks.md'].map((f) => readText(path.join(dir, f))));
  const specs = await specStats(root, dir);
  const files = [];
  let lastModified = 0;
  await walk(dir, async (p) => {
    const st = await statOf(p);
    if (!st) return;
    lastModified = Math.max(lastModified, st.mtimeMs);
    if (p.endsWith('.md')) files.push({ path: relTo(root, p), name: path.relative(dir, p).split(path.sep).join('/'), mtime: st.mtimeMs });
  });
  files.sort((a, b) => a.name.localeCompare(b.name));
  const tasks = tasksMd ? parseTasks(tasksMd) : null;
  // A parking lot collects deferred items and is never archived (see the openspec-ticket-workflow skill).
  const parkingLot = name === PARKING_LOT || /parking[ -]lot/i.test((tasksMd ?? '').slice(0, 800));
  return {
    name,
    parkingLot,
    location,
    archivedAt,
    dir: relTo(root, dir),
    created: yaml?.match(/^created:\s*(.+)$/m)?.[1]?.trim() ?? null,
    skipSpecs: /^skip_specs:\s*true/m.test(yaml ?? ''),
    artifacts: { proposal: proposal !== null, design: design !== null, specs: specs.files.length, tasks: tasks !== null },
    why: sectionParagraph(proposal, 'Why'),
    specs,
    tasks,
    files,
    lastModified: lastModified || null,
  };
}

// A planned change that has not been started yet: openspec/backlog/<name>.md holds its draft proposal.
async function readBacklog(root, file, name) {
  const st = await statOf(file);
  const md = await readText(file);
  return {
    name, location: 'backlog', archivedAt: null, dir: relTo(root, file), created: null, skipSpecs: false,
    artifacts: { proposal: true, design: false, specs: 0, tasks: false },
    why: sectionParagraph(md, 'Why'),
    specs: { files: [], requirements: 0, scenarios: 0 },
    tasks: null,
    files: [{ path: relTo(root, file), name: 'proposal.md', mtime: st?.mtimeMs ?? 0 }],
    lastModified: st?.mtimeMs ?? null,
  };
}

function statusOf(c) {
  if (c.location === 'archive') return 'archived';
  if (c.location === 'missing') return 'missing';
  if (c.parkingLot) return 'parking';
  if (c.tasks && c.tasks.total > 0 && c.tasks.done === c.tasks.total) return 'complete';
  if (c.tasks && c.tasks.done > 0) return 'in-progress';
  if (c.artifacts.tasks || c.artifacts.design || c.artifacts.specs) return 'specified';
  return 'proposed';
}
const isDone = (c) => c && (c.status === 'archived' || c.status === 'complete');

// ---------------------------------------------------------------- OpenSpec CLI (one call at a time, all projects)
let cliQueue = Promise.resolve();
function runCli(cwd, cliArgs, timeout = 60000) {
  const job = () => new Promise((resolve, reject) => {
    execFile(CLI, cliArgs, { cwd, timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } },
      (err, stdout, stderr) => {
        if (err?.code === 'ENOENT') return reject(Object.assign(new Error(`${CLI} not found; install OpenSpec or pass --cli=<command>`), { missing: true }));
        if (err && !stdout) return reject(new Error((stderr || err.message).trim().split('\n').slice(-3).join(' ')));
        resolve(stdout);
      });
  });
  const p = cliQueue.then(job);
  cliQueue = p.catch(() => {});
  return p;
}

function parseJsonOutput(s) {
  const start = s.indexOf('{');
  if (start < 0) throw new Error('CLI returned no JSON');
  return JSON.parse(s.slice(start));
}

// ---------------------------------------------------------------- one followed project
function createProject(root, id, historyFile, onChange) {
  const OPENSPEC = path.join(root, 'openspec');
  const rel = (p) => relTo(root, p);
  const cli = { available: USE_CLI, lastRun: null, durationMs: null, error: null, validate: {}, list: {}, version: null };
  let workspace = { recent: [], changedLast15m: 0, changedLastHour: 0, scannedAt: null };
  let history = { snapshot: null, events: [], series: [] };
  try { history = { ...history, ...JSON.parse(fs.readFileSync(historyFile, 'utf8')) }; } catch { /* first run */ }
  const project = { id, root, name: path.basename(root), state: null, stateJson: '', rev: 0, clients: new Set() };

  function saveHistory() {
    fs.mkdirSync(path.dirname(historyFile), { recursive: true });
    fs.writeFileSync(historyFile, JSON.stringify(history));
  }

  let cliRunning = false;
  let cliPending = false;
  async function refreshCli() {
    if (!cli.available) return false;
    if (cliRunning) { cliPending = true; return false; }
    cliRunning = true;
    const t0 = Date.now();
    try {
      // One retry: when the CLI runs in a container (e.g. a podman wrapper), a start can clash with another session.
      const run = (a) => runCli(root, a).catch((e) => e.missing ? Promise.reject(e)
        : new Promise((r) => setTimeout(r, 1500)).then(() => runCli(root, a)));
      if (!cli.version) cli.version = (await run(['--version'])).trim();
      const v = parseJsonOutput(await run(['validate', '--all', '--json', '--no-interactive']));
      const l = parseJsonOutput(await run(['list', '--json']));
      cli.validate = {};
      for (const item of v.items ?? []) {
        cli.validate[`${item.type}:${item.id}`] = { valid: item.valid, issues: (item.issues ?? []).map((i) => ({ level: i.level, path: i.path, message: i.message })) };
      }
      cli.list = Object.fromEntries((l.changes ?? []).map((c) => [c.name, c]));
      cli.error = null;
    } catch (e) {
      cli.error = e.message;
      if (e.missing) cli.available = false;
    } finally {
      cli.lastRun = Date.now();
      cli.durationMs = Date.now() - t0;
      cliRunning = false;
    }
    if (cliPending) { cliPending = false; setTimeout(() => refreshCli().then((ch) => ch && publish()), 500); }
    return true;
  }

  async function scanWorkspace() {
    const all = [];
    await walk(root, async (p) => {
      const st = await statOf(p);
      if (st) all.push({ path: rel(p), mtime: st.mtimeMs });
    }, { excludes: WORKSPACE_EXCLUDES, maxFiles: 40000 });
    const now = Date.now();
    all.sort((a, b) => b.mtime - a.mtime);
    workspace = {
      recent: all.slice(0, 15),
      changedLast15m: all.filter((f) => now - f.mtime < 15 * 60e3).length,
      changedLastHour: all.filter((f) => now - f.mtime < 60 * 60e3).length,
      files: all.length,
      scannedAt: now,
    };
  }

  function recordHistory(changes, totals) {
    const now = Date.now();
    const snap = {};
    for (const c of changes) {
      snap[c.name] = { status: c.status, tasks: Object.fromEntries((c.tasks?.groups ?? []).flatMap((g) => g.items.map((i) => [i.id, i.done]))) };
    }
    let dirty = false;
    const prev = history.snapshot;
    if (prev) {
      for (const c of changes) {
        const before = prev[c.name];
        if (!before) { history.events.push({ t: now, change: c.name, kind: 'added' }); dirty = true; continue; }
        if (before.status !== c.status) {
          history.events.push({ t: now, change: c.name, kind: 'status', from: before.status, to: c.status });
          dirty = true;
        }
        for (const g of c.tasks?.groups ?? []) {
          for (const i of g.items) {
            const was = before.tasks?.[i.id];
            if (was === undefined || was === i.done) continue;
            history.events.push({ t: now, change: c.name, kind: i.done ? 'task-done' : 'task-reopened', task: i.id, text: i.text });
            dirty = true;
          }
        }
      }
      for (const name of Object.keys(prev)) {
        if (!snap[name]) { history.events.push({ t: now, change: name, kind: 'removed' }); dirty = true; }
      }
    }
    const last = history.series.at(-1);
    if (!last || last.done !== totals.done || last.total !== totals.total || last.archived !== totals.archived) {
      history.series.push({ t: now, done: totals.done, total: totals.total, archived: totals.archived });
      dirty = true;
    }
    if (!prev || dirty) {
      history.snapshot = snap;
      history.events = history.events.slice(-1000);
      history.series = history.series.slice(-5000);
      saveHistory();
    }
  }

  async function scan() {
    const roadmapMd = await readText(path.join(OPENSPEC, 'roadmap.md'));
    const { rows, milestones } = parseRoadmap(roadmapMd);
    const changesDir = path.join(OPENSPEC, 'changes');
    const found = new Map();

    for (const e of await fsp.readdir(changesDir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || e.name === 'archive') continue;
      found.set(e.name, await readChange(root, path.join(changesDir, e.name), e.name, 'active'));
    }
    const archiveDir = path.join(changesDir, 'archive');
    for (const e of await fsp.readdir(archiveDir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory()) continue;
      const m = e.name.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
      const name = m ? m[2] : e.name;
      if (found.has(name) && found.get(name).location === 'active') continue;
      found.set(name, await readChange(root, path.join(archiveDir, e.name), name, 'archive', m ? m[1] : null));
    }
    const backlogDir = path.join(OPENSPEC, 'backlog');
    for (const e of await fsp.readdir(backlogDir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isFile() || !e.name.endsWith('.md')) continue;
      const name = e.name.slice(0, -3);
      if (!found.has(name)) found.set(name, await readBacklog(root, path.join(backlogDir, e.name), name));
    }

    const changes = [];
    for (const r of rows) {
      const c = found.get(r.name) ?? { name: r.name, location: 'missing', artifacts: { proposal: false, design: false, specs: 0, tasks: false }, specs: { files: [], requirements: 0, scenarios: 0 }, tasks: null, files: [] };
      found.delete(r.name);
      changes.push({ ...c, ...r, inRoadmap: true });
    }
    let extra = 1000;
    for (const c of found.values()) changes.push({ ...c, order: extra++, context: '', dependsOn: [], softDependsOn: [], dependsRaw: '', goal: c.why ?? '', inRoadmap: false });

    const byOrder = new Map(changes.map((c) => [c.order, c]));
    for (const c of changes) {
      c.status = statusOf(c);
      c.milestone = milestones.find((m) => c.order >= m.from && c.order <= m.to)?.id ?? null;
      c.validation = cli.validate[`change:${c.name}`] ?? null;
      c.cliList = cli.list[c.name] ?? null;
    }
    for (const c of changes) {
      c.blockedBy = c.dependsOn.filter((o) => !isDone(byOrder.get(o)));
      c.dependents = changes.filter((x) => x.dependsOn.includes(c.order)).map((x) => x.order);
    }
    const nextUp = changes.find((c) => !isDone(c) && c.blockedBy.length === 0 && c.status !== 'missing' && c.status !== 'parking');

    const tickets = changes.filter((c) => c.status !== 'parking');
    const totals = {
      done: tickets.reduce((a, c) => a + (c.tasks?.done ?? 0), 0),
      total: tickets.reduce((a, c) => a + (c.tasks?.total ?? 0), 0),
      archived: changes.filter((c) => c.status === 'archived').length,
    };
    recordHistory(changes, totals);

    const specValidation = Object.entries(cli.validate).filter(([k]) => k.startsWith('spec:'))
      .map(([k, v]) => ({ id: k.slice(5), ...v }));

    return {
      projectId: id,
      project: project.name,
      projectPath: root,
      roadmapFound: roadmapMd !== null,
      milestones,
      changes,
      nextUp: nextUp?.name ?? null,
      totals,
      specs: { validation: specValidation },
      cli: { available: cli.available, version: cli.version, lastRun: cli.lastRun, durationMs: cli.durationMs, error: cli.error, command: CLI },
      workspace,
      events: history.events.slice(-200).reverse(),
      series: history.series,
    };
  }

  async function publish() {
    try {
      const next = await scan();
      const json = JSON.stringify(next);
      if (json === project.stateJson) return;
      project.stateJson = json;
      project.rev++;
      project.state = next;
      const payload = `id: ${project.rev}\ndata: ${JSON.stringify({ rev: project.rev, scannedAt: Date.now(), ...next })}\n\n`;
      for (const res of project.clients) res.write(payload);
      onChange();
    } catch (e) {
      console.error(`[${id}] scan failed:`, e);
    }
  }

  let timer = null;
  function schedule(delay = 250) {
    clearTimeout(timer);
    timer = setTimeout(async () => { await publish(); cliDebounced(); }, delay);
  }
  let cliTimer = null;
  function cliDebounced() {
    clearTimeout(cliTimer);
    cliTimer = setTimeout(async () => { if (await refreshCli()) await publish(); }, 1500);
  }

  // The overview: what someone glancing at several projects needs, computed from the full state.
  function summary() {
    const s = project.state;
    if (!s) return { id, name: project.name, displayPath: displayPath(root), loading: true };
    const rank = { 'in-progress': 0, complete: 1, specified: 2 };
    const active = s.changes.filter((c) => c.status in rank)
      .sort((a, b) => rank[a.status] - rank[b.status] || (b.lastModified ?? 0) - (a.lastModified ?? 0));
    const cur = active[0] ?? s.changes.find((c) => c.name === s.nextUp) ?? null;
    let task = null;
    for (const g of cur?.tasks?.groups ?? []) { const i = g.items.find((x) => !x.done); if (i) { task = { id: i.id, text: i.text, group: g.title }; break; } }
    const counts = {};
    for (const c of s.changes) counts[c.status] = (counts[c.status] ?? 0) + 1;
    const msOf = (mid) => s.milestones.find((m) => m.id === mid);
    const ms = msOf(cur?.milestone) ?? s.milestones.find((m) => s.changes.some((c) => c.milestone === m.id && !isDone(c)));
    const msChanges = ms ? s.changes.filter((c) => c.milestone === ms.id) : [];
    const lastActivity = Math.max(s.events[0]?.t ?? 0, s.workspace.recent[0]?.mtime ?? 0, ...s.changes.map((c) => c.lastModified ?? 0)) || null;
    return {
      id, name: s.project, displayPath: displayPath(root),
      totals: s.totals,
      counts,
      changes: s.changes.filter((c) => c.status !== 'parking').length,
      done: s.changes.filter(isDone).length,
      current: cur && {
        name: cur.name, status: cur.status, order: cur.inRoadmap ? cur.order : null, milestone: cur.milestone,
        tasks: cur.tasks && { done: cur.tasks.done, total: cur.tasks.total }, task, blockedBy: cur.blockedBy,
      },
      milestone: ms && { id: ms.id, title: ms.title, done: msChanges.filter(isDone).length, total: msChanges.length },
      invalid: s.changes.filter((c) => c.validation && !c.validation.valid && c.status !== 'proposed').length,
      cli: { available: s.cli.available, error: s.cli.error },
      lastActivity,
      lastEvent: s.events[0] ?? null,
      filesLast15m: s.workspace.changedLast15m,
      agent: project.agent?.brief() ?? null,
    };
  }

  function start() {
    try { fs.watch(OPENSPEC, { recursive: true }, () => schedule()); }
    catch (e) { console.warn(`[${id}] fs.watch unavailable, polling only:`, e.message); }
  }

  return Object.assign(project, { publish, schedule, cliDebounced, refreshCli, scanWorkspace, summary, start, openspecDir: OPENSPEC });
}

// ---------------------------------------------------------------- agent (opt-in with --agent)
// Runs the local `claude` command (Claude Code) in the project folder, so it uses Claude Code's own login.
//   ask:     claude -p, read-only tools (Read, Grep, Glob), no session kept; the answer streams into the panel
//   start:   claude -p with streaming JSON in and out, a fixed session id and the configured permission mode;
//            stdin stays open, so messages from the dashboard go straight to it; `claude --resume <id>` takes over
//   chat:    a read-only project assistant like ask, but one long-lived conversation (stream-json in and out,
//            resumed with --resume after an idle timeout or a restart of the process)
//   message: to a session started here via stdin, otherwise into the inbox that agent-hook.mjs delivers from
const children = new Set();
const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, extra });
const userLine = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n';
const modelArgs = () => (AGENT_MODEL ? ['--model', AGENT_MODEL] : []);
const readSync = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
// Claude Code ignores a project's permission rules until the folder was trusted once in an interactive session.
let trustCache = { mtime: 0, projects: {} };
function trusted(root) {
  const f = path.join(os.homedir(), '.claude.json');
  const st = fs.statSync(f, { throwIfNoEntry: false });
  if (!st) return null;
  if (st.mtimeMs !== trustCache.mtime) {
    try { trustCache = { mtime: st.mtimeMs, projects: JSON.parse(fs.readFileSync(f, 'utf8')).projects ?? {} }; } catch { return null; }
  }
  let real = root;
  try { real = fs.realpathSync(root); } catch { /* keep */ }
  return !!(trustCache.projects[real] ?? trustCache.projects[root])?.hasTrustDialogAccepted; // a trusted parent does not count
}

function createAgent(project) {
  const root = project.root;
  const jobs = [];
  let inbox = { messages: [], sessions: [] };
  let timer = null;
  let lastJson = '';
  const hookFile = path.join(HERE, 'agent-hook.mjs');
  const hooksInstalled = () => ['settings.local.json', 'settings.json'].some((f) => readSync(path.join(root, '.claude', f)).includes('agent-hook.mjs'));
  const liveSession = () => jobs.find((j) => j.kind === 'session' && j.child && (j.status === 'running' || j.status === 'idle'));
  const rel = (s) => String(s).split(root + path.sep).join('');

  function view() {
    const now = Date.now();
    return {
      permissionMode: AGENT_MODE, model: AGENT_MODEL, claude: CLAUDE, hooks: hooksInstalled(), trusted: trusted(root),
      stt: { available: stt.available, image: stt.image, language: STT_LANGUAGE },
      hookInstall: `node ${displayPath(hookFile)} install ${displayPath(root)}`,
      sessions: inbox.sessions.filter((x) => now - x.t < 12 * 3600e3).slice(0, 6),
      messages: inbox.messages,
      jobs: jobs.slice(-25).map(({ child, ...j }) => ({ ...j, log: j.log.slice(-250) })),
    };
  }
  function send() {
    const json = JSON.stringify(view());
    if (json === lastJson) return;
    lastJson = json;
    const payload = `event: agent\ndata: ${json}\n\n`;
    for (const res of project.clients) res.write(payload);
    overviewChanged();
  }
  const changed = (delay = 200) => { clearTimeout(timer); timer = setTimeout(send, delay); };
  const reloadInbox = () => { inbox = readInbox(root); changed(); };

  function push(job, kind, text, sub = false) {
    job.lastActivity = Date.now();
    job.log.push({ t: Date.now(), kind, text: String(text).slice(0, 6000), sub });
    if (job.log.length > 600) job.log.splice(0, job.log.length - 600);
  }
  const toolLine = (b) => {
    const i = b.input ?? {};
    const arg = b.name === 'Bash' ? (i.description || i.command) : (i.file_path || i.path || i.pattern || i.description || i.url || i.skill || '');
    return `${b.name}${arg ? ' · ' + rel(arg).slice(0, 180) : ''}`;
  };
  function onLine(job, line) {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    const sub = !!m.parent_tool_use_id;
    if (m.type === 'system' && m.subtype === 'init') { job.sessionId = m.session_id ?? job.sessionId; job.model = m.model ?? null; }
    else if (m.type === 'assistant') {
      for (const b of m.message?.content ?? []) {
        if (b.type === 'text' && b.text.trim()) push(job, 'text', b.text, sub);
        else if (b.type === 'tool_use') push(job, 'tool', toolLine(b), sub);
      }
    } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
      for (const b of m.message.content) {
        if (b.type !== 'tool_result' || !b.is_error) continue;
        const t = Array.isArray(b.content) ? b.content.map((x) => x.text ?? '').join(' ') : String(b.content ?? '');
        push(job, 'error', t.slice(0, 400), sub);
      }
    } else if (m.type === 'result') {
      job.turns = m.num_turns ?? job.turns;
      job.durationMs = (job.durationMs ?? 0) + (m.duration_ms ?? 0);
      if (job.kind === 'ask') {
        job.answer = m.result ?? '';
        job.status = m.is_error ? 'failed' : 'done';
        if (m.is_error) job.error = m.result || m.subtype;
      } else {
        if (m.is_error) push(job, 'error', `The turn ended with an error: ${m.result ?? m.subtype}`);
        if (job.child) job.status = 'idle';
      }
    }
    changed();
  }

  function launch(job, args, firstInput, keepOpen) {
    job.status = 'running';
    job.command = [path.basename(CLAUDE), ...args.map((a) => (a.length > 60 ? a.slice(0, 57) + '…' : a))].join(' ');
    let child;
    try {
      child = spawn(CLAUDE, args, { cwd: root, env: { ...process.env, OPENSPEC_DASHBOARD_JOB: job.id }, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { job.status = 'failed'; job.error = e.message; changed(0); return; }
    job.child = child;
    children.add(child);
    let buf = '';
    let err = '';
    child.stdout.on('data', (d) => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0;) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) onLine(job, l); }
    });
    child.stderr.on('data', (d) => {
      err = (err + d).slice(-4000);
      for (const l of String(d).split('\n').map((x) => x.trim()).filter(Boolean)) push(job, 'error', l);
      changed();
    });
    child.stdin.on('error', () => {});
    child.on('error', (e) => {
      job.status = 'failed';
      job.error = e.code === 'ENOENT' ? `"${CLAUDE}" was not found. Install Claude Code or pass --claude=<command>.` : e.message;
      changed(0);
    });
    child.on('close', (code) => {
      children.delete(child);
      job.child = null;
      job.endedAt = Date.now();
      if (job.status === 'running' || job.status === 'idle') {
        job.status = job.stopRequested ? 'stopped' : code === 0 ? 'done' : 'failed';
        if (job.status === 'failed' && !job.error) job.error = err.trim().split('\n').slice(-4).join('\n') || `claude exited with code ${code}`;
      }
      changed(0);
    });
    child.stdin.write(firstInput);
    if (!keepOpen) child.stdin.end();
    changed(0);
  }
  function newJob(kind, change, text) {
    const job = { id: randomBytes(5).toString('hex'), kind, change: change || null, text, status: 'starting', startedAt: Date.now(), log: [] };
    jobs.push(job);
    if (jobs.length > 60) jobs.splice(0, jobs.length - 60);
    return job;
  }
  const changeOf = (name) => (name ? project.state?.changes.find((c) => c.name === name) ?? null : null);
  const where = (c) => (c.location === 'backlog' ? `openspec/backlog/${c.name}.md (a draft, not elaborated yet)`
    : (c.files ?? []).map((f) => f.path).join(', ') || `openspec/changes/${c.name}/`);

  function ask({ change, question }) {
    if (!String(question ?? '').trim()) throw httpError(400, 'The question is empty.');
    if (jobs.filter((j) => j.kind === 'ask' && j.child).length >= 2) throw httpError(429, 'Two questions are running already; wait for one of them.');
    const c = changeOf(change);
    const job = newJob('ask', c?.name, question);
    const sys = [
      'You answer a question asked in the OpenSpec dashboard of this project. Work read-only: never change a file.',
      'OpenSpec lives in openspec/: roadmap.md (planned changes), backlog/ (drafts), changes/<name>/ (proposal.md, design.md, specs/, tasks.md), changes/archive/, specs/.',
      c ? `The question is about the change "${c.name}" (status: ${c.status}${c.tasks ? `, ${c.tasks.done}/${c.tasks.total} tasks checked` : ''}). Its files: ${where(c)}.` : 'The question is about the project as a whole.',
      'Read what you need, then answer briefly in Markdown, with file references where they help.',
    ].join('\n');
    launch(job, ['-p', '--output-format', 'stream-json', '--verbose', '--tools', 'Read,Grep,Glob', '--permission-prompts', 'none',
      '--no-session-persistence', '--append-system-prompt', sys, ...modelArgs()], String(question), false);
    return job;
  }

  function startPrompt(c) {
    if (AGENT_PROMPT) return AGENT_PROMPT.replaceAll('{change}', c.name);
    return [
      `Work on the OpenSpec change \`${c.name}\` as one ticket.`,
      'Follow the ticket workflow: the openspec-ticket-workflow skill if it is available, otherwise the workflow in openspec/config.yaml.',
      c.location === 'backlog' ? `It is still a draft in openspec/backlog/${c.name}.md.` : `Its files are in ${where(c)}; continue where it stands.`,
      'The user follows your progress in the OpenSpec dashboard and may send messages while you work; take them into account.',
      'Nobody can answer permission prompts in this session: if a step needs a permission you do not have, say so and stop at that step.',
    ].join('\n');
  }
  function start({ change, force }) {
    const c = changeOf(change);
    if (!c) throw httpError(404, `No change "${change}".`);
    if (c.status === 'archived' || c.status === 'parking') throw httpError(409, `${c.name} is ${c.status === 'archived' ? 'archived already' : 'the parking lot'}.`);
    const live = liveSession();
    if (live) throw httpError(409, `A session started here is still working on ${live.change}. End or stop it first.`);
    if (!force) {
      const reasons = [];
      const open = project.state.changes.filter((x) => x.name !== c.name && ['in-progress', 'specified', 'complete'].includes(x.status));
      if (open.length) reasons.push(`${open.map((x) => x.name).join(', ')} ${open.length > 1 ? 'have' : 'has'} work that is not archived yet (one ticket at a time).`);
      if (c.blockedBy?.length) reasons.push(`It waits for ${c.blockedBy.map((o) => '#' + o).join(', ')}.`);
      const ext = inbox.sessions.find((x) => !x.ended && !x.dashboardJob && Date.now() - x.t < 3 * 60e3);
      if (ext) reasons.push(`Another Claude Code session was active here ${Math.round((Date.now() - ext.t) / 1000)} s ago.`);
      if (reasons.length) throw httpError(409, reasons.join(' '), { needsForce: true });
    }
    const job = newJob('session', c.name, null);
    job.sessionId = randomUUID();
    job.prompt = startPrompt(c);
    push(job, 'prompt', job.prompt);
    launch(job, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--session-id', job.sessionId,
      '--permission-mode', AGENT_MODE, '--permission-prompts', 'none', '-n', `ticket ${c.name}`, ...modelArgs()], userLine(job.prompt), true);
    return job;
  }

  // ---- chat: the project assistant, independent of a ticket
  const liveChat = () => jobs.find((j) => j.kind === 'chat' && j.child);
  function chatSystem() {
    const st = project.state;
    const active = st?.changes.filter((c) => ['in-progress', 'complete', 'specified'].includes(c.status)) ?? [];
    const status = st ? [
      `${st.changes.filter(isDone).length} of ${st.changes.filter((c) => c.status !== 'parking').length} changes done, ${st.totals.done}/${st.totals.total} tasks checked.`,
      active.length ? `Work not archived yet: ${active.map((c) => `${c.name} (${c.status}${c.tasks ? `, ${c.tasks.done}/${c.tasks.total} tasks` : ''})`).join(', ')}.` : '',
      st.nextUp ? `Next ticket the roadmap allows: ${st.nextUp}.` : '',
    ].filter(Boolean).join(' ') : '';
    return [
      `You are the project assistant in the OpenSpec dashboard of the project "${project.name}". The user chats with you about the project: its plan, specs, code, progress and ideas.`,
      'Work read-only: read and search files, never change them. When the user wants something built or changed, suggest starting a session on a ticket (from the ticket in the dashboard) or sending a message to the session that works on it.',
      'OpenSpec lives in openspec/: roadmap.md (planned changes, milestones), backlog/ (drafts), changes/<name>/ (proposal.md, design.md, specs/, tasks.md), changes/archive/, specs/ (current specs).',
      status && `Status when this chat started: ${status}`,
      'Answer like in a chat: short, in Markdown, with file references where they help.',
    ].filter(Boolean).join('\n');
  }
  function chat({ text, fresh }) {
    text = String(text ?? '').trim();
    if (!text) throw httpError(400, 'The message is empty.');
    let job = liveChat();
    if (job && fresh) { job.child.stdin.end(); job = null; }
    if (job) {
      push(job, 'user', text);
      job.status = 'running';
      job.child.stdin.write(userLine(text));
      changed(0);
      return { job: job.id };
    }
    const prev = fresh ? null : [...jobs].reverse().find((j) => j.kind === 'chat');
    job = newJob('chat', null, null);
    push(job, 'user', text);
    const base = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', 'Read,Grep,Glob',
      '--permission-prompts', 'none', ...modelArgs()];
    if (prev?.sessionId) {
      job.sessionId = prev.sessionId;
      job.resumedFrom = prev.id;
      launch(job, [...base, '--resume', prev.sessionId], userLine(text), true);
    } else {
      job.sessionId = randomUUID();
      launch(job, [...base, '--session-id', job.sessionId, '-n', `dashboard chat ${project.name}`, '--append-system-prompt', chatSystem()], userLine(text), true);
    }
    return { job: job.id };
  }
  // an idle chat process ends after 20 minutes; the next message resumes the same conversation
  setInterval(() => {
    for (const j of jobs) if (j.kind === 'chat' && j.child && j.status === 'idle' && Date.now() - (j.lastActivity ?? 0) > 20 * 60e3) j.child.stdin.end();
  }, 60e3);

  function message({ change, text, job: jobId, to }) {
    text = String(text ?? '').trim();
    if (!text) throw httpError(400, 'The message is empty.');
    const msg = { id: `${Date.now()}-${randomBytes(3).toString('hex')}`, change: change || null, text, t: Date.now() };
    const target = jobId ? jobs.find((j) => j.id === jobId) : null;
    if (target && target.kind === 'session' && !target.child) {
      // the session has ended: continue it with this message
      if (liveSession()) throw httpError(409, 'Another session started here is still running.');
      const job = newJob('session', target.change, null);
      job.sessionId = target.sessionId;
      job.resumedFrom = target.id;
      push(job, 'user', text);
      launch(job, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--resume', target.sessionId,
        '--permission-mode', AGENT_MODE, '--permission-prompts', 'none', ...modelArgs()], userLine(formatMessages([msg])), true);
      recordDelivered(root, { ...msg, deliveredAt: Date.now(), sessionId: job.sessionId, via: 'resumed session' });
      reloadInbox();
      return { delivered: true, job: job.id };
    }
    const live = to === 'inbox' ? null : target?.child ? target : liveSession();
    if (live) {
      live.child.stdin.write(userLine(formatMessages([msg])));
      live.status = 'running';
      push(live, 'user', text);
      recordDelivered(root, { ...msg, deliveredAt: Date.now(), sessionId: live.sessionId, via: 'dashboard session' });
      reloadInbox();
      return { delivered: true, job: live.id };
    }
    queueMessage(root, msg);
    reloadInbox();
    return { queued: true };
  }

  function control({ job: jobId, action }) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job?.child) throw httpError(409, 'That session is not running.');
    if (action === 'end') { job.child.stdin.end(); push(job, 'note', 'Ended from the dashboard: it finishes the current turn, then exits.'); }
    else {
      job.stopRequested = true;
      job.child.kill('SIGINT');
      const child = job.child;
      setTimeout(() => { if (children.has(child)) child.kill('SIGTERM'); }, 5000);
    }
    changed(0);
    return { ok: true };
  }
  function cancel({ id }) {
    if (!cancelMessage(root, String(id ?? ''))) throw httpError(409, 'The message was delivered already.');
    reloadInbox();
    return { ok: true };
  }
  function brief() {
    const now = Date.now();
    return {
      running: jobs.filter((j) => j.child).length,
      session: liveSession()?.change ?? null,
      external: inbox.sessions.some((x) => !x.ended && !x.dashboardJob && now - x.t < 3 * 60e3),
      queued: inbox.messages.filter((m) => m.state === 'queued').length,
    };
  }
  function startWatching() {
    const dir = inboxDir(root);
    fs.mkdirSync(dir, { recursive: true });
    let t = null;
    try { fs.watch(dir, { recursive: true }, () => { clearTimeout(t); t = setTimeout(reloadInbox, 150); }); } catch { /* the interval below still runs */ }
    setInterval(reloadInbox, 10000);
    reloadInbox();
  }
  sttListeners.add(() => changed(0));
  return { view, ask, chat, start, message, control, cancel, brief, startWatching };
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { for (const c of children) { try { c.kill('SIGTERM'); } catch { /* gone */ } } process.exit(0); });
}

// ---------------------------------------------------------------- speech to text (with --agent)
// Detects a container image whose entrypoint is whisper.cpp's whisper-cli with a model (-m ...), in Podman or Docker,
// or takes --stt-image. A recording (16 kHz mono 16-bit WAV from the browser) goes in on stdin of a throwaway
// container without network, with a read-only root and memory limits; the text comes back to the browser only.
const stt = { available: false, image: null, engine: null, threads: 4, checkedAt: null, error: null };
const sttListeners = new Set();
const run = (cmd, args, { input = null, timeout = 30000 } = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = Buffer.alloc(0), err = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
  child.stdout.on('data', (d) => { out = Buffer.concat([out, d]); });
  child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
  child.on('error', (e) => { clearTimeout(timer); reject(e); });
  child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out.toString('utf8')) : reject(new Error(err.trim().split('\n').slice(-2).join(' ') || `exit code ${code}`)); });
  child.stdin.on('error', () => {});
  if (input) child.stdin.end(input); else child.stdin.end();
});
async function detectStt() {
  const before = JSON.stringify(stt);
  try {
    let engine = null;
    for (const e of ['podman', 'docker']) { try { await run(e, ['--version'], { timeout: 10000 }); engine = e; break; } catch { /* next */ } }
    if (!engine) throw new Error('Neither Podman nor Docker found.');
    const isWhisper = async (img) => {
      const ep = await run(engine, ['image', 'inspect', '--format', '{{json .Config.Entrypoint}}', img]).catch(() => 'null');
      const a = JSON.parse(ep.trim() || 'null') ?? [];
      return a.some((x) => /whisper-cli$/.test(x)) && a.includes('-m');
    };
    let image = null;
    if (STT_IMAGE_ARG) {
      if (!(await isWhisper(STT_IMAGE_ARG))) throw new Error(`${STT_IMAGE_ARG}: not found, or its entrypoint is not whisper-cli with -m <model>.`);
      image = STT_IMAGE_ARG;
    } else {
      const raw = await run(engine, ['images', '--format', 'json']);
      let list;
      try { list = JSON.parse(raw || '[]'); } catch { list = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)); } // Docker: one object per line
      const cands = list.flatMap((i) => (i.Names ?? i.RepoTags ?? (i.Repository ? [`${i.Repository}:${i.Tag}`] : [])).filter((n) => /whisper/i.test(n) && !/<none>/.test(n)).map((n) => ({ n, t: i.Created ?? 0 })))
        .sort((a, b) => b.t - a.t);
      for (const c of cands) if (await isWhisper(c.n)) { image = c.n; break; }
    }
    // threads: the CPUs the containers really get (Podman's VM on macOS/Windows), at most 4 (more were slower)
    let cpus = os.availableParallelism?.() ?? 4;
    if (engine === 'podman' && process.platform !== 'linux') {
      cpus = Number((await run('podman', ['machine', 'inspect', '--format', '{{.Resources.CPUs}}']).catch(() => '')).trim().split('\n')[0]) || cpus;
    }
    Object.assign(stt, { available: !!image, image, engine, threads: Math.max(1, Math.min(4, cpus)), error: image ? null : 'No whisper-cli image found.' });
  } catch (e) {
    Object.assign(stt, { available: false, image: null, error: e.message });
  }
  stt.checkedAt = Date.now();
  const { checkedAt, ...a } = JSON.parse(before);
  const { checkedAt: _, ...b } = stt;
  if (JSON.stringify(a) !== JSON.stringify(b)) for (const fn of sttListeners) fn();
}
let sttQueue = Promise.resolve();
// Speed: a fixed language saves Whisper's language detection (a full extra encoder pass), and an audio context sized to
// a short clip (-ac; 50 frames per second, 1500 = the full 30 s window) cuts the encoder's work: ~4 s instead of ~30 s.
function transcribe(wav, lang = STT_LANGUAGE) {
  if (!stt.available) return Promise.reject(httpError(409, 'No speech-to-text image is available.'));
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') return Promise.reject(httpError(400, 'Expected a WAV recording.'));
  const seconds = (wav.length - 44) / 32000;
  // language detection needs the full window: with a short one it returns garbage
  const ac = lang !== 'auto' && seconds <= 27 ? Math.max(384, Math.ceil(seconds * 50) + 128) : 0;
  if (!/^(auto|[a-z]{2,3})$/.test(lang)) return Promise.reject(httpError(400, 'Unknown language.'));
  const args = ['run', '--rm', '-i', '--pull=never', '--network=none', '--read-only', '--tmpfs', '/tmp:rw,size=16m,mode=1777',
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=3g', '--pids-limit=64', '--log-driver=none',
    stt.image, '-t', String(stt.threads), '-l', lang, '-ac', String(ac),
    '-sns', '-np', '-nt', '-of', '/tmp/transcript', '-f', '-'];
  const job = () => run(stt.engine, args, { input: wav, timeout: 120000 + seconds * 3000 }).then((out) => out.split('\n')
    .map((l) => l.replace(/^\s*\[[^\]]*-->[^\]]*\]\s*/, '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim());
  const p = sttQueue.then(job);
  sttQueue = p.catch(() => {});
  return p;
}

// ---------------------------------------------------------------- which projects
async function findProjects(dir, depth = 3) {
  const out = [];
  async function go(d, level) {
    if (await exists(path.join(d, 'openspec'))) { out.push(d); return; }
    if (level >= depth) return;
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || WORKSPACE_EXCLUDES.has(e.name)) continue;
      await go(path.join(d, e.name), level + 1);
    }
  }
  await go(path.resolve(dir), 0);
  return out;
}

const roots = [];
for (const p of [...positional, ...optList('project')]) roots.push(path.resolve(p));
for (const d of optList('scan')) roots.push(...(await findProjects(d)).sort());
if (!roots.length) roots.push(process.cwd());
const uniqueRoots = [...new Set(roots)].filter((r) => {
  if (fs.existsSync(path.join(r, 'openspec'))) return true;
  console.warn(`Skipping ${r}: no openspec/ directory.`);
  return false;
});
if (!uniqueRoots.length) {
  console.error('No project with an openspec/ directory. Pass <project-dir>, --project=<dir> or --scan=<dir>.');
  process.exit(1);
}

const historyArg = typeof opt('history') === 'string' ? path.resolve(opt('history')) : null;
const historyFor = (root) => {
  const file = `${path.basename(root)}-${createHash('sha256').update(root).digest('hex').slice(0, 8)}.json`;
  if (historyArg) return uniqueRoots.length === 1 && historyArg.endsWith('.json') ? historyArg : path.join(historyArg, file);
  return path.join(STATE_DIR, file);
};

const overviewClients = new Set();
let overviewTimer = null;
function overviewChanged() {
  clearTimeout(overviewTimer);
  overviewTimer = setTimeout(() => {
    if (!overviewClients.size) return;
    const payload = `data: ${JSON.stringify(overview())}\n\n`;
    for (const res of overviewClients) res.write(payload);
  }, 200);
}

const projects = [];
const usedIds = new Set();
for (const root of uniqueRoots) {
  const base = path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  let pid = base;
  for (let n = 2; usedIds.has(pid); n++) pid = `${base}-${n}`;
  usedIds.add(pid);
  const p = createProject(root, pid, historyFor(root), overviewChanged);
  p.agent = AGENT ? createAgent(p) : null;
  projects.push(p);
}
const byId = new Map(projects.map((p) => [p.id, p]));
const projectFor = (url) => byId.get(url.searchParams.get('project')) ?? projects[0];
const overview = () => ({ scannedAt: Date.now(), projects: projects.map((p) => p.summary()) });

// ---------------------------------------------------------------- timers
setInterval(() => projects.forEach((p) => p.schedule(0)), 5000);                 // safety net for missed events
setInterval(async () => { for (const p of projects) { await p.scanWorkspace(); p.schedule(0); } }, 10000);
setInterval(() => projects.forEach((p) => p.cliDebounced()), 60000);              // validation also follows schema/config
setInterval(() => {
  for (const p of projects) for (const res of p.clients) res.write(': ping\n\n');
  for (const res of overviewClients) res.write(': ping\n\n');
}, 20000);

// ---------------------------------------------------------------- HTTP
const INDEX = path.join(HERE, 'index.html');
const sse = (res) => res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };

// With --agent the page carries a token for the agent actions; only pages served under our own host name get it
// (no DNS rebinding), and only requests from such a page (same Origin, token header) may start anything.
const OWN_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) throw httpError(413, 'Too large.'); }
  try { return JSON.parse(raw || '{}'); } catch { throw httpError(400, 'Expected JSON.'); }
}
const AGENT_ACTIONS = { ask: 'ask', chat: 'chat', start: 'start', message: 'message', control: 'control', cancel: 'cancel' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (AGENT && !OWN_HOSTS.has(req.headers.host)) { res.writeHead(403); return res.end('unknown host'); }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      const html = await fsp.readFile(INDEX, 'utf8');
      return res.end(AGENT ? html.replace('<meta name="osd-agent" content="">', `<meta name="osd-agent" content="${TOKEN}">`) : html);
    }
    if (url.pathname === '/api/stt' && req.method === 'POST') {
      if (!AGENT) { res.writeHead(404); return res.end('start the dashboard with --agent'); }
      const origin = req.headers.origin;
      if (req.headers['x-osd-token'] !== TOKEN || (origin && !OWN_HOSTS.has(new URL(origin).host))) { res.writeHead(403); return res.end('forbidden'); }
      const chunks = [];
      let size = 0;
      for await (const c of req) { size += c.length; if (size > 40e6) { res.writeHead(413); return res.end('recording too long'); } chunks.push(c); }
      const t0 = Date.now();
      try {
        const text = await transcribe(Buffer.concat(chunks), url.searchParams.get('lang') || STT_LANGUAGE);
        return json(res, { text, ms: Date.now() - t0 });
      } catch (e) {
        res.writeHead(e.status ?? 500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    }
    if (url.pathname.startsWith('/api/agent')) {
      if (!AGENT) { res.writeHead(404); return res.end('start the dashboard with --agent'); }
      const p = projectFor(url);
      if (url.pathname === '/api/agent' && req.method === 'GET') return json(res, p.agent.view());
      const action = AGENT_ACTIONS[url.pathname.slice('/api/agent/'.length)];
      const origin = req.headers.origin;
      if (!action || req.method !== 'POST') { res.writeHead(404); return res.end('not found'); }
      if (req.headers['x-osd-token'] !== TOKEN || (origin && !OWN_HOSTS.has(new URL(origin).host))) { res.writeHead(403); return res.end('forbidden'); }
      try {
        const out = p.agent[action](await readBody(req));
        return json(res, out.log ? { id: out.id } : out);
      } catch (e) {
        if (!e.status) throw e;
        res.writeHead(e.status, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message, ...e.extra }));
      }
    }
    if (url.pathname === '/api/projects') return json(res, overview());
    if (url.pathname === '/api/state') {
      const p = projectFor(url);
      return json(res, { rev: p.rev, scannedAt: Date.now(), ...p.state });
    }
    if (url.pathname === '/events') {
      sse(res);
      if (url.searchParams.has('overview')) {
        res.write(`retry: 2000\ndata: ${JSON.stringify(overview())}\n\n`);
        overviewClients.add(res);
        req.on('close', () => overviewClients.delete(res));
        return;
      }
      const p = projectFor(url);
      res.write(`retry: 2000\nid: ${p.rev}\ndata: ${JSON.stringify({ rev: p.rev, scannedAt: Date.now(), ...p.state })}\n\n`);
      if (p.agent) res.write(`event: agent\ndata: ${JSON.stringify(p.agent.view())}\n\n`);
      p.clients.add(res);
      req.on('close', () => p.clients.delete(res));
      return;
    }
    if (url.pathname === '/api/file') {
      const p = projectFor(url);
      const file = path.resolve(p.root, url.searchParams.get('path') ?? '');
      if (!file.startsWith(p.openspecDir + path.sep) || !file.endsWith('.md')) { res.writeHead(400); return res.end('only openspec/**/*.md'); }
      const text = await readText(file);
      if (text === null) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(text);
    }
    if (url.pathname === '/api/refresh' && req.method === 'POST') {
      const p = projectFor(url);
      await p.scanWorkspace();
      await p.refreshCli();
      await p.publish();
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(404);
    res.end('not found');
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});

for (const p of projects) { await p.scanWorkspace(); await p.publish(); p.start(); p.agent?.startWatching(); }
if (USE_STT) { detectStt().then(() => console.log(`  Voice input: ${stt.available ? `${stt.engine} image ${stt.image}` : `off (${stt.error})`}`)); setInterval(detectStt, 60000); }
server.listen(PORT, HOST, () => {
  const link = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`;
  console.log(`OpenSpec dashboard\n  ${link}\n  CLI: ${USE_CLI ? CLI : 'disabled'}`);
  if (AGENT) console.log(`  Agent: ${CLAUDE} (permission mode ${AGENT_MODE}${AGENT_MODEL ? `, model ${AGENT_MODEL}` : ''})`);
  for (const p of projects) console.log(`  ${p.id.padEnd(24)} ${p.root}`);
  if (!opt('no-open') && process.platform === 'darwin') spawn('open', [link], { stdio: 'ignore', detached: true }).unref();
});
for (const p of projects) p.refreshCli().then((ran) => ran && p.publish());
