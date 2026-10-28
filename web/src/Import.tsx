// Importing past chats
// ====================
// A popover over the page: a first visit asks how to start (import, or
// fresh); the form reads a ~/.claude or ~/.codex folder, or a website
// export (zip), each app's sessions listed to pick, how far back, tool
// calls or not; Import sends them (View link "import"), then the import's
// progress, paused or going (the server's v.importing), and the bar's
// button in the top bar while it runs. main.ts's importer, as a component
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Import from "../../Import.ts";
import * as View from "../../View.ts";
import { DESK, IMPORT, draw, kept, toast, useTick, v } from "./state.ts";

const NONE = "No Claude or ChatGPT chats in that folder. Choose ~/.claude or ~/.codex.";

let since = { back: 0, min: 0 };

export function IMPORT_BUSY(): boolean {
  return document.getElementById("import")?.matches(":popover-open") ?? false;
}

export async function import_open(first: boolean): Promise<void> {
  document.getElementById("menu")?.hidePopover();
  IMPORT.done = (await fetch("/api/imported").then((res) => res.json()).catch(() => ({}))) as Import.Done;
  IMPORT.first = first;
  IMPORT.step = first ? "start" : IMPORT.step === "done" ? "" : IMPORT.step;
  IMPORT.status = "";
  draw(false);
  requestAnimationFrame(() => document.getElementById("import")?.showPopover());
}

// a first visit on a computer, a fresh chat: the import offered once
export async function import_welcome(): Promise<void> {
  const key = kept("welcomed");
  if (localStorage.getItem(key) === null && v.pick !== null && v.parts.length === View.OPENING && v.importing === null && DESK.matches) {
    localStorage.setItem(key, "1");
    await import_open(true);
  }
}

function import_since(): string {
  return since.back > since.min ? new Date(since.back * 864e5).toISOString().slice(0, 10) : "";
}

function plan(tools: boolean): Import.Plan {
  const found = [...IMPORT.found.values()].flatMap((read) => read.sessions);
  return Import.import_plan(found, { off: [...IMPORT.off], since: import_since(), tools }, IMPORT.done);
}

async function copy(file: File): Promise<Blob> {
  const reader = file.stream().getReader();
  const parts: Blob[] = [];
  for (let got = await reader.read(); !got.done; got = await reader.read()) {
    parts.push(new Blob([got.value]));
  }
  return new Blob(parts);
}

function took(name: string, read: { sessions: Import.Session[]; moved: number }, status: string): void {
  IMPORT.found.set(name, read);
  since = { back: 0, min: 0 };
  IMPORT.status = status;
  draw(false);
}

// the step the import is at: the server's run seen, then done
function step(): typeof IMPORT.step {
  const run = v.importing;
  IMPORT.step = run !== null ? "seen" : IMPORT.step === "seen" ? "done" : IMPORT.step;
  return IMPORT.step;
}

export function ImportBar(): ReactNode {
  const run = v.importing;
  if (run === null) {
    return null;
  }
  const why = Boolean(run.why);
  return (
    <button className={"imping" + (why ? " why" : "")} popoverTarget="import" title={View.progress_show(run)}>
      <span>{why ? "Importação pausada" : "Montando a memória"}</span>
      <progress max={1} value={run.done / Math.max(1, run.total)}></progress>
    </button>
  );
}

export function ImportPop(): ReactNode {
  useTick();
  const dir = useRef<HTMLInputElement>(null);
  const zip = useRef<HTMLInputElement>(null);
  const [tools, setTools] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = pop.current!;
    const toggled = (ev: Event) => {
      if ((ev as ToggleEvent).newState === "closed") {
        IMPORT.step = IMPORT.step === "start" || IMPORT.step === "done" ? "" : IMPORT.step;
        draw(false);
      }
    };
    el.addEventListener("toggle", toggled);
    return () => el.removeEventListener("toggle", toggled);
  }, []);
  const at = step();
  const run = v.importing;
  const done = at === "done";
  const going = ["send", "run", "seen", "done"].includes(at);
  const part = run === null ? Number(done) : run.done / Math.max(1, run.total);
  const why = Boolean(run?.why);
  const said = run !== null ? View.progress_show(run) : done ? Import.DONE : at === "send" ? "Sending…" : "Starting…";
  const reads = [...IMPORT.found.values()];
  const sessions = reads.flatMap((read) => read.sessions);
  const p = plan(tools);
  const moved = reads.reduce((n, read) => n + read.moved, 0);
  const found = (sessions.length === 0 ? "" : p.first === "" ? Import.OLD : Import.import_count(p.msgs, "new ")) + (moved === 0 ? "" : " (" + moved + (moved === 1 ? " file" : " files") + " changed while read: choose the folder again to add them)");
  const day = (x: string | number) => new Date(x).getUTCDate() + " " + new Date(x).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const min = Math.floor(Date.parse(p.first || new Date().toISOString()) / 864e5);
  const max = Math.floor(Date.now() / 864e5);
  if (since.min !== min) {
    since = { back: since.back < min ? min : since.back, min };
  }
  const reading = IMPORT.status.startsWith("Reading");
  const hide = () => pop.current?.hidePopover();
  const read_dir = async (files: File[]) => {
    const all = files.filter((f) => Import.import_file(f.webkitRelativePath));
    const got: Import.Session[] = [];
    let left = 0;
    for (const [k, f] of all.entries()) {
      IMPORT.status = "Reading " + (k + 1) + " of " + all.length + " files…";
      draw(false);
      const s = await copy(f).then((b) => Import.import_session(b, "log"), () => undefined);
      left += s === undefined ? 1 : 0;
      got.push(...(s ? [s] : []));
    }
    took(files[0]?.webkitRelativePath.split("/")[0] ?? "", { sessions: got, moved: left }, got.length > 0 ? "" : NONE);
  };
  const read_zip = async (files: File[]) => {
    for (const f of files) {
      IMPORT.status = "Reading " + f.name + "…";
      draw(false);
      try {
        const got = await Import.import_export(await copy(f));
        took(f.name, { sessions: got, moved: 0 }, got.length > 0 ? "" : "No chats in " + f.name + ".");
      } catch (e) {
        took(f.name, { sessions: [], moved: 0 }, f.name + ": " + (e as Error).message);
      }
    }
  };
  const send = () => {
    const picked = p.picked;
    IMPORT.step = "send";
    draw(false);
    const body = async () => new Blob(await Array.fromAsync(Import.import_body(picked), (x) => new Blob([x])));
    View.link_send(v, { $: "import", body }, (out) => {
      IMPORT.step = out.error !== undefined ? "" : out.going ? "run" : "done";
      if (out.error === undefined) {
        IMPORT.found.clear();
      }
      IMPORT.status = out.error === undefined ? "" : "Not imported: " + out.error;
      draw(false);
      pop.current?.showPopover();
    });
  };
  return (
    <div id="import" popover="auto" ref={pop}>
      <section className="start" hidden={at !== "start"}>
        <p className="title">How do you want to start?</p>
        <p className="sub">Both are fine. You can import any time from the menu.</p>
        <div className="acts two"><button type="button" className="into" onClick={() => { IMPORT.step = ""; draw(false); }}>Import my past AI chats</button><button type="button" className="skip" onClick={hide}>Start fresh</button></div>
      </section>
      <form hidden={going || at === "start"} onSubmit={(ev) => { ev.preventDefault(); send(); }}>
        <p className="title">Import your past AI chats</p>
        <p className="desk sub">Choose your <code>~/.claude</code> or <code>~/.codex</code> folder (hidden: <kbd>⌘</kbd><kbd>⇧</kbd><kbd>G</kbd> in the dialog).</p>
        <p className="phone sub">Import on your computer: open this site there, or type <code>/import</code> in unii.</p>
        <input ref={dir} type="file" name="dir" {...{ webkitdirectory: "" }} hidden onChange={(ev) => { const files = [...(ev.target.files ?? [])]; ev.target.value = ""; void read_dir(files); }} />
        <input ref={zip} type="file" name="zip" accept=".zip,.json" multiple hidden onChange={(ev) => { const files = [...(ev.target.files ?? [])]; ev.target.value = ""; void read_zip(files); }} />
        {Import.APPS.map((app) => {
          const shown = p.sessions.filter((s) => s.app === app);
          const on = shown.filter((s) => !IMPORT.off.has(Import.import_id(s))).length;
          return (
            <fieldset key={app} className="src desk" data-app={app}>
              <legend>{app}</legend>
              <details className="pick" hidden={shown.length === 0}>
                <summary>{(on < shown.length ? on + " of " : shown.length > 1 ? "All " : "") + shown.length + (shown.length === 1 ? " session" : " sessions") + " picked · choose"}</summary>
                <div className="sessions">
                  {shown.map((s) => {
                    const id = Import.import_id(s);
                    return (
                      <label key={id} title={s.where + ", " + Import.import_count(s.heads.length, "")}>
                        <input type="checkbox" name="session" value={id} checked={!IMPORT.off.has(id)} onChange={(ev) => { ev.target.checked ? IMPORT.off.delete(id) : IMPORT.off.add(id); draw(false); }} />
                        {Import.import_cells(s).map((c, k) => <span key={k}>{c}</span>)}
                      </label>
                    );
                  })}
                </div>
              </details>
              <button type="button" className="pickzip" title={"From the website: " + Import.EXPORTS[app] + ", which emails you a zip."} disabled={reading} onClick={() => zip.current?.click()}>Add a website export</button>
            </fieldset>
          );
        })}
        <fieldset className="want" hidden={p.first === ""}>
          <label className="tools" hidden={!sessions.some((s) => s.heads.some((m) => m.kind === "tool" || m.kind === "echo"))}><input type="checkbox" name="tools" checked={tools} onChange={(ev) => setTools(ev.target.checked)} /> Tool calls</label>
          <label className="since">
            <span className="from">{day(import_since() || p.first || Date.now())}</span><span className="to">{day(Date.now())}</span>
            <input type="range" name="back" min={min} max={max} value={Math.max(min, since.back)} style={{ "--at": (100 * (Math.max(min, since.back) - min)) / Math.max(1, max - min) + "%" } as React.CSSProperties} onChange={(ev) => { since = { ...since, back: ev.target.valueAsNumber }; draw(false); }} />
          </label>
        </fieldset>
        <p className="found">{found}</p>
        <p className="guess">{IMPORT.status}</p>
        <div className="acts">
          <button type="button" className="skip" onClick={hide}>{IMPORT.first ? "Start fresh" : "Close"}</button>
          <button type="button" className={"pickdir desk" + (p.msgs > 0 ? " alt" : "")} disabled={reading} onClick={() => dir.current?.click()}>{p.msgs > 0 ? "Add a folder" : "Choose folder"}</button>
          <button className="go" hidden={p.msgs === 0} disabled={reading}>Import</button>
        </div>
      </form>
      <section className="prog" hidden={!going}>
        <p className="title">{done ? "Memory tree built" : "Building your memory tree"}</p>
        <progress max={1} value={part}></progress>
        <p className="pct">{said}</p>
        <p className="sub" hidden={why || done}>{Import.MIDWAY}</p>
        <div className="acts">
          <button type="button" className="skip" onClick={hide}>Go to the chat</button>
          <button type="button" className="go flow" hidden={run === null} onClick={() => View.link_send(v, { $: "go", on: Boolean(v.importing?.why) }, (out) => out.error && toast(out.error))}>{why ? "Resume" : "Pause"}</button>
        </div>
      </section>
    </div>
  );
}
