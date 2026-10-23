// Tailnet
// =======
// The owner by their Tailscale identity (config tailnet_owner: a login as
// `tailscale whois` names it, e.g. name@github): a request with no session
// from a node of that login, not a tagged one (a server's, or one shared
// in), is the owner's, as a sign-in would make it, so a phone, a browser,
// a terminal or a device on the tailnet needs no link nor code. Each node
// has its own session, its token derived from the server's key
// (tailnet.key) and the node's stable id, so it outlives a restart and
// what hangs on it (a phone's pushes). The request's peer: the proxy's
// X-Real-IP when the connection comes from this host (the Nginx in front
// of the server), else none (a request from this host itself signs in as
// before). Asked of tailscaled (`tailscale whois`), each address's answer
// kept a minute.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as config from "./Config.ts";
import { Owner } from "./Owner.ts";

// Types
// =====

// a node of the tailnet, as whois tells: its owner's login, its name,
// its stable id, whether it is tagged (then owned by no user)
export type Who = { login: string; node: string; id: string; tagged: boolean };

// Constants
// =========

// how long an address's whois holds (ms)
const KEEP = 60e3;

// how long a whois may take (ms)
const LATE = 3e3;

const KEY = config.DIR + "/tailnet.key";

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;

// State
// =====

const ASKED = new Map<string, { at: number; who: Promise<Who | null> }>();

// Tailnet
// =======

// the address the request came from: the proxy's X-Real-IP if the
// connection is this host's (the Nginx in front), else null
export function peer(req: Request, ip: string | null): string | null {
  if (ip === null || !LOOPBACK.test(ip)) {
    return null;
  }
  const real = (req.headers.get("x-real-ip") ?? "").trim();
  return real === "" || LOOPBACK.test(real) ? null : real;
}

// who a tailnet address is (null: none, or tailscaled can't say), a
// minute kept
export function whois(ip: string, ask: (ip: string) => Promise<Who | null> = tailscale_whois): Promise<Who | null> {
  const was = ASKED.get(ip);
  if (was !== undefined && Date.now() - was.at < KEEP) {
    return was.who;
  }
  const who = ask(ip).catch(() => null);
  ASKED.set(ip, { at: Date.now(), who });
  return who;
}

async function tailscale_whois(ip: string): Promise<Who | null> {
  const proc = Bun.spawn(["tailscale", "whois", "--json", ip], { stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => proc.kill(), LATE);
  const text = await new Response(proc.stdout).text();
  clearTimeout(timer);
  if ((await proc.exited) !== 0) {
    return null;
  }
  const d = JSON.parse(text);
  const tags = d?.Node?.Tags;
  return { login: String(d?.UserProfile?.LoginName ?? ""), node: String(d?.Node?.ComputedName ?? d?.Node?.Name ?? ""), id: String(d?.Node?.StableID ?? ""), tagged: Array.isArray(tags) && tags.length > 0 };
}

// the owner's node's session token for a request with none, made a
// session if new; null if the request isn't from one of the owner's
// nodes (or tailnet_owner is unset)
export async function adopt(req: Request, ip: string | null, owner = config.TAILNET_OWNER, ask?: (ip: string) => Promise<Who | null>): Promise<string | null> {
  const from = peer(req, ip);
  if (owner === "" || from === null || Owner.is(req)) {
    return null;
  }
  const who = await whois(from, ask);
  if (who === null || who.tagged || who.id === "" || who.login.toLowerCase() !== owner.toLowerCase()) {
    return null;
  }
  const token = node_token(who.id);
  Owner.open().query("insert or ignore into sessions values (?, ?, ?)").run(Owner.hash(token), "o aparelho " + who.node + " (tailnet)", Date.now());
  Owner.adopt(req, token);
  return token;
}

// a node's token: its stable id signed with the server's key (made once)
export function node_token(id: string): string {
  return crypto.createHmac("sha256", key()).update("tailnet:" + id).digest("base64url");
}

function key(): Buffer {
  try {
    fs.writeFileSync(KEY, crypto.randomBytes(32), { mode: 0o600, flag: "wx" });
  } catch {} // made before (by this process or another)
  return fs.readFileSync(KEY);
}
