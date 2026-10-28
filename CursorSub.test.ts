// CursorSub.test
// ==============
// `UNII_DIR=$(mktemp -d /tmp/unii-t.XXXX) bun test CursorSub.test.ts`: the
// cursor-sub vendor's parts that need no agent (CursorSub.ts): Cursor's
// ids, bubblewrap's command, the permissions, what a session streams
// (updates as a real `agent acp` sent them), a call refused unasked, and
// the Docker mode's container and calls.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Event } from "./AskAI.ts";
import * as config from "./Config.ts";
import { CursorSub, BAD_SANDBOX, CLI_JSON, CONTAINER, IMAGE, NO_DOCKER, NO_SANDBOX, SIGN_IN } from "./CursorSub.ts";
import { EFFORTS, Pick } from "./Pick.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}

// the ids `agent models` listed (2026-10-23) for the models Pick offers
const LISTED = new Set(("claude-opus-5-5-low claude-opus-5-5-low-fast claude-opus-5-5-medium claude-opus-5-5-medium-fast claude-opus-5-5-high claude-opus-5-5-high-fast " +
  "claude-opus-5-5-xhigh claude-opus-5-5-xhigh-fast claude-opus-5-5-max claude-opus-5-5-max-fast claude-sonnet-5-5-low claude-sonnet-5-5-medium claude-sonnet-5-5-high " +
  "claude-sonnet-5-5-xhigh claude-sonnet-5-5-max claude-fable-5-1-low claude-fable-5-1-medium claude-fable-5-1-high claude-fable-5-1-xhigh claude-fable-5-1-max " +
  "gpt-5.6-sol-low gpt-5.6-sol-low-fast gpt-5.6-sol-medium gpt-5.6-sol-medium-fast gpt-5.6-sol-high gpt-5.6-sol-high-fast gpt-5.6-sol-xhigh gpt-5.6-sol-xhigh-fast " +
  "gpt-5.6-sol-max gpt-5.6-sol-max-fast grok-4.7-low grok-4.7-low-fast grok-4.7-medium grok-4.7-medium-fast grok-4.7-high grok-4.7-high-fast grok-4.7-xhigh " +
  "grok-4.7-xhigh-fast gemini-3.8-flash-low gemini-3.8-flash-medium gemini-3.8-flash-high composer-2.5 composer-2.5-fast").split(" "));

test("every model Pick offers, at every effort and speed, is one Cursor lists", () => {
  const models = Pick.models(["cursor-sub"], ["opus-5.5", "sonnet-5.5", "fable-5.1", "gpt-5.6-sol", "grok-4.7", "gemini-3.8-flash", "composer-2.5"]);
  // only Composer: the plan includes it whatever its usage (never on-demand)
  expect(models.map(([, m]) => m.label)).toEqual(["composer-2.5"]);
  for (const [, m] of models) {
    for (const effort of EFFORTS) {
      for (const speed of m.speeds) {
        expect(LISTED.has(CursorSub.model(m.id, effort, speed))).toBe(true);
      }
    }
  }
  expect(CursorSub.model("composer-2.5", "max", "slow")).toBe("composer-2.5");
  expect(CursorSub.model("composer-2.5", "low", "fast")).toBe("composer-2.5-fast");
});

test("a call keeps fast off unless the plan allows it", () => {
  expect(CursorSub.locked("grok-4.7-medium", false)).toBe("grok-4.7-medium[fast=false]");
  expect(CursorSub.locked("grok-4.7-medium-fast", false)).toBe("grok-4.7-medium[fast=false]");
  expect(CursorSub.locked("composer-2.5", false)).toBe("composer-2.5[fast=false]");
  expect(CursorSub.locked("composer-2.5-fast", false)).toBe("composer-2.5[fast=false]");
  expect(CursorSub.locked("grok-4.7-high-fast", true)).toBe("grok-4.7-high-fast");
});

test("bubblewrap's command: the system read only, no user's home, the agent's home and work dir alone writable, a clean environment", () => {
  const home = "/srv/unii/cursor-sub";
  const work = home + "/work/x";
  const link = (p: string) => (p === "/bin" ? "usr/bin" : null);
  const argv = CursorSub.sandbox("/usr/bin/bwrap", "/opt/cursor/v1/cursor-agent", home, work, "grok-4.7-low", (p) => p !== "/lib64", link);
  const s = argv.join(" ");
  expect(argv.slice(0, 5)).toEqual(["/usr/bin/bwrap", "--die-with-parent", "--new-session", "--unshare-all", "--share-net"]);
  expect(s).toContain("--ro-bind /usr /usr");
  expect(s).toContain("--symlink usr/bin /bin");
  expect(s).not.toContain("/lib64");
  expect(s).toContain("--ro-bind /opt/cursor/v1 /opt/cursor/v1");
  expect(s).toContain("--bind " + home + " " + home);
  expect(s).toContain("--chdir " + work + " --clearenv");
  expect(s).toContain("--setenv HOME " + home);
  expect(s).not.toContain(os.homedir());
  expect(s).not.toMatch(/docker\.sock|--bind \/ |--dev-bind/);
  expect(argv.slice(-5)).toEqual(["--", "/opt/cursor/v1/cursor-agent", "acp", "--model", "grok-4.7-low"]);
  // only the home is writable: each --bind is it
  expect(argv.flatMap((a, k) => (a === "--bind" ? [argv[k + 1]] : []))).toEqual([home]);
});

test("a call's work dir and the agent's home deny every tool of Cursor's own, allowing ours", () => {
  CursorSub.home();
  const work = CursorSub.work();
  const local = JSON.parse(fs.readFileSync(path.join(work, ".cursor", "cli.json"), "utf8"));
  const global = JSON.parse(fs.readFileSync(path.join(config.CURSOR_SUB, ".cursor", "cli-config.json"), "utf8"));
  for (const conf of [local, global]) {
    expect(conf.permissions).toEqual(CLI_JSON.permissions);
    expect(conf.permissions.deny).toEqual(["Shell(*)", "Read(**)", "Write(**)", "WebFetch(*)"]);
  }
  expect(fs.readdirSync(work)).toEqual([".cursor"]);
});

test("a permission is granted to our tools alone", () => {
  const opts = [{ optionId: "allow-once", kind: "allow_once" }, { optionId: "reject-once", kind: "reject_once" }];
  expect(CursorSub.permit({ toolCall: { title: "unii: shell", rawInput: { providerIdentifier: "unii" } }, options: opts })).toBe("allow-once");
  expect(CursorSub.permit({ toolCall: { title: "`ls`", kind: "execute", rawInput: { command: "ls" } }, options: opts })).toBe("reject-once");
  expect(CursorSub.permit({ toolCall: { title: "other: eco", rawInput: { providerIdentifier: "other" } }, options: opts })).toBe("reject-once");
});

test("a session's updates as ours: thoughts and the reply live, our tool call logged with its end and acted, Cursor's own logged by its title", () => {
  const evs: Event[] = [];
  const t = CursorSub.turn((ev) => evs.push(ev), []);
  // as `agent acp` sent them (the prototype's log, ids shortened)
  [
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "**Executing Tool Call**" } },
    { sessionUpdate: "tool_call", toolCallId: "0_a", title: "MCP: tool", kind: "other", status: "pending", rawInput: {} },
    { sessionUpdate: "tool_call_update", toolCallId: "0_a", title: "unii: eco", rawInput: { providerIdentifier: "unii", toolName: "eco", args: { texto: "oi" } } },
    { sessionUpdate: "tool_call_update", toolCallId: "0_a", status: "in_progress" },
    { sessionUpdate: "tool_call_update", toolCallId: "0_a", status: "completed", rawOutput: { success: true } },
    { sessionUpdate: "tool_call", toolCallId: "0_b", title: "`ls`", kind: "execute", status: "pending", rawInput: { command: "ls" } },
    { sessionUpdate: "tool_call_update", toolCallId: "0_b", status: "completed" },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "eco:" } },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: " oi" } },
  ].forEach(t.update);
  t.flush();
  const entries = evs.filter((e) => e.$ === "Entry").map((e: any) => [e.kind, e.text, e.of ?? ""]);
  expect(entries).toEqual([
    ["mind", "**Executing Tool Call**", ""],
    ["tool", 'eco {"texto":"oi"}', "0_a"],
    ["echo", '{"success":true}', "0_a"],
    ["tool", 'ls {"command":"ls"}', "0_b"],
    ["echo", "(no output)", "0_b"],
    ["unii", "eco: oi", ""],
  ]);
  expect(t.acted).toBe(true);
  expect(t.text()).toBe("eco: oi");
  expect(evs.filter((e) => e.$ === "Delta").map((e: any) => e.kind)).toEqual(["mind", "unii", "unii"]);
});

test("a call is refused unasked, the agent never run, without bubblewrap; then without a sign-in", async () => {
  const ask = { vendor: "cursor-sub", model: "grok-4.7", effort: "low", speed: "slow", system: "", blocks: [], searches: 0, server: "" } as never;
  const was = process.env.PATH;
  process.env.PATH = "/nonexistent";
  try {
    expect(await CursorSub.run(ask, () => {}, [], new AbortController().signal)).toEqual({ text: NO_SANDBOX });
  } finally {
    process.env.PATH = was;
  }
  if (Bun.which("bwrap", { PATH: process.env.PATH ?? "" }) !== null && CursorSub.bin() !== null) {
    expect(await CursorSub.run(ask, () => {}, [], new AbortController().signal)).toEqual({ text: SIGN_IN });
  }
});

test("the Docker mode's container: read only but its home and /tmp, no capabilities, the host's uid and network, its CLI read only, no Docker socket, nothing more of the home", () => {
  const cli = "/home/zola/.local/share/cursor-agent";
  const home = "/home/zola/.unii/cursor-sub";
  const argv = CursorSub.docker_run("/usr/bin/docker", cli, home, 1000, 1003, "/etc/ssl/certs");
  const s = argv.join(" ");
  expect(argv.slice(0, 5)).toEqual(["/usr/bin/docker", "run", "-d", "--name", CONTAINER]);
  for (const flag of ["--read-only", "--cap-drop ALL", "--security-opt no-new-privileges", "--user 1000:1003", "--network host", "--init", "--tmpfs /tmp:rw,nosuid,nodev,size=256m"]) {
    expect(s).toContain(flag);
  }
  const mounts = argv.flatMap((a, k) => (a === "-v" ? [argv[k + 1]] : []));
  expect(mounts).toEqual([cli + ":" + cli + ":ro", home + ":" + home, "/etc/ssl/certs:/etc/ssl/certs:ro"]);
  expect(s).not.toMatch(/docker\.sock|--privileged|--cap-add|--pid host|-v \/home\/zola:/);
  expect(argv.slice(-3)).toEqual(["sleep", IMAGE, "infinity"]);
  expect(IMAGE).toMatch(/^ubuntu@sha256:[0-9a-f]{64}$/);
  const env = argv.flatMap((a, k) => (a === "-e" ? [argv[k + 1].split("=")[0]] : []));
  expect(env).toEqual(["HOME", "XDG_CONFIG_HOME", "PATH", "LANG", "NO_OPEN_BROWSER"]);
  // labeled by its setup: the same again, another for another uid or no certificates
  const label = (a: string[]) => a[a.indexOf("--label") + 1];
  expect(label(argv)).toBe(label(CursorSub.docker_run("/usr/bin/docker", cli, home, 1000, 1003, "/etc/ssl/certs")));
  expect(label(argv)).not.toBe(label(CursorSub.docker_run("/usr/bin/docker", cli, home, 1001, 1003, "/etc/ssl/certs")));
  expect(CursorSub.docker_run("/usr/bin/docker", cli, home, 1000, 1003, null).join(" ")).not.toContain("/etc/ssl/certs");
});

test("a Docker mode call is an exec in the container, in its work dir, saying its pid there first", () => {
  expect(CursorSub.docker_exec("/usr/bin/docker", "/h/w/1", "/c/v/cursor-agent", "grok-4.7-low")).toEqual(["/usr/bin/docker", "exec", "-i", "-w", "/h/w/1", CONTAINER, "/bin/sh", "-c", 'echo "pid $$" >&2; exec "$0" "$@"', "/c/v/cursor-agent", "acp", "--model", "grok-4.7-low"]);
});

test("failing closed by mode: no docker, a mode not known; never the other mode", async () => {
  const was = process.env.PATH;
  process.env.PATH = "/nonexistent";
  try {
    expect(await CursorSub.isolated("docker", "/c/v/cursor-agent", "/w", "m")).toEqual({ text: NO_DOCKER + "no docker command" });
    expect(await CursorSub.isolated("bwrap", "/c/v/cursor-agent", "/w", "m")).toEqual({ text: NO_SANDBOX });
  } finally {
    process.env.PATH = was;
  }
  expect(await CursorSub.isolated("none", "/c/v/cursor-agent", "/w", "m")).toEqual({ text: BAD_SANDBOX });
  const ask = { vendor: "cursor-sub", model: "grok-4.7", effort: "low", speed: "slow", system: "", blocks: [], searches: 0, server: "" } as never;
  expect(await CursorSub.run(ask, () => {}, [], new AbortController().signal, "")).toEqual({ text: BAD_SANDBOX });
});

test("closed, the agent's input ends and it exits on its own; one that won't is killed and its pid handed over", async () => {
  const work = fs.mkdtempSync(os.tmpdir() + "/unii-cs-");
  try {
    const quits = CursorSub.spawn(["/bin/sh", "-c", 'echo "pid $$" >&2; cat > /dev/null'], work);
    await Bun.sleep(100);
    quits.close();
    await Bun.sleep(300);
    expect(quits.dead()).toBe(true);
    let told = "";
    const stays = CursorSub.spawn(["/bin/sh", "-c", 'echo "pid $$" >&2; trap "" TERM; while :; do sleep 1; done < /dev/null'], work, (err) => (told = err));
    await Bun.sleep(100);
    stays.close();
    await Bun.sleep(5600);
    expect(stays.dead()).toBe(true);
    expect(told).toMatch(/^pid \d+$/m);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}, 15000);

test("a model Cursor won't run (the plan's usage spent) ends the call off, saying so, not as a sign-in to redo", async () => {
  const work = fs.mkdtempSync(os.tmpdir() + "/unii-cs-");
  try {
    const agent = 'read l; id=$(printf %s "$l" | sed -n \'s/.*"id":\\([0-9]*\\).*/\\1/p\'); printf \'{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":1}}\\n\' "$id"; read l; echo "Cannot use this model: grok-4.7-medium[fast=false]. Available models: composer-2.5" >&2; exit 1';
    const acp = CursorSub.spawn(["/bin/sh", "-c", agent], work);
    const end = await CursorSub.open(acp, "", new AbortController().signal);
    expect(end).toMatchObject({ stop: "down", off: true });
    expect((end as { text: string }).text).toContain("Cannot use this model");
    expect((end as { text: string }).text).not.toBe(SIGN_IN);
    acp.close();
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test("cursor_fast is read again as Settings saves it: off by default, on only when set", () => {
  const file = config.DIR + "/config.json";
  const was = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  try {
    fs.mkdirSync(config.DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ cursor_fast: "on" }));
    config.config_reload();
    expect(config.CURSOR_FAST).toBe(true);
    fs.writeFileSync(file, JSON.stringify({}));
    config.config_reload();
    expect(config.CURSOR_FAST).toBe(false);
  } finally {
    if (was === null) {
      fs.rmSync(file, { force: true });
    } else {
      fs.writeFileSync(file, was);
    }
    config.config_reload();
  }
});
