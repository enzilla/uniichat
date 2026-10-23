// Owner
// =====
// The server's one owner, in one SQLite file (DIR/unii.db): the
// sign-ins of their browsers, terminals and devices (sessions, kept as
// hashes), the tickets that make one, their phones' and browsers' pushes,
// and the acts done (Server.ts Chat.apply).
//
// Sign-in: whoever can run `unii serve link` on the server (Owner.cli)
// is the owner. It prints a link, /auth?t=<ticket>, good once for
// LINK, which signs a browser in (a cookie). A terminal or a device
// (Term.ts, Device.ts) posts a token it made (/api/login) and waits
// (/api/wait) while the owner opens the link it prints in a browser
// signed in, and types the code it shows there (in no link). The iOS
// app's links open it (AASA). Its phones' and browsers' push
// subscriptions are kept here; Push.ts sends them each turn's last
// message.

import { Database } from "bun:sqlite";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as config from "./Config.ts";
import { Disk } from "./Disk.ts";
import { Push } from "./Push.ts";

// Types
// =====

// a sign-in begun: a browser's (session: null) or a terminal's or
// device's (the hash of the session it waits for, and what it says it is)
type Ticket = { session: string | null; what: string };

// Constants
// =========

export const FILE = config.DIR + "/unii.db";

const COOKIE = "unii";

// a session cookie's attributes: Secure only on an https site, as Safari
// drops a Secure cookie an http one (a server on 127.0.0.1) sets
const KEEP = "; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000" + (config.SITE.startsWith("https:") ? "; Secure" : "");

// how long an act's answer with words is kept (ms)
const ACTS = 7 * 864e5;

// how long a ticket lives; a wait for one at most; the tickets of
// terminals and devices waiting at once (none asks for many: no one
// fills the db, and anyone who reaches the server would have to keep
// that many waiting to keep the owner's out)
const LINK  = 15 * 60 * 1000;
const WAIT  = 5 * 60 * 1000;
const ASKS  = 100;

// the browsers that get pushes at once (the oldest beyond go)
const WEB_PUSHES = 32;

// the sign-in pages' look (Owner.page): a column a phone wide, the mark
// over the title, who asks in a chip, a device's warning tinted, the code
// in big, spaced digits, one button the column wide
const AUTH_CSS = `
body.auth main { width: min(400px, 100% - 40px); margin: 14vh auto 8vh; text-align: left; }
body.auth .mark { width: 34px; height: 34px; margin: 0 0 22px; }
body.auth h1 { font-size: 38px; }
body.auth main :is(p, h1) { text-wrap: pretty; }
body.auth .sub { font-size: 15px; line-height: 1.6; color: var(--mid); }
body.auth .sub strong, body.auth .who { color: var(--ink); }
body.auth .who { display: inline-block; padding: 1px 9px; border-radius: 7px; background: var(--block); font-weight: 600; }
body.auth .warn, body.auth .err, body.auth .hint { margin: 16px 0 0; padding: 12px 14px; border-radius: 10px; font-size: 14px; line-height: 1.5; }
body.auth .warn { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--ink); }
body.auth .err { background: color-mix(in srgb, var(--red) 12%, transparent); color: var(--red); }
body.auth .hint { padding: 0; color: var(--mid); font-size: 13px; }
body.auth form { display: grid; gap: 10px; margin: 22px 0 0; }
body.auth label { font-size: 13px; font-weight: 600; color: var(--mid); }
body.auth input[name=code] { width: 100%; box-sizing: border-box; padding: 14px 12px; border: 1px solid var(--hair); border-radius: 10px; background: var(--paper); color: var(--ink); font: 600 30px/1 var(--mono); letter-spacing: .3em; text-align: center; }
body.auth input[name=code]:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
body.auth button { width: 100%; padding: 13px; border: 0; border-radius: 10px; background: var(--ink); color: var(--paper); font: 600 15px/1 var(--sans); cursor: pointer; }
body.auth button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
body.auth code { padding: 1px 6px; border-radius: 5px; background: var(--block); font: 13px var(--mono); color: var(--ink); }
`;

const SCHEMA = `
create table if not exists sessions (hash text primary key, what text not null default '', at integer not null default 0);
create table if not exists tickets  (hash text primary key, data text not null, expires integer not null);
create table if not exists pushes   (token text primary key, session text not null);
create trigger if not exists pushes_go after delete on sessions begin delete from pushes where session = old.hash; end;
create table if not exists web_pushes (endpoint text primary key, p256dh text not null, auth text not null, session text not null);
create trigger if not exists web_pushes_go after delete on sessions begin delete from web_pushes where session = old.hash; end;
create table if not exists acts     (id text primary key, ans text not null, at integer not null);
create index if not exists acts_big on acts (at) where ans <> '{}';
`;

// the db (open: Owner.open), the terminals waiting for their sign-in, by
// session
let DB: Database | null = null;
const WAITS = new Map<string, () => void>();

// Owner
// =====

export namespace Owner {

  export function open(): Database {
    if (DB === null) {
      fs.mkdirSync(config.DIR, { recursive: true, mode: 0o700 });
      DB = Disk.db(FILE);
      DB.exec(SCHEMA);
    }
    return DB;
  }

  // Sign-in
  // -------

  export function hash(token: string): string {
    return new Bun.CryptoHasher("sha256").update(token).digest("hex");
  }

  export function token(req: Request): string {
    const auth = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    const cookies = (req.headers.get("cookie") ?? "").split(/;\s*/);
    const cookie = cookies.find((c) => c.startsWith(COOKIE + "=")) ?? "";
    return auth || decodeURIComponent(cookie.slice(COOKIE.length + 1));
  }

  // whether a request is the owner's (a session kept)
  export function is(req: Request): boolean {
    return Owner.open().query("select 1 from sessions where hash = ?").get(Owner.hash(Owner.token(req))) !== null;
  }

  export function random(): string {
    return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  }

  export function ticket(data: Ticket): string {
    const db = Owner.open();
    const token = Owner.random();
    db.query("delete from tickets where expires < ?").run(Date.now());
    db.query("insert into tickets values (?, ?, ?)").run(Owner.hash(token), JSON.stringify(data), Date.now() + LINK);
    return token;
  }

  // a ticket not expired, by its token: used (gone), or kept (the
  // confirm page reads it)
  export function ticket_read(token: string, use: boolean): Ticket | null {
    const sql = use ? "delete from tickets where hash = ? and expires >= ? returning data" : "select data from tickets where hash = ? and expires >= ?";
    const row = Owner.open().query(sql).get(Owner.hash(token), Date.now()) as { data: string } | null;
    return row === null ? null : JSON.parse(row.data);
  }

  // the six digits a terminal's sign-in shows and the owner types on the
  // confirm page: proof they hold that terminal (in no link); derived
  // from the session, so nothing extra is stored
  export function code(session: string): string {
    return (parseInt(session.slice(0, 8), 16) % 1e6).toString().padStart(6, "0");
  }

  // the sessions kept, by hash: a socket of one gone closes (Server.ts)
  export function kept(): Set<string> {
    return new Set((Owner.open().query("select hash from sessions").all() as { hash: string }[]).map((r) => r.hash));
  }

  // `unii serve sessions`: every sign-in, numbered, this computer's
  // terminal's and device's marked (their tokens in ~/.config/unii);
  // `unii serve revoke <n>|--all`: one or all gone, its sockets closed
  // within PING / 2 by the running server, its pushes with it. Last use
  // isn't tracked
  export async function sessions(revoke?: string): Promise<void> {
    const db = Owner.open();
    const rows = db.query("select hash, what, at from sessions order by rowid").all() as { hash: string; what: string; at: number }[];
    if (revoke === "--all") {
      db.query("delete from sessions").run();
      return console.log("Signed out " + rows.length + " session" + (rows.length === 1 ? "" : "s") + ": every browser, terminal and device signs in again.");
    }
    if (revoke !== undefined) {
      const row = rows[Number(revoke) - 1];
      if (!/^\d+$/.test(revoke) || row === undefined) {
        throw new Error("no session " + revoke + (rows.length === 0 ? ": there are none" : ": `unii serve sessions` numbers them 1 to " + rows.length));
      }
      db.query("delete from sessions where hash = ?").run(row.hash);
      return console.log("Signed out " + revoke + " (" + (row.what || "a session") + ").");
    }
    const Client = await import("./Client.ts");
    const tui = Client.read("tui").tokens ?? {};
    const mine = new Map<string, string>([...Object.values(tui).map((t) => [Owner.hash(String(t)), "this computer's terminal"] as [string, string]), [Owner.hash(String(Client.read("device").token ?? "")), "this computer's device"]]);
    const kind = (what: string) => (what.startsWith("the device ") ? "device" : what.startsWith("the terminal ") ? "terminal" : what === "a browser" ? "browser" : "-");
    const when = (at: number) => (at > 0 ? new Date(at).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "before arteeh.17");
    rows.forEach((r, i) => console.log(String(i + 1).padStart(3) + ". " + kind(r.what).padEnd(9) + (r.what || "-").padEnd(32) + " signed in " + when(r.at) + (mine.has(r.hash) ? "  (" + mine.get(r.hash) + ")" : "")));
    console.log(rows.length === 0 ? "No sessions." : "Last use isn't tracked. `unii serve revoke <n>` signs one out; `--all`, all.");
  }

  // `unii serve link`: a browser's sign-in link, printed; run where the
  // server's files are (who can, owns them)
  export function cli(): void {
    console.log("Open this link in your browser within 15 minutes to sign in (it works once):\n\n  " + config.SITE + "/auth?t=" + Owner.ticket({ session: null, what: "" }) + "\n");
  }

  // Acts
  // ----
  // The acts recorded (Server.ts Chat.act: posts, stops that ended work),
  // by id, kept for good, so none runs again; an answer with words (a
  // recording's) is kept ACTS, then only that it was done

  export function act_put(id: string, ans: object): void {
    const db = Owner.open();
    db.query("update acts set ans = '{}' where at < ? and ans <> '{}'").run(Date.now() - ACTS);
    db.query("insert or ignore into acts values (?, ?, ?)").run(id, JSON.stringify(ans), Date.now());
  }

  // null: not done
  export function act_get(id: string): object | null {
    const row = Owner.open().query("select ans from acts where id = ?").get(id) as { ans: string } | null;
    return row === null ? null : JSON.parse(row.ans);
  }

  // HTTP
  // ----

  // null: not a request of sign-in or pushes
  export async function http(req: Request): Promise<Response | null> {
    const db = Owner.open();
    const url = new URL(req.url);
    const owner = Owner.is(req);
    switch (url.pathname) {
      case "/api/login": {
        const body = await req.json().catch(() => ({}));
        const key = String(body.key ?? "");
        const asks = db.query("select count(*) n from tickets where expires >= ? and data ->> 'session' is not null").get(Date.now()) as { n: number };
        if (key.length < 32 || asks.n >= ASKS) {
          return Response.json({ error: key.length < 32 ? "No key." : "Too many sign-ins waiting: try again in 15 minutes." }, { status: key.length < 32 ? 400 : 429 });
        }
        const session = Owner.hash(key);
        const what = String(body.what ?? "a terminal").replace(/[^\w .,:@()-]/g, "").slice(0, 80);
        const link = config.SITE + "/auth?t=" + Owner.ticket({ session, what });
        return Response.json({ url: link, code: Owner.code(session) });
      }
      case "/auth": {
        const t = url.searchParams.get("t") ?? "";
        if (req.method === "POST") {
          return Owner.confirm(req);
        }
        const link = Owner.ticket_read(t, false);
        if (link === null) {
          return Owner.page("Este link expirou", "Cada link vale uma vez, por 15 minutos. Peça um novo: rode <code>unii serve link</code> no servidor, ou abra de novo o terminal ou o dispositivo.");
        }
        if (link.session !== null) {
          return owner ? Owner.page_confirm(t, link.what, "") : Owner.page("Entre primeiro neste navegador", "Só o dono do servidor autoriza um acesso. Rode <code>unii serve link</code> no servidor, abra o link que ele mostrar e depois abra este link de novo.");
        }
        // a button, so a chat app's preview of the link doesn't use it up
        return Owner.page("Entrar neste navegador", `Este navegador passa a ser o do dono deste servidor do unii: conversa, configurações e a autorização de terminais e dispositivos.</p><form method="post" action="/auth"><input type="hidden" name="t" value="${Owner.safe(t)}"><button type="submit" autofocus>Entrar</button></form><p>`);
      }
      case "/api/wait": {
        if (owner) {
          return Response.json({ ok: true });
        }
        const hash = Owner.hash(Owner.token(req));
        const waits = db.query("select 1 from tickets where expires >= ? and data ->> 'session' = ?").get(Date.now(), hash) !== null;
        if (!waits) {
          return Response.json({ error: "The sign-in link expired." }, { status: 410 });
        }
        const signed = await new Promise<boolean>((done) => {
          const timer = setTimeout(() => done(false), WAIT);
          WAITS.set(hash, () => { clearTimeout(timer); done(true); });
          req.signal.addEventListener("abort", () => { clearTimeout(timer); done(false); });
        });
        WAITS.delete(hash);
        return Response.json({ ok: signed }, signed ? {} : { status: 408 });
      }
      case "/.well-known/apple-app-site-association": {
        const links = [{ "/": "/auth" }];
        return config.APPLE ? Response.json({ applinks: { details: [{ appIDs: [config.APPLE], components: links }] } }) : null;
      }
      case "/api/logout": {
        db.query("delete from sessions where hash = ?").run(Owner.hash(Owner.token(req)));
        return Owner.out();
      }
    }
    if (!owner) {
      return null;
    }
    switch (url.pathname) {
      case "/api/me": {
        return Response.json({ ok: true });
      }
      case "/api/push": {
        const token = (await req.text()).trim();
        if (!/^[0-9a-f]{64,256}$/.test(token)) {
          return Response.json({ error: "Not a push token" }, { status: 400 });
        }
        db.query("insert or replace into pushes values (?, ?)").run(token, Owner.hash(Owner.token(req)));
        return Response.json({ ok: true });
      }
      case "/api/webpush": {
        return Owner.web_subscribe(req);
      }
    }
    return null;
  }

  // a browser's notifications (main.ts notify): GET, the server's key and
  // whether this sign-in has that endpoint (?endpoint=); POST, its
  // subscription, kept for this sign-in (posted from another, it moves
  // there); DELETE, its endpoint, forgotten
  export async function web_subscribe(req: Request): Promise<Response> {
    const db = Owner.open();
    const session = Owner.hash(Owner.token(req));
    if (req.method === "GET") {
      const endpoint = new URL(req.url).searchParams.get("endpoint") ?? "";
      const row = db.query("select 1 from web_pushes where endpoint = ? and session = ?").get(endpoint, session);
      return Response.json({ key: Push.keys()?.public ?? null, on: row !== null });
    }
    const body = await req.json().catch(() => null);
    if (req.method === "DELETE") {
      db.query("delete from web_pushes where endpoint = ?").run(String(body?.endpoint ?? ""));
      return Response.json({ ok: true });
    }
    const sub = Push.sub_read(body);
    if (req.method !== "POST" || sub === null || (await Push.inside(sub.endpoint))) {
      return Response.json({ error: "Not a push subscription" }, { status: 400 });
    }
    // kept only if this sign-in still lives (it may have ended while the
    // body was read)
    const sql = "insert or replace into web_pushes select ?, ?, ?, hash from sessions where hash = ?";
    if (db.query(sql).run(sub.endpoint, sub.p256dh, sub.auth, session).changes === 0) {
      return Response.json({ error: "Signed out" }, { status: 401 });
    }
    db.query("delete from web_pushes where rowid not in (select rowid from web_pushes order by rowid desc limit ?)").run(WEB_PUSHES);
    return Response.json({ ok: true });
  }

  // the answer that signs a browser out
  export function out(): Response {
    return new Response(null, { status: 204, headers: { "set-cookie": COOKIE + "=; Path=/; Max-Age=0" } });
  }

  // a browser's link's button: the browser signs in (its sign-in before
  // ends, and its pushes with it). Or the code typed on the confirm page
  // (by the owner: a browser signed in): right, the terminal or device
  // signs in, its wait on /api/wait woken
  export async function confirm(req: Request): Promise<Response> {
    const form = await req.formData().catch(() => new FormData());
    const t = String(form.get("t") ?? "");
    const typed = String(form.get("code") ?? "").replace(/\D/g, "");
    const link = Owner.ticket_read(t, false);
    if (link !== null && link.session === null) {
      Owner.ticket_read(t, true);
      const db = Owner.open();
      db.query("delete from sessions where hash = ?").run(Owner.hash(Owner.token(req)));
      const token = Owner.random();
      db.query("insert into sessions values (?, ?, ?)").run(Owner.hash(token), "a browser", Date.now());
      return new Response(null, { status: 303, headers: { location: config.SITE + "/", "set-cookie": COOKIE + "=" + token + KEEP } });
    }
    if (link === null || link.session === null || !Owner.is(req)) {
      return Owner.page("Este link expirou", "Abra de novo o terminal ou o dispositivo para receber um link novo.");
    }
    if (typed !== Owner.code(link.session)) {
      return Owner.page_confirm(t, link.what, "O código não confere. Confira o código mostrado e tente de novo.");
    }
    Owner.open().query("insert or ignore into sessions values (?, ?, ?)").run(link.session, link.what, Date.now());
    Owner.ticket_read(t, true);
    WAITS.get(link.session)?.();
    const who = Owner.safe(Owner.who(link.what));
    return Owner.page("Pronto", "<strong>" + who.charAt(0).toUpperCase() + who.slice(1) + "</strong> está conectado a este servidor. Pode fechar esta aba e voltar para ele.");
  }

  // the page a terminal's or device's link opens: who asks, what it may
  // do (a device: run commands and edit files on its computer), and the
  // code it shows to type
  export function page_confirm(t: string, what: string, err: string): Response {
    const note = err === "" ? "" : `<p class="err" role="alert">${err}</p>`;
    const device = /\b(device|dispositivo)\b/i.test(what);
    const may = device
      ? `<p class="warn">Um dispositivo deixa o Unii <strong>rodar comandos e editar arquivos</strong> naquele computador. Autorize só se foi você quem o iniciou.</p>`
      : `<p class="hint">Ele poderá ler e enviar mensagens neste servidor como você.</p>`;
    const form = `<form method="post" action="/auth"><input type="hidden" name="t" value="${Owner.safe(t)}"><label for="code">Código mostrado no ${device ? "dispositivo" : "terminal"}</label><input id="code" name="code" inputmode="numeric" pattern="[0-9 ]*" maxlength="9" autocomplete="one-time-code" autofocus required><button type="submit">Autorizar</button></form>`;
    return Owner.page("Autorizar acesso", `<span class="who">${Owner.safe(Owner.who(what))}</span> quer usar este servidor.</p>${may}${note}${form}<p class="hint">Se não foi você quem pediu, feche esta página: sem o código, nada acontece.`);
  }

  // who asks, as the terminal and device name themselves (an older one
  // says it in English)
  export function who(what: string): string {
    return what.replace(/^the terminal on /, "o terminal em ").replace(/^the device /, "o dispositivo ").replace(/^a terminal$/, "um terminal");
  }

  export function safe(s: string): string {
    return s.replace(/[<>&"]/g, "");
  }

  // a sign-in page: the mark, a title, its text (HTML: a form may close
  // and reopen its paragraph); its look here (AUTH_CSS), on the site's
  // colors and fonts (style.css)
  export function page(title: string, body: string): Response {
    const page = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} · UniiChat</title><link rel="stylesheet" href="/style.css"><style>${AUTH_CSS}</style></head><body class="solo auth"><main><span class="mark" aria-hidden="true"></span><h1>${title}</h1><p class="sub">${body}</p></main></body></html>`;
    return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

}
