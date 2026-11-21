#!/usr/bin/env node
// OpenSpec progress dashboard — zero dependencies, Node >= 20.
//
//   node server.mjs [<project-dir> ...] [--project=<dir> ...] [--scan=<dir> ...]
//                  [--port=4590] [--host=127.0.0.1] [--cli=<command>] [--no-cli]
//                  [--parking-lot=<change>] [--history=<file-or-dir>] [--no-open]
//
// Follows one or more projects (each a folder with openspec/). Without arguments it follows the current folder;
// --scan finds every project with an openspec/ folder up to three levels below the given folder.
// Per project it reads openspec/ (roadmap.md, backlog/, changes/**, changes/archive) on every file change,
// enriches it with the OpenSpec CLI (`openspec validate --all --json`, `openspec list --json`) and pushes the
// result to the browser over Server-Sent Events. The CLI is `openspec` from PATH unless --cli or OPENSPEC_CLI names
// another command; calls are queued across projects, one at a time. Task check-offs observed while the server runs
// are kept per project in a history file outside the project (default: $XDG_STATE_HOME or ~/.local/state, under
// openspec-dashboard/), so the activity feed and the chart survive restarts.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';

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
    };
  }

  function start() {
    try { fs.watch(OPENSPEC, { recursive: true }, () => schedule()); }
    catch (e) { console.warn(`[${id}] fs.watch unavailable, polling only:`, e.message); }
  }

  return Object.assign(project, { publish, schedule, cliDebounced, refreshCli, scanWorkspace, summary, start, openspecDir: OPENSPEC });
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
  projects.push(createProject(root, pid, historyFor(root), overviewChanged));
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(await fsp.readFile(INDEX));
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

for (const p of projects) { await p.scanWorkspace(); await p.publish(); p.start(); }
server.listen(PORT, HOST, () => {
  const link = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`;
  console.log(`OpenSpec dashboard\n  ${link}\n  CLI: ${USE_CLI ? CLI : 'disabled'}`);
  for (const p of projects) console.log(`  ${p.id.padEnd(24)} ${p.root}`);
  if (!opt('no-open') && process.platform === 'darwin') spawn('open', [link], { stdio: 'ignore', detached: true }).unref();
});
for (const p of projects) p.refreshCli().then((ran) => ran && p.publish());
