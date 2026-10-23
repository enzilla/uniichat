// Instructions
// ============
// What Claude Code would tell itself on this device, read here for Unii
// (code.claude.com/docs/en/memory, settings, managed-settings, hooks),
// in its load order:
// - the organization's: the managed CLAUDE.md file (MANAGED) and the
//   policy's claudeMd. The policy is the first managed source that has
//   one: the server-managed settings Claude Code caches
//   (~/.claude/remote-settings.json), else managed-settings.json merged
//   with managed-settings.d/*.json in name order. MDM and registry
//   policies aren't read;
// - the user's: ~/.claude/CLAUDE.md, then ~/.claude/rules/**/*.md;
// - a repository's (project): from the filesystem root down to the
//   directory worked in, each directory's CLAUDE.md, .claude/CLAUDE.md
//   and CLAUDE.local.md, or, when none of them is anywhere on that way,
//   its AGENTS.md and .claude/AGENTS.md; the .claude/rules of the
//   directories from the repository's root down; and its auto memory's
//   MEMORY.md (its first 200 lines or 25 KB), unless auto memory is off.
// A file's @path imports are loaded after it (relative to it, ~ or
// absolute; four hops at most; none in code), its block HTML comments
// dropped, a rule's frontmatter too. A rule with `paths` holds only for
// files that match them: the user's are listed by their paths till one
// is touched, and a project's come with the files they match. A file
// claudeMdExcludes matches is left out (never the managed one).
// Session start: the SessionStart hooks (the user's settings, the
// policy's, the enabled plugins') run once per device process, as at a
// new session ("startup"), before the files are read (a plugin may write
// rules, as Numih's does), and their output is context too.
// Instructions shape Unii; they block nothing (that is PreToolUse's).
// Imports nothing of the server's.

import * as fs from "node:fs";
import * as path from "node:path";

// Types
// =====

// a part of the instructions: what it is (its file; the hooks'), its text
export type Part = { id: string; title: string; text: string };

// a rule: its file, the paths it holds for (none: always), its text
type Rule = { file: string; paths: string[]; text: string };

// Constants
// =========

// the managed policy's folder on this OS
export const MANAGED = process.platform === "darwin" ? "/Library/Application Support/ClaudeCode" : process.platform === "win32" ? "C:\\Program Files\\ClaudeCode" : "/etc/claude-code";

// imports: hops at most; auto memory's MEMORY.md: lines and bytes read;
// a file past BIG is left out, as Claude Code does
const HOPS   = 4;
const LINES  = 200;
const MEMORY = 25 * 1024;
const BIG    = 4 * 2 ** 20;

// a hook's time when it names none (s); a hook's output kept (bytes)
const HOOK_TIME = 600;
const HOOK_OUT  = 64 * 1024;

// State
// =====

// the session start hooks' run, once per process, by work dir: their parts
const STARTED = new Map<string, Promise<Part[]>>();

// Settings
// ========

// a JSON file's value (null: none, or not JSON)
function json_file(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// the managed policy: the first source that has one (managed-settings)
export function policy(home: string, dir = MANAGED): any {
  const remote = json_file(home + "/.claude/remote-settings.json");
  if (remote !== null && typeof remote === "object" && Object.keys(remote).length > 0) {
    return remote;
  }
  let drop: string[] = [];
  try {
    drop = fs.readdirSync(path.join(dir, "managed-settings.d")).filter((f) => f.endsWith(".json") && !f.startsWith(".")).sort();
  } catch {}
  const files = [path.join(dir, "managed-settings.json"), ...drop.map((f) => path.join(dir, "managed-settings.d", f))];
  return files.map(json_file).filter((o) => o !== null && typeof o === "object").reduce((all, o) => ({ ...all, ...o, enabledPlugins: { ...all.enabledPlugins, ...o.enabledPlugins } }), {});
}

// the plugins enabled (the user's settings, then the policy's over them),
// installed for the user or by the organization: each one's name (its
// key's before "@") and folder
export function plugins(home: string, dir = MANAGED): [string, string][] {
  const on = { ...json_file(home + "/.claude/settings.json")?.enabledPlugins, ...policy(home, dir).enabledPlugins };
  const all = json_file(home + "/.claude/plugins/installed_plugins.json")?.plugins ?? {};
  return Object.keys(on).filter((key) => on[key] === true).flatMap((key): [string, string][] => {
    const at = [all[key]].flat().find((e: any) => (e?.scope === "user" || e?.scope === "managed") && typeof e.installPath === "string")?.installPath;
    return at === undefined ? [] : [[key.split("@")[0], at]];
  });
}

// claudeMdExcludes, from the user's settings, the policy's and a
// project's (dir: its root)
function excluded(home: string, dir: string, root: string | null): Bun.Glob[] {
  const sources = [json_file(home + "/.claude/settings.json"), policy(home, dir), ...(root === null ? [] : [json_file(root + "/.claude/settings.json"), json_file(root + "/.claude/settings.local.json")])];
  return sources.flatMap((s) => (Array.isArray(s?.claudeMdExcludes) ? s.claudeMdExcludes : [])).filter((p: unknown) => typeof p === "string").map((p: string) => new Bun.Glob(p));
}

// Files
// =====

// a file's text, its frontmatter dropped (returned apart) and its block
// HTML comments (not in code); null if it can't be read, isn't a regular
// file, or is past BIG
function file_text(file: string): { head: any; body: string } | null {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > BIG) {
      return null;
    }
    const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?(\n|$)/);
    let head: any = null;
    try {
      head = m === null ? null : Bun.YAML.parse(m[1]);
    } catch {}
    const body = m === null ? text : text.slice(m[0].length);
    return { head, body: outside_code(body, (s) => s.replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*$\n?/gm, "")) };
  } catch {
    return null;
  }
}

// a Markdown text with f applied to what is outside fenced code blocks
function outside_code(text: string, f: (s: string) => string): string {
  return text.split(/(^```[\s\S]*?^```[^\n]*$|^~~~[\s\S]*?^~~~[^\n]*$)/m).map((p, k) => (k % 2 === 1 ? p : f(p))).join("");
}

// the files a text imports (@path outside code; a space escaped by \),
// existing, from the file at `from`
function imports_of(text: string, from: string, home: string): string[] {
  const out: string[] = [];
  outside_code(text, (s) => {
    for (const m of s.replace(/`[^`\n]*`/g, "").matchAll(/(?:^|\s)@((?:\\ |[^\s])+)/gm)) {
      const p = m[1].replace(/\\ /g, " ").replace(/[.,;:)]+$/, "");
      const file = p.startsWith("~/") ? path.join(home, p.slice(2)) : path.resolve(path.dirname(from), p);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        out.push(file);
      }
    }
    return s;
  });
  return out;
}

// a file as parts: its own, then its imports' (theirs too, HOPS at
// most), none twice (seen)
function file_parts(file: string, title: string, home: string, seen: Set<string>, hop = 0): Part[] {
  const real = (() => {
    try {
      return fs.realpathSync(file);
    } catch {
      return file;
    }
  })();
  if (seen.has(real)) {
    return [];
  }
  const read = file_text(file);
  if (read === null) {
    return [];
  }
  seen.add(real);
  const own = read.body.trim() === "" ? [] : [{ id: real, title, text: read.body.trim() }];
  const more = hop >= HOPS ? [] : imports_of(read.body, file, home).flatMap((f) => file_parts(f, "imported by " + title + ": " + f, home, seen, hop + 1));
  return [...own, ...more];
}

// the rules under a .claude/rules folder, in path order (sub-folders too)
function rules(dir: string): Rule[] {
  let names: string[] = [];
  try {
    names = (fs.readdirSync(dir, { recursive: true }) as string[]).map(String).filter((f) => f.endsWith(".md")).sort();
  } catch {}
  return names.flatMap((name) => {
    const file = path.join(dir, name);
    const read = file_text(file);
    if (read === null || read.body.trim() === "") {
      return [];
    }
    const raw = read.head?.paths;
    const paths = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : []).map((p: unknown) => String(p).trim()).filter((p: string) => p !== "");
    return [{ file, paths, text: read.body.trim() }];
  });
}

// whether a rule holds for a file (its path from base, the rule's
// folder's project or the user's home)
function rule_holds(rule: Rule, file: string, base: string): boolean {
  const rel = path.relative(base, file).split(path.sep).join("/");
  return !rel.startsWith("../") && rule.paths.some((p) => new Bun.Glob(p).match(rel));
}

// Global
// ======

// the instructions of every session on this device: the organization's,
// the user's, the user's rules that hold always, those that hold for some
// files (listed by their paths), the session start hooks' output (after
// they ran, if they have; the first ask starts them)
export async function global(home: string, work: string, dir = MANAGED, wait = 0): Promise<Part[]> {
  const started = STARTED.get(work) ?? session_start(home, work, dir);
  STARTED.set(work, started);
  const hooks = await Promise.race([started, Bun.sleep(wait).then(() => null)]);
  const seen = new Set<string>();
  const skip = excluded(home, dir, null);
  const ok = (p: Part) => !skip.some((g) => g.match(p.id));
  const pol = policy(home, dir);
  const org = [
    ...file_parts(path.join(dir, "CLAUDE.md"), "the organization's (managed policy, " + path.join(dir, "CLAUDE.md") + ")", home, seen),
    ...(typeof pol.claudeMd === "string" && pol.claudeMd.trim() !== "" ? [{ id: "policy:claudeMd", title: "the organization's (managed settings)", text: pol.claudeMd.trim() }] : []),
  ];
  const user = file_parts(path.join(home, ".claude", "CLAUDE.md"), "the user's (~/.claude/CLAUDE.md)", home, seen).filter(ok);
  const all = rules(path.join(home, ".claude", "rules")).filter((r) => ok({ id: r.file, title: "", text: "" }));
  const always = all.filter((r) => r.paths.length === 0).flatMap((r) => file_parts(r.file, "the user's rule " + r.file, home, seen));
  const some = all.filter((r) => r.paths.length > 0);
  const list = some.length === 0 ? [] : [{ id: "rules:paths", title: "the user's rules for some files only (each comes with the files it matches: read, write and edit bring it, and the instructions tool, given a file)", text: some.map((r) => "- " + r.file + ": " + r.paths.join(", ")).join("\n") }];
  return [...org, ...user, ...always, ...list, ...(hooks ?? [])];
}

// Project
// =======

// a folder's repository: the nearest one up with .git (null: none)
export function repo_root(dir: string): string | null {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) {
      return d;
    }
    if (path.dirname(d) === d) {
      return null;
    }
  }
}

// a repository's auto memory folder: by its main checkout's path (a
// worktree's .git file names it), every character not a letter or digit
// a "-"; or where autoMemoryDirectory says; null if auto memory is off
export function memory_dir(home: string, root: string, dir = MANAGED): string | null {
  const conf = { ...json_file(home + "/.claude/settings.json"), ...json_file(root + "/.claude/settings.json"), ...json_file(root + "/.claude/settings.local.json"), ...policy(home, dir) };
  if (conf.autoMemoryEnabled === false || process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY === "1") {
    return null;
  }
  if (typeof conf.autoMemoryDirectory === "string" && conf.autoMemoryDirectory !== "") {
    return conf.autoMemoryDirectory.replace(/^~(?=\/|$)/, home);
  }
  let main = root;
  try {
    const git = fs.readFileSync(path.join(root, ".git"), "utf8").match(/^gitdir:\s*(.+)$/m)?.[1].trim();
    const at = git?.replace(/\\/g, "/").match(/^(.*)\/\.git\/worktrees\/[^/]+$/);
    main = at ? path.resolve(root, at[1]) : root;
  } catch {}
  return path.join(home, ".claude", "projects", main.replace(/[^A-Za-z0-9]/g, "-"), "memory");
}

// the instructions for work on these paths (files or folders): for each
// repository (or, outside one, folder) they are in, its instruction
// files from the root down to the path's folder, its rules that hold
// always, its auto memory, then the rules (its and the user's) that hold
// for the files given; each part once
export function project(home: string, paths: string[], dir = MANAGED): Part[] {
  const seen = new Set<string>();
  const parts: Part[] = [];
  const user = rules(path.join(home, ".claude", "rules")).filter((r) => r.paths.length > 0);
  for (const given of paths) {
    const at = path.resolve(given.replace(/^~(?=\/|$)/, home));
    const isdir = fs.existsSync(at) && fs.statSync(at).isDirectory();
    const folder = isdir ? at : path.dirname(at);
    const root = repo_root(folder) ?? folder;
    const skip = excluded(home, dir, root);
    const ok = (f: string) => !skip.some((g) => g.match(f));
    const up: string[] = [];
    for (let d = folder; ; d = path.dirname(d)) {
      up.unshift(d);
      if (path.dirname(d) === d) {
        break;
      }
    }
    const claude = (d: string) => ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"].map((f) => path.join(d, f)).filter((f) => fs.existsSync(f) && ok(f));
    const agents = (d: string) => ["AGENTS.md", ".claude/AGENTS.md"].map((f) => path.join(d, f)).filter((f) => fs.existsSync(f) && ok(f));
    const home_md = path.join(home, ".claude", "CLAUDE.md");
    const files = up.flatMap(claude).filter((f) => f !== home_md);
    const own = files.length > 0 ? files : up.flatMap(agents);
    for (const f of own) {
      parts.push(...file_parts(f, "the project's (" + f + ")", home, seen));
    }
    const projs = up.filter((d) => d.startsWith(root)).flatMap((d) => rules(path.join(d, ".claude", "rules")).map((r) => ({ r, base: d })));
    for (const { r, base } of projs) {
      if (ok(r.file) && (r.paths.length === 0 || (!isdir && rule_holds(r, at, base)))) {
        parts.push(...file_parts(r.file, "the project's rule " + r.file + (r.paths.length === 0 ? "" : " (for " + r.paths.join(", ") + ")"), home, seen));
      }
    }
    const mem = memory_dir(home, root, dir);
    const memory = mem === null ? null : path.join(mem, "MEMORY.md");
    if (memory !== null && !seen.has(memory) && fs.existsSync(memory)) {
      seen.add(memory);
      const text = fs.readFileSync(memory, "utf8").split("\n").slice(0, LINES).join("\n");
      const cut = Buffer.from(text).subarray(0, MEMORY).toString("utf8").replace(/\uFFFD$/, "");
      parts.push({ id: memory, title: "the project's auto memory (" + memory + "; its other files are in that folder)", text: cut.trim() });
    }
    for (const r of isdir ? [] : user) {
      if (rule_holds(r, at, root) || rule_holds(r, at, folder)) {
        parts.push(...file_parts(r.file, "the user's rule " + r.file + " (for " + r.paths.join(", ") + ")", home, seen));
      }
    }
  }
  return parts;
}

// Session start
// =============

// a hook as settings hold it, with where it comes from (its plugin's
// folder, for CLAUDE_PLUGIN_ROOT)
type Hook = { command: string; args?: string[]; timeout?: number; shell?: string; root?: string };

// the SessionStart hooks for a new session ("startup"): the user's
// settings', the policy's, the enabled plugins' (only the policy's if it
// allows no other; none if hooks are off), none twice
export function start_hooks(home: string, dir = MANAGED): Hook[] {
  const pol = policy(home, dir);
  const user = json_file(home + "/.claude/settings.json");
  if (pol.disableAllHooks === true || user?.disableAllHooks === true) {
    return [];
  }
  const of = (s: any, root?: string): Hook[] => (Array.isArray(s?.hooks?.SessionStart) ? s.hooks.SessionStart : []).filter((m: any) => {
    const matcher = typeof m?.matcher === "string" ? m.matcher : "";
    try {
      return matcher === "" || matcher === "*" || new RegExp("^(?:" + matcher + ")$").test("startup");
    } catch {
      return false;
    }
  }).flatMap((m: any) => (Array.isArray(m.hooks) ? m.hooks : [])).filter((h: any) => h?.type === "command" && typeof h.command === "string").map((h: any) => ({ command: h.command, args: Array.isArray(h.args) ? h.args.map(String) : undefined, timeout: typeof h.timeout === "number" ? h.timeout : undefined, shell: h.shell, root }));
  const managed = of(pol);
  const rest = pol.allowManagedHooksOnly === true ? [] : [...of(user), ...plugins(home, dir).flatMap(([, root]) => of(json_file(path.join(root, "hooks", "hooks.json")), root))];
  const all = [...managed, ...rest];
  return all.filter((h, k) => all.findIndex((x) => x.command === h.command && JSON.stringify(x.args) === JSON.stringify(h.args) && x.root === h.root) === k);
}

// the session start hooks run, each as Claude Code runs a command hook
// (sh -c, or its program and args; the hook's JSON on its stdin; in the
// work dir), all at once; each one's context: its additionalContext, or
// its whole output (exit 0 only)
async function session_start(home: string, work: string, dir: string): Promise<Part[]> {
  const cwd = work.startsWith("~/") ? path.join(home, work.slice(2)) : work;
  fs.mkdirSync(cwd, { recursive: true });
  const input = JSON.stringify({ session_id: crypto.randomUUID(), transcript_path: "", cwd, hook_event_name: "SessionStart", source: "startup", permission_mode: "dontAsk" });
  const runs = start_hooks(home, dir).map(async (h): Promise<Part[]> => {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...(h.root === undefined ? {} : { CLAUDE_PLUGIN_ROOT: h.root }) };
    const cmd = h.root === undefined ? h.command : h.command.replaceAll("${CLAUDE_PLUGIN_ROOT}", h.root);
    const argv = h.args !== undefined ? [cmd, ...h.args] : process.platform === "win32" ? ["bash", "-c", cmd] : ["sh", "-c", cmd];
    try {
      const proc = Bun.spawn(argv, { cwd, env, stdin: new Blob([input]), stdout: "pipe", stderr: "ignore", timeout: (h.timeout ?? HOOK_TIME) * 1000 });
      const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      if (code !== 0) {
        return [];
      }
      let text = out.trim();
      try {
        const j = JSON.parse(text);
        text = typeof j?.hookSpecificOutput?.additionalContext === "string" ? j.hookSpecificOutput.additionalContext : "";
      } catch {}
      text = text.slice(0, HOOK_OUT).trim();
      return text === "" ? [] : [{ id: "hook:" + (h.root ?? "") + ":" + h.command, title: "a SessionStart hook's output (" + (h.root === undefined ? "settings" : path.basename(path.dirname(h.root)) + " plugin") + ")", text }];
    } catch {
      return [];
    }
  });
  return (await Promise.all(runs)).flat();
}

// Text
// ====

// parts as one text, each under its title
export function parts_text(parts: Part[]): string {
  return parts.map((p) => "## From " + p.title + "\n\n" + p.text).join("\n\n");
}

// for tests: the session start hooks run again at the next ask
export function forget(): void {
  STARTED.clear();
}
