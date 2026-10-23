// Hooks
// =====
// Claude Code's hooks (https://code.claude.com/docs/en/hooks) on a
// device's tools, whatever vendor the agent runs on: before a tool acts,
// the PreToolUse hooks its Claude Code equivalent matches run, as Claude
// Code runs them, and may deny it, change its input or add context;
// after it succeeds, the PostToolUse ones may add feedback or replace
// what the agent reads. So a guard written for Claude Code (a script
// that exits 2, or prints a deny) guards unii too, unchanged.
//
// The tools as Claude Code knows them (CALLS): shell is Bash (PowerShell
// on Windows), read and view_video Read, write Write, edit Edit (one
// change to a file) or MultiEdit (several, in the old MultiEdit shape:
// file_path, edits of old_string, new_string, replace_all), one call per
// file it touches; an MCP server's tools/call on the device
// mcp__<server>__<tool> (a plugin's: mcp__plugin_<plugin>_<server>__).
// File paths absolute, as Claude Code gives them.
//
// Where hooks come from, as Claude Code reads them: the managed tier
// (the server-managed cache, ~/.claude/remote-settings.json, then the
// managed settings files, managed-settings.json and managed-settings.d/;
// the first that sets a policy key, unless one asks to merge), the user's
// ~/.claude/settings.json, the project's .claude/settings.json and
// settings.local.json (the project: the git root of the file a tool acts
// on, else the job's dir), and the enabled plugins' (hooks/hooks.json and
// their manifest's hooks). disableAllHooks and allowManagedHooksOnly as
// the docs say: what a managed source sets wins, plugins the managed
// tier force-enables keep their hooks. A handler in several settings
// files runs once.
//
// Command hooks run as Claude Code runs them (shell form by bash, else
// sh; exec form with args; ${CLAUDE_PROJECT_DIR}, ${CLAUDE_PLUGIN_ROOT},
// ${CLAUDE_PLUGIN_DATA} substituted and set; the event's JSON on stdin;
// timeout, async, onFailure); http hooks POST it. Exit 2 blocks, its
// stderr the reason; JSON on stdout decides (permissionDecision,
// updatedInput, additionalContext, continue); deny > defer > ask > allow.
// No one answers on a device, so ask and defer block too, saying a hook
// wanted a person to confirm (a choice of ours: the docs' "-p" runs,
// where no one can answer, deny the call the same way). prompt, agent
// and mcp_tool hooks need Claude Code itself: skipped, said on stderr.
// Not here: SessionStart and the other events (Machine has no session);
// the MDM plist and Windows registry managed sources; permission rules.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Out } from "./Agent.ts";
import type { Job } from "./Machine.ts";

// Types
// =====

// a hook handler and the group it is in, as settings write them
type Handler = { type?: string; command?: string; args?: string[]; shell?: string; timeout?: number; async?: boolean; asyncRewake?: boolean; onFailure?: string; url?: string; headers?: Record<string, string>; allowedEnvVars?: string[]; if?: string };
type Group = { matcher?: string; hooks?: Handler[] };
type Events = Record<string, Group[]>;
type Settings = { hooks?: Events; disableAllHooks?: boolean; allowManagedHooksOnly?: boolean; enabledPlugins?: Record<string, boolean>; managedSourcesBehavior?: string };

// a hook as loaded: its event, its group's matcher, its handler, where
// it came from (a plugin: its root and data dir), the key it runs once by
type Hook = { event: string; matcher: string; h: Handler; from: "managed" | "settings" | "plugin"; root: string; data: string; key: string };

// a tool call as Claude Code names and shapes it
export type Call = { tool: string; input: any; mcp?: { name: string; source: string } };

// a job's calls, how their inputs (as hooks may change them) make the
// job's input again, and the project they act in
type Calls = { calls: Call[]; back: (inputs: any[]) => any; project: string };

// what one hook said: a decision, its reason, a new input, context for
// the agent, a stop; failed: why the hook didn't run well
type Said = { decision?: string; reason?: string; input?: any; context?: string; stop?: string; failed?: string; block?: string };

// where hooks are read: the home dir, the managed settings dir
export type Where = { home: string; managed: string };

// Constants
// =========

const WIN = process.platform === "win32";

const MANAGED: Record<string, string> = {
  linux  : "/etc/claude-code",
  darwin : "/Library/Application Support/ClaudeCode",
  win32  : "C:\\Program Files\\ClaudeCode",
};

// this machine's, read at each call
export function where(): Where {
  return { home: os.homedir(), managed: MANAGED[process.platform] ?? MANAGED.linux };
}

// a command hook's timeout by default (s); the decisions, the strongest
// first
const TIMEOUT = 600;
const RANK = ["deny", "defer", "ask", "allow"];

// what the agent reads of a hook's say, at most (the docs' cap)
const CAP = 10000;

// Hooks
// =====

// a job under the hooks its tool matches: the PreToolUse ones first (a
// block ends it there, said as the tool's failure), then the job, with
// the input they left, then, if it went well, the PostToolUse ones
export async function around(job: Job, cwd: string, signal: AbortSignal, act: (input: any) => Promise<Out>, at: Where = where()): Promise<Out> {
  const c = calls(job, cwd);
  if (c === null) {
    return act(job.input);
  }
  const hooks = load(at, c.project);
  const base = { session_id: "unii-" + path.basename(cwd), transcript_path: "", cwd, permission_mode: "bypassPermissions", ...agent(cwd) };
  const env = { ...process.env, CLAUDE_PROJECT_DIR: c.project };
  const ids = c.calls.map(() => "toolu_unii_" + crypto.randomUUID().replaceAll("-", ""));
  const pre = await Promise.all(c.calls.map((call, k) => fire(hooks, "PreToolUse", call, { ...base, hook_event_name: "PreToolUse", tool_name: call.tool, tool_input: call.input, tool_use_id: ids[k], ...(call.mcp ? { mcp_server: call.mcp } : {}) }, env, cwd, signal)));
  const blocked = pre.flatMap((said, k) => verdict(said, c.calls[k].tool));
  if (blocked.length > 0) {
    return deny(job, blocked.join("\n\n"));
  }
  const inputs = pre.map((said, k) => said.find((s) => s.input !== undefined && s.decision !== "deny")?.input ?? c.calls[k].input);
  const input = inputs.some((x, k) => x !== c.calls[k].input) ? c.back(inputs) : job.input;
  const before = pre.flatMap((said, k) => said.flatMap((s) => (s.context ? [c.calls[k].tool + " PreToolUse hook additional context: " + s.context.slice(0, CAP)] : [])));
  let out = await act(input);
  if (out.fail) {
    return note(job, out, before);
  }
  const done = calls({ ...job, input }, cwd) ?? c;
  const post = await Promise.all(done.calls.map((call, k) => fire(hooks, "PostToolUse", call, { ...base, hook_event_name: "PostToolUse", tool_name: call.tool, tool_input: call.input, tool_response: response(call, out), tool_use_id: ids[k] ?? ids[0], ...(call.mcp ? { mcp_server: call.mcp } : {}) }, env, cwd, signal)));
  const after: string[] = [];
  post.forEach((said, k) => said.forEach((s) => {
    const tool = done.calls[k].tool;
    if (s.input !== undefined && typeof (s.input.stdout ?? s.input.text ?? s.input) === "string") {
      out = { ...out, text: String(s.input.stdout ?? s.input.text ?? s.input) };
    }
    after.push(...[s.block && tool + " PostToolUse hook error: " + s.block, s.reason && tool + " PostToolUse hook feedback: " + s.reason, s.context && tool + " PostToolUse hook additional context: " + s.context, s.stop && tool + " PostToolUse hook stopped: " + s.stop].filter((x): x is string => !!x).map((x) => x.slice(0, CAP)));
  }));
  return note(job, out, [...before, ...after]);
}

// the hooks' notes for the agent, after the tool's own answer (an MCP
// answer: as text after its content)
function note(job: Job, out: Out, notes: string[]): Out {
  if (notes.length === 0) {
    return out;
  }
  if (job.name === "mcp") {
    const got = JSON.parse(out.text);
    const content = [...(got.result?.content ?? []), ...notes.map((text) => ({ type: "text", text }))];
    return got.result === undefined ? out : { ...out, text: JSON.stringify({ ...got, result: { ...got.result, content } }) };
  }
  return { ...out, text: out.text + "\n\n" + notes.join("\n\n") };
}

// a job a hook blocked: its failure, the reason (an MCP call: the tool's
// error, as its server would answer it)
function deny(job: Job, why: string): Out {
  if (job.name === "mcp") {
    return { text: JSON.stringify({ result: { content: [{ type: "text", text: why }], isError: true }, changed: false }), fail: false };
  }
  return { text: why, fail: true };
}

// a subagent's job: who it is, as Claude Code tells a hook in one
function agent(cwd: string): object {
  const name = path.basename(cwd);
  return name === "main" ? {} : { agent_id: name, agent_type: "unii-agent" };
}

// Calls
// -----

// a job's tool calls as Claude Code's (null: a job no hook sees)
export function calls(job: Job, cwd: string): Calls | null {
  const input = job.input ?? {};
  const abs = (p: unknown) => path.resolve(cwd, String(p).replace(/^~(?=[/\\]|$)/, os.homedir()));
  switch (job.name) {
    case "shell": {
      return { calls: [{ tool: WIN ? "PowerShell" : "Bash", input: { command: String(input.command) } }], back: ([i]) => ({ ...input, command: String(i.command ?? input.command) }), project: root(cwd) };
    }
    case "read":
    case "view_video": {
      const call = { file_path: abs(input.path), ...(input.offset === undefined ? {} : { offset: input.offset }), ...(input.limit === undefined ? {} : { limit: input.limit }) };
      return { calls: [{ tool: "Read", input: call }], back: ([i]) => ({ ...input, path: String(i.file_path ?? input.path), ...(i.offset === undefined ? {} : { offset: i.offset }), ...(i.limit === undefined ? {} : { limit: i.limit }) }), project: root(path.dirname(call.file_path)) };
    }
    case "write": {
      const file = abs(input.path);
      return { calls: [{ tool: "Write", input: { file_path: file, content: String(input.content) } }], back: ([i]) => ({ ...input, path: String(i.file_path ?? input.path), content: String(i.content ?? input.content) }), project: root(path.dirname(file)) };
    }
    case "edit": {
      const edits: any[] = Array.isArray(input.edits) ? input.edits : [];
      const files = [...new Set(edits.map((e) => abs(e?.path)))];
      const one = (e: any) => ({ old_string: String(e?.old ?? ""), new_string: String(e?.new ?? ""), replace_all: e?.all === true });
      const calls = files.map((file): Call => {
        const mine = edits.filter((e) => abs(e?.path) === file);
        return mine.length === 1 ? { tool: "Edit", input: { file_path: file, ...one(mine[0]) } } : { tool: "MultiEdit", input: { file_path: file, edits: mine.map(one) } };
      });
      const unone = (file: string, e: any) => ({ path: file, old: String(e.old_string ?? ""), new: String(e.new_string ?? ""), ...(e.replace_all === true ? { all: true } : {}) });
      const back = (inputs: any[]) => ({ ...input, edits: inputs.flatMap((i, k) => (Array.isArray(i.edits) ? i.edits.map((e: any) => unone(String(i.file_path ?? files[k]), e)) : [unone(String(i.file_path ?? files[k]), i)])) });
      return { calls, back, project: root(path.dirname(files[0] ?? cwd)) };
    }
    case "mcp": {
      if (input.method !== "tools/call") {
        return null;
      }
      const name = String(input.conf?.claude ?? input.conf?.name ?? "mcp");
      const [plugin, server] = name.includes(":") ? name.split(":") : [null, name];
      const tool = "mcp__" + (plugin === null ? server : "plugin_" + plugin + "_" + server) + "__" + String(input.params?.name);
      const call = { tool, input: input.params?.arguments ?? {}, mcp: { name: plugin === null ? server : "plugin:" + plugin + ":" + server, source: plugin === null ? "user" : "plugin" } };
      return { calls: [call], back: ([i]) => ({ ...input, params: { ...input.params, arguments: i } }), project: root(cwd) };
    }
  }
  return null;
}

// a dir's project: the git root above it, else the dir
function root(dir: string): string {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) {
      return d;
    }
    if (path.dirname(d) === d) {
      return path.resolve(dir);
    }
  }
}

// what a tool answered, as a PostToolUse hook gets it (Claude Code's
// shapes, as near as unii's answers give them)
function response(call: Call, out: Out): unknown {
  if (call.tool === "Bash" || call.tool === "PowerShell") {
    return { stdout: out.text, stderr: "", interrupted: false, isImage: false };
  }
  if (call.tool.startsWith("mcp__")) {
    return JSON.parse(out.text).result ?? {};
  }
  return { filePath: call.input.file_path, ...(call.tool === "Write" ? { type: "update", content: call.input.content } : {}), text: out.text };
}

// Loading
// -------

// the hooks that apply in a project, from every source, as Claude Code
// combines them
export function load(where: Where, project: string): Hook[] {
  const claude = path.join(where.home, ".claude");
  const managed = managed_settings(where);
  const mine = [path.join(claude, "settings.json"), path.join(project, ".claude", "settings.json"), path.join(project, ".claude", "settings.local.json")].map(read);
  // the value left after precedence: local, project, user
  const off = [...mine].reverse().map((s) => s.disableAllHooks).find((x) => x !== undefined) === true;
  if (managed.disableAllHooks === true) {
    return [];
  }
  const only = managed.allowManagedHooksOnly === true;
  const forced = new Set(Object.entries(managed.enabledPlugins ?? {}).filter(([, on]) => on === true).map(([key]) => key));
  const enabled = Object.assign({}, ...mine.map((s) => s.enabledPlugins ?? {}), managed.enabledPlugins ?? {}) as Record<string, boolean>;
  const hooks = [
    ...events(managed.hooks, "managed", "", ""),
    ...(only || off ? [] : mine.flatMap((s) => events(s.hooks, "settings", "", ""))),
    ...Object.entries(enabled).filter(([key, on]) => on === true && (forced.has(key) || !(only || off))).flatMap(([key]) => plugin_hooks(claude, key, project)),
  ];
  return hooks.filter((h, k) => h.from === "plugin" || hooks.findIndex((x) => x.from !== "plugin" && x.key === h.key) === k);
}

// the managed tier: each source's settings, the first that sets a
// policy key (a key besides managedSourcesBehavior and
// wslInheritsWindowsSettings), or all merged if one asks to
export function managed_settings(where: Where): Settings {
  const dir = path.join(where.managed, "managed-settings.d");
  const parts = (() => {
    try {
      return fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith(".")).sort().map((f) => path.join(dir, f));
    } catch {
      return [];
    }
  })();
  const files = [path.join(where.managed, "managed-settings.json"), ...parts].map(read).reduce(merge, {});
  const sources = [read(path.join(where.home, ".claude", "remote-settings.json")), files];
  const policy = (s: Settings) => Object.keys(s).some((k) => k !== "managedSourcesBehavior" && k !== "wslInheritsWindowsSettings");
  const used = sources.filter(policy);
  return used.some((s) => s.managedSourcesBehavior === "merge") ? used.reduceRight(merge, {}) : used[0] ?? {};
}

// two settings as one: lists joined, objects merged key by key, else the
// later value (managed-settings.d's rule)
function merge(a: any, b: any): any {
  if (Array.isArray(a) && Array.isArray(b)) {
    return [...a, ...b];
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
      out[k] = k in a ? merge(a[k], v) : v;
    }
    return out;
  }
  return b === undefined ? a : b;
}

// a settings file ({}: none, or not JSON)
function read(file: string): Settings {
  try {
    const got = JSON.parse(fs.readFileSync(file, "utf8"));
    return got && typeof got === "object" ? got : {};
  } catch {
    return {};
  }
}

// an event map's hooks, from a source
function events(map: Events | undefined, from: Hook["from"], root: string, data: string): Hook[] {
  return Object.entries(map ?? {}).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : []).flatMap((g) => (g?.hooks ?? []).map((h): Hook => ({ event, matcher: String(g.matcher ?? ""), h, from, root, data, key: event + "\0" + String(g.matcher ?? "") + "\0" + JSON.stringify(h) }))));
}

// an enabled plugin's hooks: its install (one for this project, else the
// user's or the managed one), hooks/hooks.json and its manifest's hooks
// (a file's path, an inline event map, or a list of either)
function plugin_hooks(claude: string, key: string, project: string): Hook[] {
  let installs: any[] = [];
  try {
    installs = JSON.parse(fs.readFileSync(path.join(claude, "plugins", "installed_plugins.json"), "utf8")).plugins?.[key] ?? [];
  } catch {}
  const install = installs.find((i) => i.projectPath === project) ?? installs.find((i) => i.scope === "user" || i.scope === "managed") ?? installs[0];
  if (typeof install?.installPath !== "string") {
    return [];
  }
  const root = install.installPath;
  const data = path.join(claude, "plugins", "data", key.replace(/[^A-Za-z0-9_-]/g, "-"));
  const manifest = read(path.join(root, ".claude-plugin", "plugin.json")) as { hooks?: unknown };
  const declared = manifest.hooks === undefined ? [] : Array.isArray(manifest.hooks) ? manifest.hooks : [manifest.hooks];
  const maps = [read(path.join(root, "hooks", "hooks.json")).hooks, ...declared.map((d: any) => (typeof d === "string" ? read(path.resolve(root, d)).hooks : d))];
  return maps.flatMap((m) => events(m as Events, "plugin", root, data));
}

// Running
// -------

// an event's hooks that match a call, run at once; what each said (an
// async one: nothing, it runs on alone)
async function fire(hooks: Hook[], event: string, call: Call, payload: object, env: Record<string, string | undefined>, cwd: string, signal: AbortSignal): Promise<Said[]> {
  const mine = hooks.filter((h) => h.event === event && matches(h.matcher, call.tool) && rule(h.h.if, call, cwd));
  return Promise.all(mine.map((h) => run_one(h, JSON.stringify(payload), env, cwd, signal)));
}

// a matcher: all ("", "*"), exact names (letters, digits, _, -, spaces,
// "," and "|"), else an unanchored JavaScript regex
export function matches(matcher: string, name: string): boolean {
  if (matcher === "" || matcher === "*") {
    return true;
  }
  if (/^[A-Za-z0-9_\-\s,|]*$/.test(matcher)) {
    return matcher.split(/[|,]/).map((m) => m.trim()).includes(name);
  }
  try {
    return new RegExp(matcher).test(name);
  } catch {
    return false;
  }
}

// a handler's `if` rule (Tool or Tool(pattern)) against a call: a Bash
// command by each of its commands (leading VAR=value dropped), those in
// $() and backticks too, run whenever it can't tell (a $VAR, a pattern
// past the command's name over $() or backticks); a file tool by its
// path, absolute or from the dir. ponytail: a glob, not Claude Code's
// full permission rule grammar; widen it when a rule needs more
export function rule(when: string | undefined, call: Call, cwd: string): boolean {
  if (when === undefined || when === "") {
    return true;
  }
  const m = /^([^(]+)(?:\((.*)\))?$/.exec(when.trim());
  if (m === null || m[1] !== call.tool) {
    return false;
  }
  const pattern = m[2];
  if (pattern === undefined || pattern === "" || pattern === "*") {
    return true;
  }
  if (call.tool === "Bash" || call.tool === "PowerShell") {
    const command = String(call.input.command ?? "");
    const inner = [...command.matchAll(/\$\(([^)]*)\)|`([^`]*)`/g)].map((x) => x[1] ?? x[2]);
    const parts = [command, ...inner].flatMap((c) => c.split(/&&|\|\||;|\||\n/)).map((c) => c.trim().replace(/^(\w+=\S*\s+)+/, "")).filter((c) => c !== "");
    // a pattern past the command's name: more words than it, its last * aside
    const unsure = /\$\(|`|\$\w/.test(command) && pattern.trim().replace(/\s*\*$/, "").split(/\s+/).length > 1;
    return unsure || parts.some((p) => glob(pattern, false).test(p));
  }
  const file = String(call.input.file_path ?? "");
  return glob(pattern, true).test(file) || glob(pattern, true).test(path.relative(cwd, file));
}

// a glob as a whole-string regex: ** any dirs, * anything (a path's: but
// "/"), ? one character
function glob(pattern: string, paths: boolean): RegExp {
  const body = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\0").replace(/\*/g, paths ? "[^/]*" : ".*").replace(/\?/g, ".").replace(/\0/g, ".*");
  return new RegExp("^" + body + "$");
}

// one hook run, and what it said
async function run_one(hook: Hook, payload: string, env: Record<string, string | undefined>, cwd: string, signal: AbortSignal): Promise<Said> {
  const h = hook.h;
  const sub = (s: string) => s.replaceAll("${CLAUDE_PLUGIN_ROOT}", hook.root).replaceAll("${CLAUDE_PLUGIN_DATA}", hook.data).replaceAll("${CLAUDE_PROJECT_DIR}", env.CLAUDE_PROJECT_DIR ?? cwd);
  const vars = { ...env, ...(hook.from === "plugin" ? { CLAUDE_PLUGIN_ROOT: hook.root, CLAUDE_PLUGIN_DATA: hook.data } : {}) };
  const label = h.command ?? h.url ?? h.type ?? "hook";
  const block = h.onFailure === "block";
  if (h.type === "http" && h.url) {
    return read_said(await post(h, payload, signal), label, block);
  }
  if ((h.type ?? "command") !== "command" || !h.command) {
    process.stderr.write("unii: a " + h.type + " hook (" + label + ") needs Claude Code itself: skipped\n");
    return {};
  }
  if (hook.from === "plugin") {
    fs.mkdirSync(hook.data, { recursive: true });
  }
  const argv = h.args !== undefined ? [sub(h.command), ...h.args.map(sub)] : h.shell === "powershell" || (WIN && Bun.which("bash") === null) ? ["powershell", "-NoProfile", "-Command", sub(h.command)] : [Bun.which("bash") ?? "sh", "-c", sub(h.command)];
  const ran = spawn(argv, payload, vars, cwd, (h.timeout ?? TIMEOUT) * 1000, signal);
  if (h.async === true || h.asyncRewake === true) {
    ran.catch(() => {});
    return {};
  }
  return read_said(await ran, label, block);
}

// a process's run: its exit code (null: it couldn't start, or timed
// out), stdout, stderr
type Ran = { code: number | null; out: string; err: string; why?: string };

async function spawn(argv: string[], stdin: string, env: Record<string, string | undefined>, cwd: string, ms: number, signal: AbortSignal): Promise<Ran> {
  try {
    const proc = Bun.spawn(argv, { cwd, env, stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe", signal });
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      proc.kill();
    }, ms);
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    return late ? { code: null, out: "", err, why: "timed out" } : { code, out, err };
  } catch (e: any) {
    return { code: null, out: "", err: String(e?.message ?? e), why: "failed" };
  }
}

// an http hook: its JSON POSTed, the env vars it allows in its headers;
// a 2xx is exit 0 with the body as stdout, anything else a failure
async function post(h: Handler, payload: string, signal: AbortSignal): Promise<Ran> {
  const allowed = new Set(h.allowedEnvVars ?? []);
  const headers = Object.fromEntries(Object.entries(h.headers ?? {}).map(([k, v]) => [k, String(v).replace(/\$\{?(\w+)\}?/g, (_, name) => (allowed.has(name) ? process.env[name] ?? "" : ""))]));
  try {
    const res = await fetch(h.url!, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: payload, signal: AbortSignal.any([signal, AbortSignal.timeout((h.timeout ?? TIMEOUT) * 1000)]) });
    const body = await res.text();
    return res.ok ? { code: 0, out: body, err: "" } : { code: null, out: "", err: "HTTP " + res.status, why: "failed" };
  } catch (e: any) {
    return { code: null, out: "", err: String(e?.message ?? e), why: "failed" };
  }
}

// what a run said, by the docs' table: exit 2 blocks (its stderr the
// reason, or the JSON's blocking reason); JSON on stdout (one object,
// alone) decides on 0, and on any code but 2 unless onFailure blocks;
// plain text or none is nothing; a failure (can't start, timed out, a
// code but 0 or 2 without JSON, bad JSON) is nothing, or with onFailure
// "block" a block
function read_said(r: Ran, label: string, block: boolean): Said {
  const text = r.out.trim();
  const object = text.startsWith("{") && text.endsWith("}");
  let json: any = null;
  if (object) {
    try {
      json = JSON.parse(text);
    } catch {}
  }
  const valid = json !== null && typeof json === "object" && !Array.isArray(json);
  const said = valid ? from_json(json) : {};
  const fail = (why: string): Said => (block ? { block: "[" + label + "]: " + why + "; blocking because onFailure is \"block\"" + (r.err.trim() ? "\n" + r.err.trim() : "") } : {});
  if (r.code === 2) {
    return { ...said, block: "[" + label + "]: " + (said.decision === "deny" && said.reason ? said.reason : r.err.trim() || "blocked") };
  }
  if (r.code === null) {
    return fail(r.why ?? "failed");
  }
  if (object && !valid) {
    return fail("its JSON can't be parsed");
  }
  if (r.code !== 0 && !valid) {
    return fail("failed");
  }
  if (r.code !== 0 && block) {
    return fail("failed");
  }
  if (said.decision === "deny" || said.decision === "ask" || said.decision === "defer" || said.stop !== undefined) {
    return { ...said, reason: "[" + label + "]: " + (said.stop ?? said.reason ?? "no reason given") };
  }
  return said;
}

// a hook's JSON: PreToolUse's permissionDecision (or the old decision:
// approve, block), its reason, updatedInput, additionalContext;
// PostToolUse's decision block and reason, updatedToolOutput; continue
function from_json(json: any): Said {
  const o = json.hookSpecificOutput ?? {};
  const old: Record<string, string> = { approve: "allow", block: "deny" };
  const decision = o.permissionDecision ?? (json.decision === undefined ? undefined : old[json.decision] ?? json.decision);
  return {
    ...(decision === undefined ? {} : { decision }),
    ...(o.permissionDecisionReason ?? json.reason ? { reason: String(o.permissionDecisionReason ?? json.reason) } : {}),
    ...(o.updatedInput !== undefined ? { input: o.updatedInput } : o.updatedToolOutput !== undefined ? { input: o.updatedToolOutput } : o.updatedMCPToolOutput !== undefined ? { input: o.updatedMCPToolOutput } : {}),
    ...(o.additionalContext ? { context: String(o.additionalContext) } : {}),
    ...(json.continue === false ? { stop: String(json.stopReason ?? "a hook stopped the work") } : {}),
  };
}

// what blocks a call, said for the agent (none: it goes on): an exit 2
// or a failure that blocks, a stop, the strongest decision (deny, defer,
// ask: no one here can confirm)
function verdict(said: Said[], tool: string): string[] {
  const why: Record<string, string> = {
    deny  : "PreToolUse:" + tool + " hook denied this call ",
    defer : "PreToolUse:" + tool + " hook deferred this call, and a device can't resume it: it wasn't made ",
    ask   : "PreToolUse:" + tool + " hook asked for a person to confirm this call, and no one confirms on a device: it wasn't made. Ask the user ",
  };
  const blocks = said.flatMap((s) => (s.block ? ["PreToolUse:" + tool + " hook error: " + s.block] : s.stop ? ["PreToolUse:" + tool + " hook stopped the work " + s.reason] : []));
  const top = RANK.find((d) => said.some((s) => s.decision === d && !s.block));
  const first = said.find((s) => s.decision === top && !s.block);
  return [...blocks, ...(top !== undefined && top !== "allow" && first !== undefined ? [why[top] + first.reason] : [])];
}
