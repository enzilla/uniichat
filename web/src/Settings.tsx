// The settings (/settings, or /account), a dialog over the chat
// ==============================================================
// The prompts; this browser's own acts (sign out, its notifications,
// export); the MCP switches; then the server's settings (config.json):
// models (vendors, models, the default pick, the compactor's, the
// subagents'), Cursor's plan, profiles (ranked models), keys, server.
// Html.ts's account_html and settings_html, and main.ts's form logic, as
// a form whose state is the component's. Esc in a box leaves the box
// first (an edit not saved stays)
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Vendor } from "../../AskAI.ts";
import { get, text_of } from "../../Json.ts";
import { EFFORTS, LABELS, Pick, VENDORS } from "../../Pick.ts";
import type { Key, Page, Row } from "../../Settings.ts";
import * as View from "../../View.ts";
import { Mcp } from "./Bars.tsx";
import { Icon } from "./Icon.tsx";
import { APP, go, signout } from "./main.tsx";
import { P, RENEW, draw, toast, v } from "./state.ts";

// this browser's notifications: off, on, blocked in its settings, or
// only once on the Home Screen (an iPhone's Safari)
type Notify = "off" | "on" | "blocked" | "home";

const SETTING: Record<string, [string, string]> = {
  vendors    : ["Vendors", "Whose models the server offers."],
  models     : ["Models", "The models offered, of those vendors."],
  pick       : ["Default model", "What a chat runs on until it picks another."],
  compactor  : ["Compactor model", "What writes the memory's summaries."],
  agents     : ["Subagent model", "What subagents run on."],
  cursor_fast: ["Cursor fast", "Desligado por padrão: o cursor-sub roda o Composer sem a variante fast, que consome mais do plano."],
  site       : ["Site", "The server's address, for sign-in links and the installer."],
  apple      : ["iOS App ID", "The app's team and bundle ID, whose sign-in links it opens."],
  apns       : ["APNs key ID", "The ID of the key the app's pushes are signed with."],
};

const KEY: Record<string, [string, string]> = {
  anthropic : ["Anthropic key", "For claude-api's models."],
  openai    : ["OpenAI key", "For openai-api's models and dictation."],
  apns      : ["APNs key", "The .p8 key the iOS app's pushes are signed with."],
};

const VENDOR_KEY: Record<string, string> = { "claude-api": "anthropic", "openai-api": "openai" };

const PICKS = ["pick", "compactor", "agents"];

const GROUPS: Array<[string, string[]]> = [
  ["Models", ["vendors", "models", "pick", "compactor", "agents"]],
  ["Plano do Cursor", ["cursor_fast"]],
  ["Server", ["site", "apple", "apns"]],
];

function list(text: string): string[] {
  return text.split(",").map((x) => x.trim()).filter((x) => x !== "");
}

function list_changed(was: string[], now: string[]): string[] | null {
  const same = was.length === now.length && was.every((x) => now.includes(x)) && now.every((x) => was.includes(x));
  return same ? null : [...was.filter((x) => now.includes(x)), ...now.filter((x) => !was.includes(x))];
}

function offered(vendors: string[], models: string[]): string[] {
  return Pick.models(VENDORS.filter((x) => vendors.includes(x)), models).map(([x, m]) => x + ":" + m.label);
}

// a pick's parts made whole: a profile alone; a vendor's model, its
// effort (medium) and a speed it has
function pick_mend(parts: string[], models: string[], profiles: string[] = []): string {
  const [vendor = "", model = "", effort = "", speed = ""] = parts;
  if (profiles.includes(vendor)) {
    return vendor;
  }
  if (!(VENDORS as string[]).includes(vendor)) {
    return vendor === "" ? "" : parts.join(":");
  }
  const m = Pick.model(vendor as Vendor, model) ?? Pick.models([vendor as Vendor], models)[0]?.[1];
  if (m === undefined) {
    return parts.join(":");
  }
  return [vendor, m.label, effort || "medium", m.speeds.includes(speed) ? speed : m.speeds[0]].join(":");
}

export function Settings({ open }: { open: boolean }): ReactNode {
  const dlg = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const d = dlg.current!;
    if (open && !d.open) {
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);
  return (
    <dialog
      id="settings"
      ref={dlg}
      aria-label="Configurações"
      onCancel={(ev) => {
        ev.preventDefault();
        const at = document.activeElement as HTMLElement | null;
        if (at !== null && dlg.current!.contains(at) && at.matches("input, textarea, select")) {
          at.blur();
          return;
        }
        go("/");
      }}
      onClose={() => location.pathname !== "/" && ["/settings", "/account"].includes(location.pathname) && go("/")}
    >
      <button className="shut" type="button" aria-label="Fechar as configurações" title="Fechar (Esc)" onClick={() => go("/")}><Icon name="close" /></button>
      {open ? <Account /> : null}
    </dialog>
  );
}

type Prompts = View.Prompts | null;

function Account(): ReactNode {
  const [read, setRead] = useState<{ prompts: Prompts; push: Notify | null; page: Page | null; failed: boolean } | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let live = true;
    void (async () => {
      const [got, set] = await Promise.all([fetch("/api/prompts").catch(() => null), fetch("/api/settings").catch(() => null)]);
      const prompts = got !== null && got.ok ? ((await got.json().catch(() => null)) as Prompts) : null;
      const push = await notify_state().catch(() => null);
      const page = set?.ok ? ((await set.json().catch(() => null)) as Page | null) : null;
      if (live) {
        RENEW.dirty.clear();
        setRead({ prompts, push, page, failed: page === null });
      }
    })();
    return () => {
      live = false;
    };
  }, [asked]);
  if (read === null) {
    return <div id="account"><p className="state"><Icon name="loading" />Lendo as configurações do servidor…</p></div>;
  }
  const again = () => setAsked(asked + 1);
  return (
    <div id="account">
      <h1>Configurações</h1>
      <section>
        <h2>Prompts</h2>
        {read.prompts === null
          ? <div className="item"><p><Icon name="alert" />Could not read the prompts.</p><button className="chip retry" onClick={again}>Try again</button></div>
          : <>
              <PromptForm name="prompt" text={read.prompts.prompt.text} note="The user prompt: Unii's system prompt in every turn; its subagents get it too once you change it. Add who you are and how you want work done at its end. prompt.md in the server's folder; empty: the built-in one." />
              <PromptForm name="compact" text={read.prompts.compact.text} note="The compaction prompt: all a summary of the memory gets, nothing else. compact.md in the server's folder; empty: the built-in one." />
            </>}
      </section>
      <section>
        <h2>This browser</h2>
        <div className="item"><p>This browser<small>Signed in to this server.</small></p><button className="chip out" onClick={() => void signout()}>Sign out</button></div>
        {read.push === null ? null : <NotifyItem push={read.push} again={again} />}
        <div className="item"><p>Export memory<small>The chat and its summaries, in one file.</small></p><a className="chip" href="/export">Download</a></div>
      </section>
      <section>
        <h2>MCP servers</h2>
        <div className="mcp">{v.pick === null ? null : <Mcp plugs={v.mcp} />}</div>
      </section>
      <div className="owned">
        {read.page === null
          ? <p className="sub state"><Icon name="alert" />Could not read the server's settings. Try again in a moment.</p>
          : <ServerForm key={read.page.version} first={read.page} />}
      </div>
    </div>
  );
}

function PromptForm({ name, text, note }: { name: string; text: string; note: string }): ReactNode {
  const area = useRef<HTMLTextAreaElement>(null);
  const [why, setWhy] = useState("");
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirty = "prompt:" + name;
  const save = async () => {
    const box = area.current!;
    const sent = box.value;
    setBusy(true);
    RENEW.saving++;
    const out = await View.post("/api/prompts", { [name]: sent });
    RENEW.saving--;
    setBusy(false);
    const saved = get(out[name], "text");
    if (out.error === undefined && box.value === sent) {
      box.value = text_of(saved, sent);
    }
    setWhy(text_of(out.error, box.value === saved ? "Saved." : "Not saved yet: Save again."));
    setBad(out.error !== undefined);
    if (out.error === undefined && box.value === sent) {
      RENEW.dirty.delete(dirty);
      RENEW.since = true;
    }
    draw(false);
  };
  return (
    <form className={"prompt" + (bad ? " bad" : "")} onInput={() => RENEW.dirty.add(dirty)} onSubmit={(ev) => { ev.preventDefault(); void save(); }}>
      <p className="note">{note}</p>
      <textarea ref={area} name={name} rows={12} spellCheck={false} defaultValue={text}></textarea>
      <div><p className="why">{why}</p><button className="chip" disabled={busy}>Save</button></div>
    </form>
  );
}

function NotifyItem({ push, again }: { push: Notify; again: () => void }): ReactNode {
  const [busy, setBusy] = useState(false);
  const note = {
    off     : "Respostas e pendências que precisam de você, neste aparelho, quando o UniiChat não está aberto.",
    on      : "Respostas e pendências que precisam de você, neste aparelho, quando o UniiChat não está aberto.",
    blocked : "Bloqueadas nas configurações deste navegador para este site.",
    home    : "No iPhone e no iPad: toque em Compartilhar, depois em Adicionar à Tela de Início, e abra o UniiChat por lá.",
  }[push];
  return (
    <div className="item">
      <p>Notificações<small>{note}</small></p>
      {push === "home" ? null : <button className="chip notify" disabled={push === "blocked" || busy} onClick={() => { setBusy(true); void notify(push !== "on").then(again); }}>{push === "on" ? "Desativar" : "Ativar"}</button>}
    </div>
  );
}

async function notify_state(): Promise<Notify | null> {
  P.push = null;
  if (APP !== null) {
    return null;
  }
  if (navigator.serviceWorker === undefined || !("PushManager" in window) || !("Notification" in window)) {
    return /iPhone|iPad/.test(navigator.userAgent) ? "home" : null;
  }
  if (Notification.permission === "denied") {
    return "blocked";
  }
  const wait = new Promise<undefined>((ok) => setTimeout(ok, 3000, undefined));
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await Promise.race([navigator.serviceWorker.ready, wait]));
  const sub = await notify_sub();
  const query = sub === null ? "" : "?endpoint=" + encodeURIComponent(sub.endpoint);
  const res = await fetch("/api/webpush" + query).catch(() => null);
  const out = res?.ok ? ((await res.json()) as { key: string | null; on: boolean }) : null;
  if (reg === undefined || out === null || out.key === null) {
    return null;
  }
  P.push = { reg, key: out.key };
  return out.on && notify_keyed(sub, out.key) ? "on" : "off";
}

// whether a subscription was made for the server's key (one made for a
// key it had before gets no push)
function notify_keyed(sub: PushSubscription | null, key: string): boolean {
  const had = sub?.options.applicationServerKey;
  return had != null && notify_bytes(key).join() === new Uint8Array(had).join();
}

function notify_bytes(key: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

async function notify_sub(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker?.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function notify(on: boolean): Promise<void> {
  const push = P.push;
  if (push === null) {
    return;
  }
  try {
    const out = on ? await notify_on(push.reg, push.key) : await notify_off(push.reg);
    toast(text_of(out.error, on ? "Notificações ativadas." : "Notificações desativadas."));
  } catch (err) {
    const denied = typeof Notification !== "undefined" && Notification.permission === "denied";
    toast(denied ? "As notificações estão bloqueadas nas configurações deste navegador." : (on ? "Não foi possível ativar as notificações: " : "Não foi possível desativar as notificações: ") + (err instanceof Error ? err.message : String(err)));
  }
}

async function notify_on(reg: ServiceWorkerRegistration, key: string): Promise<Record<string, unknown>> {
  const bytes = notify_bytes(key);
  const ask = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  const sub = await ask().catch(async (err: unknown) => {
    const old = await reg.pushManager.getSubscription();
    if (old === null || get(err, "name") !== "InvalidStateError") {
      throw err;
    }
    await old.unsubscribe();
    return ask();
  });
  return View.post("/api/webpush", sub.toJSON());
}

async function notify_off(reg: ServiceWorkerRegistration): Promise<Record<string, unknown>> {
  const sub = await reg.pushManager.getSubscription();
  if (sub !== null) {
    const headers = { "content-type": "application/json" };
    await fetch("/api/webpush", { method: "DELETE", headers, body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  }
  return {};
}

// The server's settings
// ---------------------
// values: each setting's value as edited; unset: those reset to their
// default (removed once saved); profs: the profiles as edited

type Profs = Array<[string, string[]]>;

function ServerForm({ first }: { first: Page }): ReactNode {
  const [page, setPage] = useState(first);
  const rows = new Map<string, Row>(page.settings.map((r) => [r.key, r]));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(page.settings.map((r) => [r.key, r.value])));
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [unset, setUnset] = useState<Set<string>>(new Set());
  const [profs, setProfs] = useState<Profs>(() => Object.entries(page.profiles ?? {}));
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const focus = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => {
    if (focus.current !== null) {
      (form.current?.querySelector<HTMLElement>(focus.current) ?? form.current?.querySelector<HTMLElement>(".pnew"))?.focus();
      focus.current = null;
    }
  });
  const vendors = list(values.vendors ?? "");
  const models = list(values.models ?? "");
  const names = profs.map(([name]) => name.trim()).filter((name) => name !== "");
  const dirty = () => RENEW.dirty.add("settings");
  const edit = (key: string, value: string) => {
    dirty();
    setValues({ ...values, [key]: value });
    setUnset(new Set([...unset].filter((k) => k !== key)));
    setErrs({ ...errs, [key]: "" });
  };
  const reset = (key: string) => {
    dirty();
    const r = rows.get(key);
    if (key.startsWith("key.")) {
      setKeys({ ...keys, [key.slice(4)]: "" });
    } else {
      setValues({ ...values, [key]: r?.def ?? "" });
    }
    setUnset(new Set([...unset, key]));
  };
  const keyless = vendors.filter((x) => {
    const name = VENDOR_KEY[x];
    const k = page.keys.find((y) => y.name === name);
    return k !== undefined && (k.from === "default" || unset.has("key." + name)) && (keys[name] ?? "").trim() === "";
  });
  const profs_set = (next: Profs, at: string) => {
    dirty();
    focus.current = at;
    setProfs(next);
    setErrs({ ...errs, profiles: "" });
  };
  const rename = (i: number, name: string) => {
    const was = profs[i][0].trim();
    const now = name.trim();
    const next: Record<string, string> = { ...values };
    for (const key of PICKS) {
      if (was !== "" && now !== "" && next[key] === was) {
        next[key] = now;
      }
    }
    setValues(next);
    const p = profs.map((x): [string, string[]] => [x[0], x[1]]);
    p[i][0] = name;
    dirty();
    setProfs(p);
  };
  const save = async () => {
    const set: Record<string, string | null> = {};
    const typed: Record<string, string | null> = {};
    for (const r of page.settings) {
      if (!r.web || r.from === "env") {
        continue;
      }
      const now = r.key === "vendors" || r.key === "models" ? list_changed(list(r.value), list(values[r.key] ?? ""))?.join(",") ?? r.value : (values[r.key] ?? r.value).trim();
      if (unset.has(r.key)) {
        set[r.key] = null;
      } else if (now !== r.value) {
        set[r.key] = now;
      }
    }
    for (const k of page.keys) {
      const t = (keys[k.name] ?? "").trim();
      if (unset.has("key." + k.name)) {
        typed[k.name] = null;
      } else if (t !== "") {
        typed[k.name] = t;
      }
    }
    setErrs({});
    let profiles: Record<string, string[]> | undefined;
    if (page.profiles != null) {
      const now = profs.map(([name, l]): [string, string[]] => [name.trim(), l]);
      const all = now.map(([name]) => name);
      const bad = all.includes("") ? "Name each profile." : all.some((name, k) => all.indexOf(name) !== k) ? "Two profiles have the same name." : now.some(([, l]) => l.length === 0) ? "Add a model to each profile." : null;
      if (bad !== null) {
        setErrs({ profiles: bad });
        form.current?.querySelector(".profiles")?.scrollIntoView({ block: "center" });
        return;
      }
      profiles = JSON.stringify(Object.fromEntries(now)) === JSON.stringify(page.profiles) ? undefined : Object.fromEntries(now);
    }
    if (Object.keys(set).length === 0 && Object.keys(typed).length === 0 && profiles === undefined) {
      setWhy("Nothing changed.");
      return;
    }
    setBusy(true);
    setWhy("");
    RENEW.saving++;
    const out = await View.post("/api/settings", { version: page.version, set, keys: typed, ...(profiles === undefined ? {} : { profiles }) });
    RENEW.saving--;
    setBusy(false);
    if (!out.ok) {
      const key = out.key === undefined ? null : text_of(out.key, "null");
      if (key !== null && form.current?.querySelector(`.set[data-key="${CSS.escape(key)}"]`)) {
        setErrs({ [key]: text_of(out.error, "Could not save.") });
        form.current.querySelector(`.set[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "center" });
      } else {
        setWhy(text_of(out.error, "Could not save."));
      }
      return;
    }
    const done = out as Page & { saved: string[] };
    const later = done.saved.filter((key) => page.settings.find((r) => r.key === key)?.apply === "restart");
    setPage(done);
    setValues(Object.fromEntries(done.settings.map((r) => [r.key, r.value])));
    setKeys({});
    setUnset(new Set());
    setProfs(Object.entries(done.profiles ?? {}));
    RENEW.dirty.delete("settings");
    RENEW.since = true;
    draw(false);
    toast(later.length === 0 ? "Saved." : "Saved. " + later.join(", ") + " " + (later.length === 1 ? "applies" : "apply") + " once the server restarts.");
  };
  const shown = new Map(page.settings.filter((r) => r.web && r.from !== "env").map((r) => [r.key, r]));
  const group = ([title, ks]: [string, string[]]) => {
    const here = ks.flatMap((k) => shown.get(k) ?? []);
    return here.length === 0 ? null : (
      <section key={title}>
        <h2>{title}</h2>
        {here.map((r) => (
          <Setting key={r.key} r={r} value={values[r.key] ?? ""} unset={unset.has(r.key)} err={errs[r.key] ?? ""} onReset={() => reset(r.key)}>
            <Control r={r} value={values[r.key] ?? ""} vendors={vendors} models={models} names={names} keyless={keyless} edit={edit} />
          </Setting>
        ))}
      </section>
    );
  };
  const key_shown = page.keys.filter((k) => k.from !== "env");
  return (
    <>
      <p className="sub">The server's settings, in config.json in its folder.</p>
      {page.error === null ? null : <p className="why bad">{page.error}</p>}
      {page.none === null ? null : <p className="why bad">{page.none.split("`").map((x, k) => (k % 2 === 1 ? <code key={k}>{x}</code> : x))}.</p>}
      <form className="settings" autoComplete="off" ref={form} onSubmit={(ev) => { ev.preventDefault(); void save(); }}>
        {group(GROUPS[0])}
        {group(GROUPS[1])}
        {page.profiles === null ? null : (
          <section>
            <h2>Profiles</h2>
            <p className="sub">Ranked models: a chat on a profile runs on the first and falls back to the next when one is out.</p>
            <div className="set profiles" data-key="profiles">
              <div className="field"><Profiles profs={profs} offered={offered(vendors, models)} set={profs_set} rename={rename} /></div>
              <p className="err">{errs.profiles ?? ""}</p>
            </div>
          </section>
        )}
        {key_shown.length === 0 ? null : (
          <section>
            <h2>Keys</h2>
            <p className="sub">Kept in keys.json in the server's folder, readable by the server's user only, and never shown again, only their last characters.</p>
            {key_shown.map((k) => <KeyRow key={k.name} k={k} value={keys[k.name] ?? ""} unset={unset.has("key." + k.name)} err={errs["key." + k.name] ?? ""} edit={(x) => { dirty(); setKeys({ ...keys, [k.name]: x }); setUnset(new Set([...unset].filter((y) => y !== "key." + k.name))); }} onReset={() => reset("key." + k.name)} />)}
          </section>
        )}
        {group(GROUPS[2])}
        <div className="save"><p className="why">{why}</p><button className="chip go" disabled={page.error !== null || busy}>Save</button></div>
      </form>
    </>
  );
}

function Setting({ r, unset, err, onReset, children }: { r: Row; value: string; unset: boolean; err: string; onReset: () => void; children: ReactNode }): ReactNode {
  const [name, about] = SETTING[r.key] ?? [r.key, ""];
  const id = "set-" + r.key + (PICKS.includes(r.key) ? "-vendor" : "");
  const from = r.from === "file" ? "From config.json" : "Default" + (r.why === "" ? "" : ": " + r.why);
  return (
    <div className={"set" + (unset ? " unset" : "")} data-key={r.key}>
      <label htmlFor={id}>{name}<small>{about} <code>{r.key}</code></small></label>
      <div className="field">{children}</div>
      <p className="from">
        {from} · {r.apply === "now" ? "applies at once" : "applies on a restart"}
        {r.running === null ? null : <> · running on <code>{r.running === "" ? "(none)" : r.running}</code> till then</>}
        {r.from === "file" && !unset ? <> <button type="button" className="reset" onClick={onReset}>Use the default</button></> : null}
        {unset ? " · the default once saved" : null}
      </p>
      <p className="err">{err}</p>
    </div>
  );
}

function Control({ r, value, vendors, models, names, keyless, edit }: { r: Row; value: string; vendors: string[]; models: string[]; names: string[]; keyless: string[]; edit: (key: string, value: string) => void }): ReactNode {
  const checks = (all: string[], vendor: (x: string) => string) => {
    const on = list(value);
    const odd = on.filter((x) => !all.includes(x));
    const toggle = (x: string, c: boolean) => edit(r.key, (c ? [...on, x] : on.filter((y) => y !== x)).join(","));
    return (
      <div className="opts">
        {[...all, ...odd].map((x) => {
          const owner = vendor(x);
          return (
            <label key={x} className="opt" data-vendor={owner} hidden={owner !== "" && !owner.split(" ").some((y) => vendors.includes(y))}>
              <input type="checkbox" name={r.key} value={x} checked={on.includes(x)} onChange={(ev) => toggle(x, ev.target.checked)} /> {x}
            </label>
          );
        })}
      </div>
    );
  };
  switch (r.key) {
    case "vendors": {
      return <>{checks(VENDORS, () => "")}<p className="warn">{keyless.length === 0 ? "" : keyless.join(" and ") + (keyless.length === 1 ? " has" : " have") + " no key set: its calls will fail till one is."}</p></>;
    }
    case "models": {
      return checks(LABELS, (x) => Pick.models(VENDORS, [x]).map(([vendor]) => vendor).join(" "));
    }
    case "pick":
    case "compactor":
    case "agents": {
      return <Picks k={r.key} value={value} vendors={vendors} models={models} profiles={names} none={r.key === "agents" ? "The chat's pick" : null} edit={(x) => edit(r.key, x)} />;
    }
    case "cursor_fast": {
      return <select id={"set-" + r.key} name={r.key} value={value.trim() === "on" ? "on" : "off"} onChange={(ev) => edit(r.key, ev.target.value)}><option value="off">desligado</option><option value="on">ligado</option></select>;
    }
  }
  return <input id={"set-" + r.key} name={r.key} value={value} placeholder={r.def} spellCheck={false} autoCapitalize="off" onChange={(ev) => edit(r.key, ev.target.value)} />;
}

// a pick's four selects: vendor (or a profile), model, effort, speed
function Picks({ k, value, vendors, models, profiles, none, edit }: { k: string; value: string; vendors: string[]; models: string[]; profiles: string[]; none: string | null; edit: (value: string) => void }): ReactNode {
  const parts = value === "" ? [] : value.split(":");
  const [vendor = "", model = "", effort = "", speed = ""] = parts;
  const known = (VENDORS as string[]).includes(vendor);
  const offer = (VENDORS as string[]).filter((x) => vendors.includes(x));
  const labels = known ? Pick.models([vendor as Vendor], models).map(([, m]) => m.label) : [];
  const speeds = known ? Pick.model(vendor as Vendor, model)?.speeds ?? [] : [];
  const change = (at: number, x: string) => {
    const next = [vendor, model, effort, speed];
    next[at] = x;
    edit(pick_mend(at === 0 ? [x] : next, models, profiles));
  };
  const select = (part: string, label: string, all: string[], on: string, first: string | null, at: number) => {
    const opts: Array<[string, string]> = [...(first === null ? [] : [["", first] as [string, string]]), ...(all.includes(on) || (on === "" && first !== null) ? [] : [[on, on + " (not offered)"] as [string, string]]), ...all.map((x): [string, string] => [x, x])];
    return <select id={`set-${k}-${part}`} name={`${k}.${part}`} aria-label={label} value={on} onChange={(ev) => change(at, ev.target.value)}>{opts.map(([x, text]) => <option key={x} value={x}>{text}</option>)}</select>;
  };
  return (
    <div className="four">
      {select("vendor", "Vendor", [...offer, ...profiles], vendor, none, 0)}
      {vendor === "" || profiles.includes(vendor) ? null : <>
        {select("model", "Model", labels, model, null, 1)}
        {select("effort", "Effort", EFFORTS, effort, null, 2)}
        {select("speed", "Speed", speeds, speed, null, 3)}
      </>}
    </div>
  );
}

function KeyRow({ k, value, unset, err, edit, onReset }: { k: Key; value: string; unset: boolean; err: string; edit: (x: string) => void; onReset: () => void }): ReactNode {
  const [name, about] = KEY[k.name] ?? [k.name, ""];
  const id = "set-key-" + k.name;
  return (
    <div className={"set key" + (unset ? " unset" : "")} data-key={"key." + k.name}>
      <label htmlFor={id}>{name}<small>{about} <code>{k.env}</code></small></label>
      <div className="field">
        {k.name === "apns"
          ? <textarea id={id} name={"key." + k.name} rows={3} placeholder="Paste a new key to set it" spellCheck={false} value={value} onChange={(ev) => edit(ev.target.value)}></textarea>
          : <input id={id} type="password" name={"key." + k.name} autoComplete="new-password" placeholder="Paste a new key to set it" spellCheck={false} autoCapitalize="off" value={value} onChange={(ev) => edit(ev.target.value)} />}
      </div>
      <p className="from">
        {k.from === "file" ? <>Set{k.tail === "" ? null : <>, ending in <code>{k.tail}</code></>}, in keys.json</> : "Not set"}
        {k.from === "file" && !unset ? <> <button type="button" className="reset" onClick={onReset}>Remove</button></> : null}
        {unset ? " · removed once saved" : null}
      </p>
      <p className="err">{err}</p>
    </div>
  );
}

// the profiles: each a name and its ranked models, moved by their grip
// (dragged, or ↑ ↓ on it), removed, or one added from those offered
function Profiles({ profs, offered: all, set, rename }: { profs: Profs; offered: string[]; set: (next: Profs, focus: string) => void; rename: (i: number, name: string) => void }): ReactNode {
  const copy = () => profs.map((p): [string, string[]] => [p[0], [...p[1]]]);
  const grab = (ev: React.PointerEvent<HTMLButtonElement>, i: number, from: number) => {
    if (ev.button !== 0) {
      return;
    }
    ev.preventDefault();
    const li = ev.currentTarget.closest("li")!;
    const ol = li.parentElement!;
    li.classList.add("drag");
    const move = (e: PointerEvent) => {
      const below = [...ol.children].find((c) => c !== li && e.clientY < c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2);
      if (below !== li.nextElementSibling || below === undefined) {
        ol.insertBefore(li, below ?? null);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const to = [...ol.children].indexOf(li);
      li.classList.remove("drag");
      // the row put back where React drew it, then moved in the state
      ol.insertBefore(li, ol.children[from] ?? null);
      const next = copy();
      next[i][1].splice(to, 0, ...next[i][1].splice(from, 1));
      set(next, `.grip[data-i="${i}"][data-j="${to}"]`);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return (
    <>
      {profs.map(([name, models], i) => {
        const left = all.filter((m) => !models.some((x) => x.split(":").slice(0, 2).join(":") === m));
        const groups = [...new Set(left.map((m) => m.split(":")[0]))];
        return (
          <div key={i} className="prof" data-i={i}>
            <div className="name">
              <input className="pname" data-i={i} value={name} aria-label="Name" placeholder="Enter the profile name here" maxLength={60} spellCheck={false} autoCapitalize="off" onChange={(ev) => rename(i, ev.target.value)} />
              <button type="button" className="chip red pdel" data-i={i} onClick={() => { const next = copy(); next.splice(i, 1); set(next, ".pnew"); }}>Delete</button>
            </div>
            <ol>
              {models.map((m, j) => {
                const [vendor = "", label = m, ...rest] = m.split(":");
                return (
                  <li key={m + j} data-j={j}>
                    <button type="button" className="grip" data-i={i} data-j={j} aria-label={"Move " + label}
                      onPointerDown={(ev) => grab(ev, i, j)}
                      onKeyDown={(ev) => {
                        if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown") {
                          return;
                        }
                        ev.preventDefault();
                        const k = j + (ev.key === "ArrowUp" ? -1 : 1);
                        if (k >= 0 && k < models.length) {
                          const next = copy();
                          [next[i][1][j], next[i][1][k]] = [next[i][1][k], next[i][1][j]];
                          set(next, `.grip[data-i="${i}"][data-j="${k}"]`);
                        }
                      }}>⠿</button>
                    <span>{label}{rest.length === 0 ? null : <> <small>{rest.join(" · ")}</small></>} <small>{vendor}</small></span>
                    <button type="button" className="out" data-i={i} data-j={j} aria-label={"Remove " + label} onClick={() => { const next = copy(); next[i][1].splice(j, 1); set(next, `.add[data-i="${i}"]`); }}>×</button>
                  </li>
                );
              })}
            </ol>
            {left.length === 0 ? null : (
              <select className="add" data-i={i} aria-label="Add model" value="" onChange={(ev) => { if (ev.target.value !== "") { const next = copy(); next[i][1].push(ev.target.value); set(next, `.add[data-i="${i}"]`); } }}>
                <option value="">Add model</option>
                {groups.map((g) => <optgroup key={g} label={g}>{left.filter((m) => m.startsWith(g + ":")).map((m) => <option key={m} value={m}>{m.split(":")[1]}</option>)}</optgroup>)}
              </select>
            )}
          </div>
        );
      })}
      <button type="button" className="chip pnew" onClick={() => set([...copy(), ["", []]], `.pname[data-i="${profs.length}"]`)}>Add profile</button>
    </>
  );
}
