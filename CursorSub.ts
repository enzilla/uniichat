// CursorSub
// =========
// The cursor-sub vendor: a Cursor plan instead of an API key, on Cursor's
// own agent (its CLI, `agent acp`: the Agent Client Protocol, JSON-RPC a
// line each way over its pipes). A call is one ACP session: initialize,
// authenticate (the sign-in `unii serve cursor` made), session/new with
// our tools as its one MCP server (the chat's URL, Tools.ts, as claude-sub
// has them), session/prompt with our blocks; its session/update pieces
// stream as ours, its tool calls logged with their ends. ACP has no
// system prompt: ours opens the first message, as its <system> block.
//
// Contained, failing closed: Cursor's own tools (a shell, files, search)
// run with no permission asked, in its ask mode too, so they are shut
// three ways. The agent runs in bubblewrap (CursorSub.sandbox): /usr and
// the few files of /etc a program needs, read only, its CLI read only,
// and its home (DIR) and an empty work dir (one per call) writable; no
// user's home, no Docker socket. Its permissions deny every tool of its
// own, in its home's config and the work dir's (CLI_JSON). A permission
// it asks is granted to our tools alone. Without bubblewrap, or one that
// won't start, the call ends unasked, as one not signed in does, saying
// how to install it: the agent never runs bare.
//
// Its home is DIR, not the user's, so a Cursor the user runs (its MCP
// servers, hooks, rules) is no part of it. Models: Pick.ts names each by
// its id less effort and speed; the call adds them as Cursor names its
// variants (CursorSub.model). One agent per call; summaries share
// claude-sub's slots (ClaudeSub.slot). A message sent mid-run is the next
// prompt of the same session once the turn ends.
// ponytail: Cursor's usage limits aren't told apart (none seen, nor its
// format in its docs): such an end is the vendor's (busy); add a wait
// like claude-sub's once its error is known.

import * as child from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AskAI, type Ask, type End, type Event, type Img, type Say, type Try } from "./AskAI.ts";
import { Agent, BUSY, type Emit } from "./Agent.ts";
import { ClaudeSub } from "./ClaudeSub.ts";
import { live_push, type Live } from "./View.ts";
import * as config from "./Config.ts";

// Constants
// =========

const DIR = config.CURSOR_SUB;

// our MCP server's name in the session (CLI_JSON allows its tools alone)
export const SERVER = "unii";

// Cursor's permissions: our tools only
export const CLI_JSON = { permissions: { allow: ["Mcp(" + SERVER + ":*)"], deny: ["Shell(*)", "Read(**)", "Write(**)", "WebFetch(*)"] } };

// each model's efforts as Cursor names its variants (none: one variant),
// and those with a fast one ("-fast")
export const EFFORTS: Record<string, string[]> = {
  "claude-opus-5-5"  : ["low", "medium", "high", "xhigh", "max"],
  "claude-sonnet-5-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-fable-5-1" : ["low", "medium", "high", "xhigh", "max"],
  "gpt-5.6-sol"      : ["low", "medium", "high", "xhigh", "max"],
  "grok-4.7"         : ["low", "medium", "high", "xhigh"],
  "gemini-3.8-flash" : ["low", "medium", "high"],
};
const FAST = ["claude-opus-5-5", "gpt-5.6-sol", "grok-4.7", "composer-2.5"];
const ORDER = ["low", "medium", "high", "xhigh", "max"];

// the files of /etc (and where Ubuntu's resolver lives) a program needs
const ETC = ["/etc/resolv.conf", "/etc/hosts", "/etc/nsswitch.conf", "/etc/host.conf", "/etc/ssl", "/etc/ca-certificates", "/etc/pki", "/etc/ld.so.cache", "/etc/localtime", "/etc/passwd", "/etc/group", "/run/systemd/resolve"];

// top-level dirs that are /usr's on a merged system (a link kept as one)
const TOP = ["/bin", "/sbin", "/lib", "/lib64"];

export const SIGN_IN = "cursor-sub is not signed in, or its sign-in expired: run `unii serve cursor` on the server";
export const NO_SANDBOX = "cursor-sub runs Cursor's agent only inside bubblewrap, which isn't here: install it on the server (sudo apt install bubblewrap) and ask again";
const SANDBOX_FAILED = "cursor-sub couldn't start Cursor's agent inside bubblewrap, so it didn't run it: ";
const NO_BIN = "cursor-sub needs Cursor's CLI on the server (curl https://cursor.com/install -fsS | bash), or `cursor` set to its agent";

// how long the agent may take to answer initialize, authenticate and
// session/new (it connects our MCP server then)
const START = 60e3;

// CursorSub
// =========

export namespace CursorSub {

  // Cursor's id for a model at an effort and speed: the effort it has
  // that is the one asked, else the nearest below (else its first), and
  // "-fast" when fast and it has one
  export function model(id: string, effort: string, speed: string): string {
    const efforts = EFFORTS[id] ?? [];
    const below = ORDER.slice(0, ORDER.indexOf(effort) + 1).filter((e) => efforts.includes(e));
    const at = efforts.length === 0 ? "" : "-" + (below.pop() ?? efforts[0]);
    return id + at + (speed === "fast" && FAST.includes(id) ? "-fast" : "");
  }

  // the agent's script (in its version's dir, beside its node): config
  // `cursor`, else the `agent` on PATH or in ~/.local/bin, resolved
  export function bin(): string | null {
    const given = config.CURSOR || Bun.which("agent", { PATH: process.env.PATH ?? "" }) || path.join(os.homedir(), ".local/bin/agent");
    try {
      const real = fs.realpathSync(given);
      const script = path.join(path.dirname(real), "cursor-agent");
      return fs.existsSync(script) ? script : real;
    } catch {
      return null;
    }
  }

  // bubblewrap's command around the agent: the system read only, the
  // agent's dir read only, its home writable, the call's work dir its
  // cwd, the network shared (Cursor's API, our MCP server on loopback),
  // a clean environment. exists, link: the filesystem (a test hands in
  // its own)
  export function sandbox(bwrap: string, script: string, home: string, work: string, model: string, exists = fs.existsSync, link = (p: string) => (fs.lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink() ? fs.readlinkSync(p) : null)): string[] {
    const top = TOP.flatMap((p) => {
      const to = link(p);
      return to !== null ? ["--symlink", to, p] : exists(p) ? ["--ro-bind", p, p] : [];
    });
    const etc = ETC.flatMap((p) => ["--ro-bind-try", p, p]);
    const dir = path.dirname(script);
    const env = ["HOME", home, "XDG_CONFIG_HOME", path.join(home, ".config"), "PATH", "/usr/local/bin:/usr/bin:/bin", "LANG", "C.UTF-8", "NO_OPEN_BROWSER", "1"];
    const set = env.flatMap((v, k) => (k % 2 === 0 ? ["--setenv", v, env[k + 1]] : []));
    return [
      bwrap, "--die-with-parent", "--new-session", "--unshare-all", "--share-net",
      "--ro-bind", "/usr", "/usr", ...top, ...etc,
      "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
      "--ro-bind", dir, dir, "--bind", home, home,
      "--chdir", work, "--clearenv", ...set,
      "--", script, "acp", "--model", model,
    ];
  }

  // the home made (its owner's alone) with its config's permissions ours,
  // whatever else the agent keeps there; a call's work dir, empty but for
  // the same permissions
  export function home(): void {
    fs.mkdirSync(path.join(DIR, ".cursor"), { recursive: true, mode: 0o700 });
    fs.chmodSync(DIR, 0o700);
    const file = path.join(DIR, ".cursor", "cli-config.json");
    let conf: Record<string, unknown> = {};
    try {
      conf = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {}
    fs.writeFileSync(file, JSON.stringify({ ...conf, ...CLI_JSON }, null, 2));
  }

  export function work(): string {
    const dir = path.join(DIR, "work", crypto.randomUUID());
    fs.mkdirSync(path.join(dir, ".cursor"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".cursor", "cli.json"), JSON.stringify(CLI_JSON));
    return dir;
  }

  export function signed(): boolean {
    return fs.existsSync(path.join(DIR, ".config", "cursor", "auth.json"));
  }

  // `unii serve cursor [logout|status]`, as `unii serve claude`: Cursor's
  // own login, status or logout, in cursor-sub's home (outside the
  // sandbox: it only talks to Cursor)
  export async function cli(args: string[]): Promise<void> {
    const script = CursorSub.bin();
    if (script === null) {
      throw new Error(NO_BIN);
    }
    CursorSub.home();
    const cmd = args.includes("status") ? "status" : args.includes("logout") ? "logout" : "login";
    const env = { ...process.env, HOME: DIR, XDG_CONFIG_HOME: path.join(DIR, ".config") };
    const run = Bun.spawn([script, cmd], { env, stdio: ["inherit", "inherit", "inherit"] });
    process.exitCode = await run.exited;
  }

  // a call (CursorSub.run); a stop cancels the session and ends the agent
  export function ask(ask: Ask, on: (ev: Event) => void): Try {
    const end = AskAI.end("");
    const sent: Say[] = [];
    const abort = new AbortController();
    const send = (say: Say) => {
      sent.push(say);
    };
    const stop = () => {
      end.text = "stopped";
      abort.abort();
    };
    const done = CursorSub.run(ask, on, sent, abort.signal).then(
      (out) => abort.signal.aborted || Object.assign(end, out),
      (err) => (end.text ||= err.message),
    ).then(() => {
      end.ok   = end.ok && !abort.signal.aborted;
      end.left = sent;
      return end;
    });
    return { send, stop, wake: () => {}, done };
  }

  // the call's end: refused unasked with no sign-in, no CLI or no
  // bubblewrap; else its agent started (a summary's once it has a slot),
  // its session open, each prompt's turn read to its end
  export async function run(ask: Ask, on: (ev: Event) => void, sent: Say[], signal: AbortSignal): Promise<Partial<End>> {
    const bwrap = Bun.which("bwrap", { PATH: process.env.PATH ?? "" });
    const script = CursorSub.bin();
    if (bwrap === null) {
      return { text: NO_SANDBOX };
    }
    if (script === null) {
      return { text: NO_BIN };
    }
    if (!CursorSub.signed()) {
      return { text: SIGN_IN };
    }
    const held = ask.patient === true;
    if (held && !(await ClaudeSub.slot(ask, signal))) {
      return {};
    }
    CursorSub.home();
    const work = CursorSub.work();
    const acp = CursorSub.spawn(CursorSub.sandbox(bwrap, script, DIR, work, CursorSub.model(ask.model, ask.effort, ask.speed)));
    const seen: Live[] = [];
    const turn = CursorSub.turn(on, seen);
    acp.listen = turn.update;
    try {
      const sid = await CursorSub.open(acp, ask.server, signal);
      if (typeof sid !== "string") {
        return sid;
      }
      const cancel = () => acp.notify("session/cancel", { sessionId: sid });
      signal.addEventListener("abort", cancel, { once: true });
      let prompt = CursorSub.prompt(ask.system, ask.blocks.map((b) => b.text).filter((t) => t !== ""), ask.imgs ?? []);
      for (;;) {
        const r = await acp.ask("session/prompt", { sessionId: sid, prompt });
        turn.flush();
        if (signal.aborted) {
          return {};
        }
        if (r.error !== undefined || r.result?.stopReason !== "end_turn") {
          const why = r.error?.message ?? "stop reason " + r.result?.stopReason;
          console.error("cursor-sub: " + String(why).slice(0, 300));
          return /auth|log ?in|sign/i.test(String(why)) ? { text: SIGN_IN } : { text: BUSY, stop: "down", acted: turn.acted };
        }
        const says = sent.splice(0);
        if (says.length === 0) {
          return { ok: true, text: turn.text().trim(), acted: turn.acted };
        }
        turn.acted = true;
        says.forEach((say) => on({ $: "Entry", kind: "user", text: say.text }));
        prompt = CursorSub.prompt("", says.map((say) => say.text), says.flatMap((say) => say.imgs));
      }
    } finally {
      acp.close();
      if (held) {
        ClaudeSub.free();
      }
      fs.rmSync(work, { recursive: true, force: true });
      if (signal.aborted) {
        Agent.fail("stopped", seen).entries.forEach((e) => on({ $: "Entry", ...e }));
      }
    }
  }

  // initialize, authenticate and session/new (our MCP server in it): the
  // session's id, or the call's end. An agent that ends first (bubblewrap
  // refusing to start, as where unprivileged namespaces are shut) fails
  // closed, saying what bubblewrap said
  export async function open(acp: Acp, server: string, signal: AbortSignal): Promise<string | Partial<End>> {
    const step = (method: string, params: object) => Promise.race([acp.ask(method, params), Bun.sleep(START).then(() => ({ error: { message: method + " timed out" } }) as Reply)]);
    const init = await step("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
    if (init.error !== undefined) {
      return acp.dead() ? { text: SANDBOX_FAILED + acp.err().trim().slice(-300) } : { text: BUSY, stop: "down" };
    }
    const auth = await step("authenticate", { methodId: "cursor_login" });
    if (auth.error !== undefined) {
      return { text: SIGN_IN };
    }
    if (signal.aborted) {
      return {};
    }
    const mcp = server === "" ? [] : [{ type: "http", name: SERVER, url: server, headers: [] }];
    const sess = await step("session/new", { cwd: acp.cwd, mcpServers: mcp });
    const sid = sess.result?.sessionId;
    if (typeof sid !== "string") {
      console.error("cursor-sub: session/new: " + JSON.stringify(sess.error ?? sess.result).slice(0, 300));
      return /auth|log ?in/i.test(JSON.stringify(sess.error ?? "")) ? { text: SIGN_IN } : { text: BUSY, stop: "down" };
    }
    return sid;
  }

  // a prompt's content: our system prompt first (if any, as ACP has no
  // place for one), then the texts, then the images
  export function prompt(system: string, texts: string[], imgs: Img[]): object[] {
    const head = system === "" ? [] : ["<system>\n" + system + "\n</system>"];
    return [...[...head, ...texts].map((text) => ({ type: "text", text })), ...imgs.map((i) => ({ type: "image", mimeType: i.type, data: i.data }))];
  }

  // a permission the agent asks: granted to our tools alone (Cursor's own
  // are denied by its config too); the option picked
  export function permit(params: any): string | null {
    const call = params?.toolCall ?? {};
    const ours = call.rawInput?.providerIdentifier === SERVER || String(call.title ?? "").startsWith(SERVER + ": ");
    const opts: any[] = params?.options ?? [];
    const pick = opts.find((o) => String(o.kind ?? o.optionId).startsWith(ours ? "allow" : "reject"));
    return pick?.optionId ?? null;
  }

  // A session's turns
  // -----------------

  // what a session streams, as our events: its message and thoughts live
  // (each a message once a tool call or the turn's end closes it), its
  // tool calls logged once their input is known, each with its end. Any
  // call of ours marks the call acted
  export function turn(on: (ev: Event) => void, seen: Live[]) {
    const open: { kind: "unii" | "mind"; text: string }[] = [];
    const logged = new Set<string>();
    let all = "";
    let fresh = true;
    const emit: Emit = (kind, text) => {
      live_push(seen, kind, text, fresh);
      on({ $: "Delta", kind, text, fresh });
      fresh = false;
    };
    const t = {
      acted: false,
      text: () => all,
      flush: () => {
        for (const piece of open.splice(0)) {
          if (piece.text.trim() !== "") {
            on({ $: "Entry", kind: piece.kind, text: piece.text.trim() });
          }
        }
        seen.length = 0;
        fresh = true;
      },
      update: (u: any) => {
        const kind = u?.sessionUpdate;
        if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
          const k = kind === "agent_message_chunk" ? "unii" : "mind";
          const text = String(u.content?.text ?? "");
          const top = open[open.length - 1];
          top !== undefined && top.kind === k ? (top.text += text) : open.push({ kind: k, text });
          if (k === "unii") {
            all = top !== undefined && top.kind === "unii" ? all + text : text;
          }
          emit(k, text);
          return;
        }
        if (kind !== "tool_call" && kind !== "tool_call_update") {
          return;
        }
        const id = String(u.toolCallId ?? "");
        const input = u.rawInput;
        if (!logged.has(id) && input !== undefined && Object.keys(input).length > 0) {
          t.flush();
          logged.add(id);
          const ours = input.providerIdentifier === SERVER;
          t.acted ||= ours;
          const name = ours ? String(input.toolName) : String(u.title ?? u.kind ?? "tool").replace(/`/g, "");
          on({ $: "Entry", kind: "tool", text: name + " " + JSON.stringify(ours ? input.args ?? {} : input), of: id });
        }
        if (logged.has(id) && (u.status === "completed" || u.status === "failed")) {
          const out = AskAI.show(u.content) || (u.rawOutput === undefined ? "" : JSON.stringify(u.rawOutput));
          on({ $: "Entry", kind: "echo", text: (u.status === "failed" ? "error: " : "") + (out || "(no output)"), of: id });
        }
      },
    };
    return t;
  }

  // The agent's pipes
  // -----------------

  // a request's answer
  export type Reply = { result?: any; error?: { message?: string; code?: number } };

  export type Acp = {
    cwd    : string;
    ask    : (method: string, params: object) => Promise<Reply>;
    notify : (method: string, params: object) => void;
    listen : (update: any) => void;
    close  : () => void;
    dead   : () => boolean;
    err    : () => string;
  };

  // the agent started (argv: bubblewrap's, CursorSub.sandbox), spoken to
  // a JSON line each way: our requests answered by id, its updates heard,
  // its requests answered (a permission by CursorSub.permit, any other
  // refused: we offer no files nor terminal). Its stderr kept (its last
  // KB), for why it ended
  export function spawn(argv: string[]): Acp {
    const cwd = argv[argv.indexOf("--chdir") + 1];
    const proc = child.spawn(argv[0], argv.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    const waits = new Map<number, (r: Reply) => void>();
    let n = 0;
    let gone = false;
    let err = "";
    const write = (m: object) => {
      if (!gone) {
        proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
      }
    };
    const end = () => {
      gone = true;
      waits.forEach((ok) => ok({ error: { message: "the agent ended" } }));
      waits.clear();
    };
    proc.once("exit", end);
    proc.once("error", end);
    proc.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-1024)));
    let buf = "";
    const acp: Acp = {
      cwd,
      listen: () => {},
      ask: (method, params) => new Promise((ok) => {
        if (gone) {
          return ok({ error: { message: "the agent ended" } });
        }
        const id = ++n;
        waits.set(id, ok);
        write({ id, method, params });
      }),
      notify: (method, params) => write({ method, params }),
      close: () => {
        proc.stdin.end();
        proc.kill();
      },
      dead: () => gone,
      err: () => err,
    };
    proc.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      for (let k = buf.indexOf("\n"); k >= 0; k = buf.indexOf("\n")) {
        const line = buf.slice(0, k).trim();
        buf = buf.slice(k + 1);
        let m: any;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.method === undefined && m.id !== undefined) {
          waits.get(m.id)?.(m);
          waits.delete(m.id);
        } else if (m.method === "session/update") {
          acp.listen(m.params?.update);
        } else if (m.method === "session/request_permission" && m.id !== undefined) {
          const pick = CursorSub.permit(m.params);
          write({ id: m.id, result: { outcome: pick === null ? { outcome: "cancelled" } : { outcome: "selected", optionId: pick } } });
        } else if (m.id !== undefined) {
          write({ id: m.id, error: { code: -32601, message: "not offered" } });
        }
      }
    });
    return acp;
  }

}
