// Hooks.test
// ==========
// `UNII_DIR=$(mktemp -d /tmp/unii-t.XXXX) bun test Hooks.test.ts`:
// Claude Code's hooks on a device's tools (Hooks.ts), from a home and a
// managed dir made here: exit 2 and a JSON deny block, an allow changes
// the input, a matcher that doesn't fit stays out, a plugin's hook and
// a managed one run (and outlive allowManagedHooksOnly and
// disableAllHooks as the docs say), ask blocks, PostToolUse adds what the
// agent reads, the tools are shaped as Claude Code's; the user's own
// guard, copied in, blocks as in Claude Code; and Machine.run goes
// through all of it.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Hooks from "./Hooks.ts";

const ROOT = fs.mkdtempSync(os.tmpdir() + "/unii-hooks-");
const SIGNAL = new AbortController().signal;

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

// a home and managed dir: settings for each source, scripts by name
function setup(o: { user?: object; managed?: object; remote?: object; project?: object; plugin?: object; scripts?: Record<string, string> }): Hooks.Where & { work: string; log: string } {
  const at = fs.mkdtempSync(ROOT + "/at-");
  const home = path.join(at, "home");
  const managed = path.join(at, "etc");
  const work = path.join(at, "work", "main");
  const log = path.join(at, "log");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.mkdirSync(managed, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  for (const [name, body] of Object.entries(o.scripts ?? {})) {
    fs.writeFileSync(path.join(at, name), body.replaceAll("$LOG", log), { mode: 0o755 });
  }
  const sub = (x: object) => JSON.stringify(x).replaceAll("$AT", at);
  if (o.user) fs.writeFileSync(path.join(home, ".claude", "settings.json"), sub(o.user));
  if (o.remote) fs.writeFileSync(path.join(home, ".claude", "remote-settings.json"), sub(o.remote));
  if (o.managed) fs.writeFileSync(path.join(managed, "managed-settings.json"), sub(o.managed));
  if (o.project) {
    fs.mkdirSync(path.join(work, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(work, ".claude", "settings.json"), sub(o.project));
  }
  if (o.plugin) {
    const root = path.join(at, "plugin");
    fs.mkdirSync(path.join(root, "hooks"), { recursive: true });
    fs.writeFileSync(path.join(root, "hooks", "hooks.json"), sub({ hooks: o.plugin }));
    fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "org@market": [{ scope: "managed", installPath: root }] } }));
  }
  return { home, managed, work, log };
}

const pre = (matcher: string, command: string) => ({ PreToolUse: [{ matcher, hooks: [{ type: "command", command }] }] });

// a job through the hooks, the act recording the input it got
async function go(at: ReturnType<typeof setup>, name: string, input: object) {
  const got: any[] = [];
  const out = await Hooks.around({ name, input, cwd: "main" }, at.work, SIGNAL, async (i) => (got.push(i), { text: "done", fail: false }), at);
  return { out, got };
}

test("exit 2 blocks, its stderr the reason, as Claude Code words it; the tool never runs", async () => {
  const at = setup({ user: { hooks: pre("Bash", "bash $AT/no.sh") }, scripts: { "no.sh": "#!/bin/bash\necho 'sem rm' >&2\nexit 2\n" } });
  const { out, got } = await go(at, "shell", { command: "rm -rf x" });
  expect(got).toEqual([]);
  expect(out).toEqual({ text: expect.stringContaining("PreToolUse:Bash hook error: [bash " + path.dirname(at.home) + "/no.sh]: sem rm"), fail: true });
});

test("a JSON deny blocks with its reason; a JSON allow with updatedInput changes what runs", async () => {
  const deny = setup({ user: { hooks: pre("Bash", `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"nada de deploy"}}'`) } });
  expect((await go(deny, "shell", { command: "deploy" })).out.text).toContain("hook denied this call [echo");
  expect((await go(deny, "shell", { command: "deploy" })).out.text).toContain("nada de deploy");
  const allow = setup({ user: { hooks: pre("Bash", `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{"command":"echo seguro"}}}'`) } });
  expect((await go(allow, "shell", { command: "echo perigoso" })).got).toEqual([{ command: "echo seguro" }]);
});

test("a matcher that doesn't fit the tool stays out; one that does gets Claude Code's input", async () => {
  const at = setup({ user: { hooks: { PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "exit 2" }] }, { matcher: "^Ed", hooks: [{ type: "command", command: "cat > $AT/in.json" }] }] } } });
  expect((await go(at, "shell", { command: "ls" })).out.fail).toBe(false);
  await go(at, "edit", { edits: [{ path: "a.ts", old: "x", new: "y" }] });
  const seen = JSON.parse(fs.readFileSync(path.dirname(at.home) + "/in.json", "utf8"));
  expect(seen).toMatchObject({ hook_event_name: "PreToolUse", tool_name: "Edit", cwd: at.work, tool_input: { file_path: path.join(at.work, "a.ts"), old_string: "x", new_string: "y", replace_all: false } });
});

test("two edits to a file are one MultiEdit, in its old shape; a deny of it stops every edit", async () => {
  const at = setup({ user: { hooks: pre("MultiEdit", "cat > $AT/in.json; exit 2") } });
  const { out, got } = await go(at, "edit", { edits: [{ path: "a.ts", old: "1", new: "2" }, { path: "a.ts", old: "3", new: "4", all: true }, { path: "b.ts", old: "5", new: "6" }] });
  expect(got).toEqual([]);
  expect(out.fail).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.dirname(at.home) + "/in.json", "utf8")).tool_input).toEqual({ file_path: path.join(at.work, "a.ts"), edits: [{ old_string: "1", new_string: "2", replace_all: false }, { old_string: "3", new_string: "4", replace_all: true }] });
});

test("a plugin's hook runs from its root, ${CLAUDE_PLUGIN_ROOT} set; ask blocks, saying no one confirms on a device", async () => {
  const ask = `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"migration antiga"}}'`;
  const at = setup({ user: { enabledPlugins: { "org@market": true } }, plugin: pre("Read", 'test -d "${CLAUDE_PLUGIN_ROOT}/hooks" && ' + ask) });
  const { out, got } = await go(at, "read", { path: "x.sql" });
  expect(got).toEqual([]);
  expect(out.text).toContain("asked for a person to confirm this call, and no one confirms on a device");
  expect(out.text).toContain("migration antiga");
});

test("allowManagedHooksOnly: the user's hooks stop, the managed ones and a plugin managed force-enables run; a user's disableAllHooks can't stop them", async () => {
  const block = (who: string) => ({ type: "command", command: "echo " + who + " >> $LOG_FILE; exit 0" });
  const mk = (extra: object) =>
    setup({
      user: { disableAllHooks: true, hooks: { PreToolUse: [{ hooks: [block("user")] }] } },
      remote: { allowManagedHooksOnly: true, enabledPlugins: { "org@market": true }, hooks: { PreToolUse: [{ hooks: [block("remote")] }] }, ...extra },
      managed: { hooks: { PreToolUse: [{ hooks: [block("file")] }] } },
      plugin: { PreToolUse: [{ hooks: [block("plugin")] }] },
    });
  const at = mk({});
  const log = path.dirname(at.home) + "/ran";
  process.env.LOG_FILE = log;
  try {
    await go(at, "shell", { command: "ls" });
    // the server's cache sets policy keys, so the managed files are not read (first-wins)
    expect(fs.readFileSync(log, "utf8").trim().split("\n").sort()).toEqual(["plugin", "remote"]);
    const merged = mk({ managedSourcesBehavior: "merge" });
    const log2 = path.dirname(merged.home) + "/ran";
    process.env.LOG_FILE = log2;
    await go(merged, "shell", { command: "ls" });
    expect(fs.readFileSync(log2, "utf8").trim().split("\n").sort()).toEqual(["file", "plugin", "remote"]);
  } finally {
    delete process.env.LOG_FILE;
  }
});

test("a managed disableAllHooks stops every hook; a project's settings add theirs", async () => {
  const off = setup({ managed: { disableAllHooks: true }, user: { hooks: pre("Bash", "exit 2") } });
  expect((await go(off, "shell", { command: "ls" })).out.fail).toBe(false);
  const proj = setup({ project: { hooks: pre("Bash", "echo projeto >&2; exit 2") } });
  expect((await go(proj, "shell", { command: "ls" })).out.text).toContain("projeto");
});

test("PostToolUse: its context and an exit 2's stderr come after the answer; a failed tool gets none", async () => {
  const at = setup({ user: { hooks: { PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: `echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"aviso Numih"}}'` }, { type: "command", command: "cat > $AT/post.json; echo confira >&2; exit 2" }] }] } } });
  const { out } = await go(at, "write", { path: "n.go", content: "x" });
  expect(out.text).toStartWith("done\n\n");
  expect(out.text).toContain("Write PostToolUse hook additional context: aviso Numih");
  expect(out.text).toContain("Write PostToolUse hook error: [cat");
  expect(JSON.parse(fs.readFileSync(path.dirname(at.home) + "/post.json", "utf8"))).toMatchObject({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: path.join(at.work, "n.go"), content: "x" } });
  const failed = await Hooks.around({ name: "write", input: { path: "n.go", content: "x" }, cwd: "main" }, at.work, SIGNAL, async () => ({ text: "erro", fail: true }), at);
  expect(failed).toEqual({ text: "erro", fail: true });
});

test("onFailure block: a hook that can't start blocks; without it, the call goes on", async () => {
  const on = setup({ user: { hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "$AT/missing.sh", onFailure: "block" }] }] } } });
  expect((await go(on, "shell", { command: "ls" })).out.text).toContain('blocking because onFailure is "block"');
  const off = setup({ user: { hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "$AT/missing.sh" }] }] } } });
  expect((await go(off, "shell", { command: "ls" })).out.fail).toBe(false);
});

test("an MCP call on the device is mcp__<server>__<tool> (a plugin's mcp__plugin_<p>_<s>__); a deny is the tool's error", async () => {
  const at = setup({ user: { hooks: pre("mcp__plugin_mem_busca__.*", "echo nao >&2; exit 2") } });
  const { out, got } = await go(at, "mcp", { method: "tools/call", conf: { claude: "mem:busca" }, params: { name: "search", arguments: { q: "x" } } });
  expect(got).toEqual([]);
  expect(JSON.parse(out.text).result).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringContaining("PreToolUse:mcp__plugin_mem_busca__search hook error") }] });
  expect((await go(at, "mcp", { method: "tools/list", conf: { claude: "mem:busca" } })).got.length).toBe(1);
});

test("matchers and if rules as the docs read them", () => {
  expect(Hooks.matches("Edit|Write", "Write")).toBe(true);
  expect(Hooks.matches("Edit, Write", "MultiEdit")).toBe(false);
  expect(Hooks.matches("Edit.*", "MultiEdit")).toBe(true);
  expect(Hooks.matches("^Edit$", "MultiEdit")).toBe(false);
  expect(Hooks.matches(".*Edit", "MultiEdit")).toBe(true);
  expect(Hooks.matches("", "Bash")).toBe(true);
  const bash = (command: string) => ({ tool: "Bash", input: { command } });
  expect(Hooks.rule("Bash(git *)", bash("FOO=bar git push"), "/w")).toBe(true);
  expect(Hooks.rule("Bash(git *)", bash("npm test && git push"), "/w")).toBe(true);
  expect(Hooks.rule("Bash(rm *)", bash("echo $(rm -rf /)"), "/w")).toBe(true);
  expect(Hooks.rule("Bash(rm *)", bash("echo $(date)"), "/w")).toBe(false);
  expect(Hooks.rule("Bash(git push *)", bash("echo $(date)"), "/w")).toBe(true);
  expect(Hooks.rule("Edit(*.ts)", { tool: "Edit", input: { file_path: "/w/a.ts" } }, "/w")).toBe(true);
  expect(Hooks.rule("Edit(*.ts)", { tool: "Write", input: { file_path: "/w/a.ts" } }, "/w")).toBe(false);
});

test("the user's own guard, copied in unchanged, blocks a secret printed and a push by HEAD, as in Claude Code", async () => {
  const real = path.join(os.homedir(), ".claude", "hooks", "guardas-pessoais.sh");
  if (!fs.existsSync(real)) {
    return;
  }
  const at = setup({ user: { hooks: pre("Bash|Edit|Write|MultiEdit", "bash $AT/guardas-pessoais.sh") } });
  fs.copyFileSync(real, path.dirname(at.home) + "/guardas-pessoais.sh");
  const secret = await go(at, "shell", { command: "echo $FAKE_API_TOKEN" });
  expect(secret.got).toEqual([]);
  expect(secret.out.text).toContain("Bloqueado (impressão de variável sensível)");
  const push = await go(at, "shell", { command: "git push origin HEAD" });
  expect(push.out.text).toContain("Push por HEAD bloqueado");
  expect((await go(at, "shell", { command: "git push origin main:main" })).out.fail).toBe(false);
});

// in a process of its own, as a device runs, its HOME the one made here
// (Bun reads HOME once, at the start)
test("Machine.run puts a device's shell through the hooks", async () => {
  const at = setup({ user: { hooks: pre("Bash", "echo barrado >&2; exit 2") } });
  const code = `const { Machine } = await import(${JSON.stringify(import.meta.dir + "/Machine.ts")}); const out = await Machine.run({ name: "shell", input: { command: "echo nunca > ${at.work}/ran", timeout: 10 }, cwd: "main" }, new AbortController().signal); console.log(JSON.stringify(out)); process.exit(0);`;
  const proc = Bun.spawn([process.execPath, "-e", code], { env: { ...process.env, HOME: at.home }, stdout: "pipe", stderr: "pipe" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").pop()!);
  expect(out.fail).toBe(true);
  expect(out.text).toContain("PreToolUse:Bash hook error: [echo barrado >&2; exit 2]: barrado");
  expect(fs.existsSync(at.work + "/ran")).toBe(false);
});
