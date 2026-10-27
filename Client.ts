import * as fs from "node:fs";
import * as os from "node:os";
import { get, rec, text_of } from "./Json.ts";
import * as View from "./View.ts";
import { write_whole } from "./Write.ts";

const DIR   = (process.env.XDG_CONFIG_HOME || os.homedir() + "/.config") + "/unii";
const LOCAL = "http://127.0.0.1:8788";

export const Socket = WebSocket as unknown as new (url: string, options: Bun.WebSocketOptions) => WebSocket;

export function read(name: string): Record<string, unknown> {
  try {
    const json: unknown = JSON.parse(fs.readFileSync(DIR + "/" + name + ".json", "utf8"));
    return rec(json) ? json : {};
  } catch {
    return {};
  }
}

export function tokens(conf: Record<string, unknown>): Record<string, string> {
  return rec(conf.tokens) ? Object.fromEntries(Object.entries(conf.tokens).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))) : {};
}

export function write(name: string, conf: object): void {
  const file = DIR + "/" + name + ".json";
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  write_whole(file, JSON.stringify(conf, null, 2) + "\n");
}

export function server(given: string | undefined, conf: Record<string, unknown>): string {
  return (given ?? process.env.UNII_URL ?? (typeof conf.url === "string" ? conf.url : undefined) ?? LOCAL).replace(/\/$/, "");
}

export function auth(token: string | undefined): Record<string, string> {
  return token ? { authorization: "Bearer " + token } : {};
}

// how long asking whether signed in may take (ms): a hung ask would stop a
// device reconnecting
const PING_ME = 10e3;

// whether a token (or none: one of the owner's tailnet nodes) is signed
// in: the server doesn't refuse it (one it can't reach may be, if a token
// is kept: the client waits for it)
export async function signed(url: string, token: string | undefined): Promise<boolean> {
  // with none, still asked: the server signs in the owner's tailnet nodes
  // by themselves (Tailnet.ts)
  const res = await fetch(url + "/api/me", { headers: auth(token), signal: AbortSignal.timeout(PING_ME) }).catch(() => null);
  return res === null ? Boolean(token) : res.status !== 401;
}

export async function login(url: string, what: string): Promise<string> {
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const out = await View.post(url + "/api/login", { key, what });
  const link = get(out, "url");
  if (typeof link !== "string") {
    fail(text_of(get(out, "error"), "no sign-in from " + url));
  }
  console.log("Para conectar " + what + " a " + url + ", abra este link num navegador em que você já entrou como dono");
  console.log("(no servidor, `unii serve link` faz um navegador entrar):\n\n  " + link + "\n");
  console.log("e digite este código: " + String(get(out, "code")) + "\n");
  const wait = { headers: auth(key), timeout: false } as RequestInit;
  while (true) {
    const done = await fetch(url + "/api/wait", wait).catch(() => null);
    const ans: unknown = (await done?.json().catch(() => ({}))) ?? {};
    if (done?.status === 410) {
      fail("o link expirou: rode o unii de novo para receber outro");
    }
    if (done?.ok && get(ans, "ok")) {
      console.log("Conectado.");
      return key;
    }
    if (done?.status !== 408) {
      await Bun.sleep(View.RETRY);
    }
  }
}

export function fail(why: string): never {
  console.error("unii: " + why);
  process.exit(1);
}

export function host(url: string): string {
  return new URL(url).host;
}
