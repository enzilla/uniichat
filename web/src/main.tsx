// The page
// ========
// Boots (signed in or not), connects to the server (View.link_open), and
// draws App.tsx on each change (state.ts draw). The acts a click makes
// are read off the element clicked (data-act, data-go, data-desk, a
// copy), one handler for the page
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { get } from "../../Json.ts";
import { theme_css } from "../../Theme.ts";
import * as View from "../../View.ts";
import { App, Solo } from "./App.tsx";
import { CHECK, SHEETS } from "./Blocks.tsx";
import * as Box from "./Box.ts";
import { import_welcome, IMPORT_BUSY } from "./Import.tsx";
import { fold_reset, fold_show, folds, frames } from "./Log.tsx";
import { BEFORE, DESK, NARROW, P, PAGES, PIPE, RENEW, SCROLL, STILL, TREE, act, anchor, at_end, draw, kept, scroll_bump, toast, v } from "./state.ts";
import * as Viewer from "./Viewer.ts";

type Back = { at: { a: number; top: number } | null; y: number | null; away: { y: number; end: boolean } | null; caret: [number, number]; focus: boolean; open: string[] };

declare global {
  interface Window { webkit?: { messageHandlers?: { unii?: { postMessage: (msg: unknown) => void } } } }
}

export const APP = window.webkit?.messageHandlers?.unii ?? null;

const UPS = new Map<HTMLElement, XMLHttpRequest>();

const root = createRoot(document.getElementById("root")!);

export function tree_view(): boolean {
  return location.hash.toLowerCase() === "#view";
}

async function boot(): Promise<void> {
  document.head.insertAdjacentHTML("beforeend", `<style>${theme_css()}</style>`);
  if (APP === null) {
    navigator.serviceWorker?.register("/sw.js").catch(() => {});
    // a tap on a task's push (sw.js): the Mesa, in a tab open or a new one
    navigator.serviceWorker?.addEventListener("message", (ev) => ev.data?.$ === "mesa" && desk_mode("desk"));
  }
  if (new URLSearchParams(location.search).has("mesa")) {
    sessionStorage.setItem(kept("mode"), "desk");
  }
  const tree = location.pathname === TREE ? TREE + (tree_view() ? "#view" : "") : null;
  const state: unknown = history.state;
  const pic = get(state, "pic") != null;
  history.replaceState(null, "", PAGES.includes(location.pathname) ? "/settings" : location.pathname === PIPE ? PIPE : tree ?? "/");
  if (pic) {
    history.back();
  }
  if (await boot_me() === null) {
    document.body.className = "solo";
    root.render(<Solo title="Entrar" sub={<>Este servidor do UniiChat é privado. No computador em que ele roda, execute <code>unii serve link</code> e abra aqui o link que ele mostrar.</>} />);
    return;
  }
  document.body.className = "";
  // drawn at once, so the box (Box.ts) and the viewer have their
  // elements before the draft and the history are put back
  flushSync(() => root.render(<App />));
  onpopstate = popped;
  document.onclick = click;
  document.ondragover = (ev) => ev.preventDefault();
  document.ondrop = (ev) => {
    ev.preventDefault();
    if (View.view_typing(v) && (ev.dataTransfer?.files.length ?? 0) > 0) {
      attach([...(ev.dataTransfer?.files ?? [])]);
    }
  };
  document.addEventListener("keydown", desk_keys);
  document.onscroll = () => {
    if (at_end()) {
      SCROLL.end = true;
    } else if (scrollY < SCROLL.y) {
      SCROLL.end = false;
    }
    SCROLL.y = scrollY;
    scroll_bump();
  };
  let width = innerWidth;
  addEventListener("resize", () => {
    if (innerWidth !== width) {
      width = innerWidth;
      fold_reset();
      folds();
    }
    frames(true);
  });
  // a phone's keyboard up or down: the box's last line stays in sight, if
  // the caret is there; the page's bottom, if at it
  if (visualViewport !== null) {
    visualViewport.onresize = () => {
      const box = document.querySelector<HTMLElement>(".composer .field");
      if (box !== null && Box.box_focused() && Box.box_caret()[0] === Box.box_text().length) {
        box.scrollTop = box.scrollHeight;
      }
      draw(true);
    };
  }
  // the Mesa drawn again each minute, so how long a task waited or
  // stalled is said as time goes
  setInterval(() => P.mode === "desk" && document.visibilityState === "visible" && draw(false), 60e3);
  NARROW.addEventListener("change", () => route());
  BEFORE.push(before);
  signed();
  route();
  connect();
  for (const ev of ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"]) {
    addEventListener(ev, () => in_use(), { capture: true, passive: true });
  }
  addEventListener("focus", () => in_use());
  document.addEventListener("visibilitychange", () => {
    in_use();
    if (document.hidden && RENEW.due && !RENEW.going && renew_free(true)) {
      RENEW.going = true;
      void renew(true);
    }
  });
  addEventListener("blur", () => in_use(true));
  addEventListener("pagehide", () => in_use(true));
}

async function boot_me(): Promise<unknown> {
  for (let k = 0; ; k++) {
    const res = await fetch("/api/me").catch(() => null);
    if (res?.status === 200 || res?.status === 401) {
      return res.ok ? res.json() : null;
    }
    if (k === 0) {
      document.body.dataset.down = "1";
    }
    await new Promise((ok) => setTimeout(ok, View.RETRY));
  }
}

function signed(): void {
  Box.box_set(sessionStorage.getItem(kept("draft")) ?? "");
  renewed();
}

// at each draw, before the views: the notes said, a reload due, the
// user's count of tasks wherever it shows besides the Mesa
function before(): void {
  for (const note of v.notes.splice(0)) {
    toast(note);
  }
  if (RENEW.due && !RENEW.going && renew_free()) {
    RENEW.going = true;
    setTimeout(() => void renew());
  }
  turn_show(View.desk_list(v.tasks).find((g) => g.group === "now")?.tasks.length ?? 0);
}

// the user's count of tasks (the Mesa's "Agora"): the tab's title ("(2)
// UniiChat") and the app's badge; set only as it changes
let TURN = -1;
const TITLE = document.title;
function turn_show(n: number): void {
  if (n === TURN) {
    return;
  }
  TURN = n;
  document.title = View.turn_title(TITLE, n);
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  (n === 0 ? nav.clearAppBadge?.() : nav.setAppBadge?.(n))?.catch(() => {});
}

// The message box
// ---------------

export function typed(): void {
  sessionStorage.setItem(kept("draft"), Box.box_text());
  for (const [item, xhr] of UPS) {
    if (!item.isConnected) {
      UPS.delete(item);
      xhr.abort();
    }
  }
  P.ups = UPS.size;
  draw(true);
}

// never the Enter that ends a composition (Japanese, Chinese: Safari ends
// it first, so only its keyCode, 229, says so)
export function field_key(ev: KeyboardEvent): void {
  // Alt+Enter: a new line, on any screen (as Shift+Enter on a desk)
  if (ev.key === "Enter" && ev.altKey && !ev.isComposing) {
    ev.preventDefault();
    Box.box_insert("\n");
    return;
  }
  if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229 && DESK.matches) {
    ev.preventDefault();
    submit();
  }
}

const FAILED = "Um arquivo da mensagem não subiu: apague-o (Backspace depois dele) e envie de novo.";

export function submit(): void {
  if (Box.box_items().some((item) => item.dataset.state === "bad")) {
    P.after = false;
    toast(FAILED);
    return;
  }
  if (UPS.size > 0) {
    P.after = true;
    toast("Envia assim que os arquivos subirem.");
    return;
  }
  P.after = false;
  const text = Box.box_text().trim();
  const sent: View.Sent = { text };
  act({ $: "Send", text }, (out) => back(sent, out));
  Box.box_set("");
}

function back(sent: View.Sent, out: View.Answer): void {
  if (out.error === undefined) {
    return;
  }
  if (Box.box_blank()) {
    Box.box_set(sent.text);
  }
  toast(out.error);
}

export function attach(files: File[]): void {
  for (const file of files) {
    const name = file.name.replace(/[[\]\\\n]/g, "") || "file";
    const ext = View.media_ext(file.name);
    const kind = ext !== "" ? View.ext_kind(ext) ?? "file" : file.type.startsWith("image/") ? "image" : "file";
    const item = Box.item_new(name, kind === "image" || kind === "video" ? URL.createObjectURL(file) : "", "up", kind, file.size);
    Box.box_put(item);
    upload(item, file);
  }
}

function upload(item: HTMLElement, file: File): void {
  const xhr = new XMLHttpRequest();
  UPS.set(item, xhr);
  P.ups = UPS.size;
  Box.item_state(item, "up", "0%");
  item.style.setProperty("--part", "0%");
  xhr.open("POST", "/api/media?name=" + encodeURIComponent(file.name));
  xhr.upload.onprogress = (ev) => {
    const part = Math.round((ev.lengthComputable ? ev.loaded / ev.total : 0) * 100) + "%";
    Box.item_state(item, "up", part);
    item.style.setProperty("--part", part);
  };
  xhr.onloadend = () => {
    const out = upload_answer(xhr);
    if (UPS.get(item) !== xhr) {
      return;
    }
    UPS.delete(item);
    if ("name" in out) {
      Box.item_state(item, "ok", "", "/media/" + out.name);
    } else {
      Box.item_state(item, "bad", "Falhou");
      toast(out.error);
    }
    typed();
    if (P.after && UPS.size === 0) {
      submit();
    }
  };
  xhr.send(file);
}

function upload_answer(xhr: XMLHttpRequest): { name: string } | { error: string } {
  let out: unknown = null;
  try {
    out = JSON.parse(xhr.responseText);
  } catch {}
  if (typeof out === "object" && out !== null && "name" in out && typeof out.name === "string") {
    return { name: out.name };
  }
  const why = typeof out === "object" && out !== null && "error" in out && typeof out.error === "string" ? out.error : xhr.status === 0 ? "sem conexão com o UniiChat." : "HTTP " + xhr.status;
  return { error: "Não foi possível enviar o arquivo: " + why };
}

// Dictation: the mic's stream (the ring and the glow take it), recorded
// till stopped, then sent as words to the box
export async function mic(): Promise<void> {
  if (P.rec !== null) {
    P.rec.stop();
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
  if (stream === null) {
    toast("O UniiChat não conseguiu usar o microfone.");
    return;
  }
  const mimeType = ["audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
  const rec = new MediaRecorder(stream, { mimeType });
  const parts: Blob[] = [];
  const start = Date.now();
  const tick = setInterval(() => {
    P.secs = Math.floor((Date.now() - start) / 1000);
    draw(false);
  }, 500);
  rec.ondataavailable = (ev) => parts.push(ev.data);
  rec.onstop = () => {
    clearInterval(tick);
    stream.getTracks().forEach((track) => track.stop());
    P.rec = null;
    P.stream = null;
    P.secs = 0;
    words(new Blob(parts, { type: rec.mimeType }));
  };
  rec.start();
  P.rec = rec;
  P.stream = stream;
  draw(false);
}

function words(audio: Blob): void {
  const out: View.Client = { $: "voice", type: audio.type, body: () => audio };
  View.link_send(v, out, heard);
  draw(false);
}

function heard(out: View.Answer): void {
  draw(false);
  const text = out.text?.trim() ?? "";
  if (text === "") {
    toast(out.error ?? "Nenhuma palavra ouvida.");
    return;
  }
  const gap = /\S$/.test(Box.box_text().slice(0, Box.box_caret()[0])) ? " " : "";
  Box.box_insert(gap + text);
  Box.box_focus();
}

// Clicks
// ------

function click(ev: MouseEvent): void {
  const target = ev.target as HTMLElement;
  const el = target.closest<HTMLElement>("[data-act], [data-copy], [data-go], [data-knob], [data-desk], [data-desk-back], .choices > button");
  const sel = getSelection();
  const pic = Viewer.viewer_pic(target);
  if (pic !== null && !(ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) && (sel === null || sel.isCollapsed)) {
    ev.preventDefault();
    if (!DESK.matches) {
      document.querySelector<HTMLElement>(".composer .field")?.blur();
    }
    Viewer.viewer_open(pic, true, target);
    return;
  }
  const cut = target.closest(".unfold") ?? (el === null && target.closest("a") === null ? target.closest(".msg.long:not(.shown) > .cut") : null);
  if (cut !== null && (sel === null || sel.isCollapsed)) {
    unfold(cut.parentElement!);
    return;
  }
  if (el === null || (sel !== null && !sel.isCollapsed && el.contains(sel.focusNode))) {
    return;
  }
  if (el.dataset.knob !== undefined) {
    place(el);
    return;
  }
  if (el.dataset.desk !== undefined) {
    // from the pipeline's panel: the Mesa, a step of the history
    if (location.pathname === PIPE) {
      history.pushState(null, "", "/");
    }
    desk_open(el.dataset.desk, true);
    return;
  }
  if (el.dataset.deskBack !== undefined) {
    desk_back();
    return;
  }
  el.closest<HTMLElement>(".choices")?.hidePopover();
  const { act: a, copy: text, go: path } = el.dataset;
  el.closest<HTMLElement>("[popover]:popover-open:not(.choices)")?.hidePopover();
  if (path !== undefined) {
    ev.preventDefault();
    go(path);
  }
  if (a !== undefined) {
    const made = JSON.parse(a) as View.Act;
    if (made.$ === "TaskSay" && made.text !== "") {
      act(made);
    } else if (made.$ === "TaskSay") {
      task_say(made.task);
    } else if (made.$ === "TaskAccept") {
      task_accept(el, made.task);
    } else if (made.$ === "Task" && made.state === "done" && task_missing(el)) {
      return;
    } else {
      act(task_act(el, made));
    }
  }
  if (text !== undefined) {
    navigator.clipboard.writeText(text).then(() => copied(el), () => toast("Não foi possível copiar."));
  }
}

function copied(button: HTMLElement): void {
  button.innerHTML = CHECK;
  setTimeout(() => (button.innerHTML = SHEETS), 1200);
}

// a choice's menu, by its knob, inside the screen
function place(knob: HTMLElement): void {
  const menu = document.getElementById("pick-" + knob.dataset.knob);
  if (menu === null) {
    return;
  }
  const box = knob.getBoundingClientRect();
  const { clientWidth: w, clientHeight: h } = document.documentElement;
  const left = box.left + box.width / 2 < w / 2 ? Math.max(8, box.left) : null;
  const right = Math.max(8, w - box.right);
  menu.style.left = left === null ? "auto" : left + "px";
  menu.style.right = left === null ? right + "px" : "auto";
  menu.style.top = "auto";
  menu.style.bottom = h - box.top + 4 + "px";
  menu.style.maxWidth = (left === null ? w - right : w - left) - 8 + "px";
  menu.style.maxHeight = box.top - 12 + "px";
}

// a choice's menu by keys: arrows, Home and End; Shift+Tab back to its knob
export function roam(ev: React.KeyboardEvent): void {
  const menu = (ev.target as HTMLElement).closest<HTMLElement>(".choices");
  if (menu !== null && ev.key === "Tab" && ev.shiftKey && ev.target === menu.querySelector("button")) {
    ev.preventDefault();
    menu.hidePopover();
    (menu.previousElementSibling as HTMLElement).focus();
    return;
  }
  if (menu === null || !["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) {
    return;
  }
  ev.preventDefault();
  const rows = [...menu.querySelectorAll<HTMLElement>("button")];
  const n = rows.length;
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const to: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1 + n, Home: 0, End: n - 1 };
  rows[to[ev.key] % n].focus();
}

export function left(ev: React.FocusEvent): void {
  const menu = (ev.target as HTMLElement).closest<HTMLElement>(".choices:popover-open");
  const to = ev.relatedTarget as Node | null;
  if (menu !== null && to !== null && !menu.contains(to) && to !== menu.previousElementSibling) {
    menu.hidePopover();
  }
}

function unfold(msg: HTMLElement): void {
  const open = !msg.classList.contains("shown");
  const id = msg.dataset.a ?? "";
  open ? SCROLL.open.add(id) : SCROLL.open.delete(id);
  const [top, follow] = [msg.getBoundingClientRect().top, SCROLL.end];
  SCROLL.end = false;
  fold_show(msg, open);
  scrollBy(0, msg.getBoundingClientRect().top - top);
  SCROLL.end = follow || at_end();
  SCROLL.still = follow;
}

// The Mesa's acts
// ---------------
// A task's Concluir, Descartar or choice takes its comment and answers
// (Unii is told on its own: Server.ts Chat.tell_soon)

function task_act(el: HTMLElement, a: View.Act): View.Act {
  const item = el.closest("[data-task]");
  if (a.$ !== "Task" || a.state === "open" || item === null) {
    return a;
  }
  const note = item.querySelector<HTMLInputElement>("input.note")?.value ?? "";
  const fields = a.state === "done" ? task_fields(item) : {};
  return { ...a, note, ...(Object.keys(fields).length === 0 ? {} : { fields }) };
}

// "Aceitar as recomendadas" (View.task_accept): the recommended answers
// put in the empty fields, the required still empty marked; else the task
// concluded with them. With choices and none recommended, only filled
// (kept as a draft), the choice left to the user (R1)
function task_accept(el: HTMLElement, id: string): void {
  const item = el.closest<HTMLElement>("[data-task]");
  const t = v.tasks.find((x) => x.id === id);
  if (item === null || t === undefined) {
    return;
  }
  const fill = View.task_accept_fill(t, task_fields(item));
  for (const set of item.querySelectorAll<HTMLElement>("fieldset.field")) {
    const want = fill[set.dataset.field!];
    if (want === undefined) {
      continue;
    }
    if (set.dataset.kind === "text") {
      const box = set.querySelector("textarea");
      if (box !== null && box.value.trim() === "") {
        box.value = String(want);
      }
      continue;
    }
    const picks = Array.isArray(want) ? want.map(String) : [String(want)];
    for (const input of set.querySelectorAll<HTMLInputElement>("input")) {
      input.checked = picks.includes(input.value);
    }
  }
  if (View.task_accept_mode(t) === "fill") {
    act({ $: "TaskDraft", task: id, fields: task_fields(item) });
    toast(View.task_fill_said(t));
    return;
  }
  if (task_missing(el)) {
    return;
  }
  const note = item.querySelector<HTMLInputElement>("input.note")?.value ?? "";
  act({ $: "TaskAccept", task: id, ...(note.trim() === "" ? {} : { note }), fields: task_fields(item) });
}

// a field's answer as its fieldset holds it: a text, the choices checked
// (multi), the one checked ("" none)
function field_value(set: HTMLElement): unknown {
  if (set.dataset.kind === "text") {
    return set.querySelector("textarea")?.value ?? "";
  }
  const on = [...set.querySelectorAll<HTMLInputElement>("input:checked")].map((i) => i.value);
  return set.dataset.kind === "multi" ? on : (on[0] ?? "");
}

function task_fields(item: Element): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const set of item.querySelectorAll<HTMLElement>("fieldset.field")) {
    out[set.dataset.field!] = field_value(set);
  }
  return out;
}

// a field marked unanswered (or not): aria-invalid on the fieldset and on
// each control, which screen readers announce more reliably
function field_invalid(set: HTMLElement, on: boolean): void {
  for (const el of [set, ...set.querySelectorAll<HTMLElement>("input, textarea, select")]) {
    if (on) {
      el.setAttribute("aria-invalid", "true");
    } else {
      el.removeAttribute("aria-invalid");
    }
  }
}

// a Concluir with required fields unanswered: each marked, the first
// focused, which ones said; nothing sent. Whether any was missing
function task_missing(el: HTMLElement): boolean {
  const item = el.closest("[data-task]");
  const sets = item === null ? [] : [...item.querySelectorAll<HTMLElement>("fieldset.field[data-required]")];
  const empty = (set: HTMLElement) => {
    const x = field_value(set);
    return Array.isArray(x) ? x.length === 0 : String(x).trim() === "";
  };
  const missing = sets.filter(empty);
  sets.forEach((set) => field_invalid(set, missing.includes(set)));
  if (missing.length === 0) {
    return false;
  }
  missing[0].scrollIntoView({ block: "center", behavior: "smooth" });
  missing[0].querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
  const said = missing.map((set) => "“" + (set.querySelector("legend")?.firstChild?.textContent ?? "").trim() + "”").join(", ");
  toast("Para concluir, responda " + said + ". Nada foi enviado.");
  return true;
}

// a field changed (a radio, a box, a text left): kept as a draft
export function task_draft(ev: Event): void {
  const set = (ev.target as HTMLElement).closest<HTMLElement>("fieldset.field");
  const item = set?.closest<HTMLElement>("[data-task]");
  if (set === null || set === undefined || item === null || item === undefined) {
    return;
  }
  field_invalid(set, false);
  act({ $: "TaskDraft", task: item.dataset.task!, fields: { [set.dataset.field!]: field_value(set) } });
}

// a message in a task's thread: its box emptied, its text back in it if
// the server refuses (and it's still empty)
function task_say(task: string): void {
  const box = () => document.querySelector<HTMLTextAreaElement>(`#desk [data-task="${CSS.escape(task)}"] textarea.say`);
  const text = box()?.value ?? "";
  for (const msg of View.view_act(v, { $: "TaskSay", task, text })) {
    const was = box();
    if (was !== null) {
      was.value = "";
    }
    View.link_send(v, msg, (out) => {
      if (out.error === undefined) {
        return;
      }
      toast(out.error);
      const now = box();
      if (now !== null && now.value.trim() === "") {
        now.value = text;
      }
    });
  }
  draw(false);
}

// in a task's boxes, as in the message's: Enter sends (a message about it)
// or keeps (a field's answer), Alt+Enter or Shift+Enter a new line; a
// phone's keyboard has no Alt: its Enter stays a new line
export function desk_enter(ev: React.KeyboardEvent): void {
  const el = ev.target as HTMLElement;
  if (!el.matches("textarea") || ev.key !== "Enter" || ev.nativeEvent.isComposing || ev.keyCode === 229) {
    return;
  }
  if (!DESK.matches && !(ev.ctrlKey || ev.metaKey)) {
    return;
  }
  ev.preventDefault();
  const box = el as HTMLTextAreaElement;
  if (ev.altKey || ev.shiftKey) {
    box.setRangeText("\n", box.selectionStart, box.selectionEnd, "end");
    box.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (el.matches("textarea.say")) {
    task_say(el.closest<HTMLElement>("[data-task]")!.dataset.task!);
  } else {
    box.blur();
  }
}

// The Mesa
// --------
// The Mesa or the Conversa, each a step of the tab's history (Back goes
// back to the other). As the page opens, the Mesa if a task is the user's
// move (P19), else the Conversa; a reload keeps the one shown. On a
// phone, the list or the task (pane, a step of the history). Keys, unless
// typing: j or ↓, k or ↑ move; Enter or o open; / the search; m Mesa or
// Conversa; a Aceitar as recomendadas

export function desk_mode(mode: "chat" | "desk", push = true): void {
  sessionStorage.setItem(kept("mode"), mode);
  const st = { mode, sel: P.sel, pane: false };
  if (push) {
    history.pushState(st, "", "/");
  } else {
    history.replaceState(st, "", "/");
  }
  route();
}

function desk_open(id: string, pane: boolean): void {
  P.sel = id;
  P.mode = "desk";
  const st = { mode: "desk", sel: id, pane: pane && NARROW.matches };
  if (st.pane && !(history.state?.pane === true)) {
    history.pushState(st, "", "/");
  } else {
    history.replaceState(st, "", "/");
  }
  route();
  if (!NARROW.matches && pane) {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`#desk .row[data-desk="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
  }
}

export function desk_back(): void {
  if (history.state?.pane === true) {
    history.back();
    return;
  }
  P.pane = false;
  route();
}

// the first state picks the screen (P19), unless this tab showed one
function desk_choose(): void {
  if (P.chose) {
    return;
  }
  P.chose = true;
  const was = sessionStorage.getItem(kept("mode"));
  const mode = was === "desk" || was === "chat" ? was : View.desk_turn(v.tasks) ? "desk" : "chat";
  if (mode !== P.mode && !PAGES.includes(location.pathname) && location.pathname !== PIPE && location.pathname !== TREE) {
    desk_mode(mode, false);
  }
}

function desk_keys(ev: KeyboardEvent): void {
  if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || PAGES.includes(location.pathname)) {
    return;
  }
  const el = ev.target as HTMLElement;
  const typing = el.matches("input, textarea, select, [contenteditable], [contenteditable] *");
  if (document.querySelector("[popover]:popover-open") !== null) {
    return;
  }
  if (typing) {
    if (ev.key === "Escape" && P.mode === "desk" && el.closest("#desk") !== null) {
      ev.preventDefault();
      el.blur();
    }
    return;
  }
  if (ev.key === "m") {
    ev.preventDefault();
    desk_mode(P.mode === "desk" ? "chat" : "desk");
    return;
  }
  if (P.mode !== "desk") {
    return;
  }
  const by = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 }[ev.key as "j"];
  if (by !== undefined && !(NARROW.matches && P.pane)) {
    ev.preventDefault();
    const to = View.desk_step(P.ids, P.sel, by);
    if (to !== null) {
      desk_open(to, false);
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(`#desk .row[data-desk="${CSS.escape(to)}"]`);
        row?.scrollIntoView({ block: "nearest" });
        row?.focus({ preventScroll: true });
      });
    }
    return;
  }
  if (ev.key === "a" && P.sel !== null) {
    const accept = document.querySelector<HTMLButtonElement>("#desk .pane button.accept");
    if (accept !== null) {
      ev.preventDefault();
      accept.click();
    }
    return;
  }
  if ((ev.key === "Enter" || ev.key === "o") && P.sel !== null && (el === document.body || el.closest("#desk .rows") !== null)) {
    ev.preventDefault();
    if (NARROW.matches) {
      desk_open(P.sel, true);
    } else {
      document.querySelector<HTMLElement>("#desk .pane")?.querySelector<HTMLElement>("input, textarea, button:not(.back)")?.focus();
    }
    return;
  }
  if (ev.key === "/") {
    ev.preventDefault();
    if (NARROW.matches && P.pane) {
      desk_back();
    }
    document.querySelector<HTMLElement>("#desk .q")?.focus();
  }
}

// Routes
// ------

export function go(path: string): void {
  if (location.pathname + location.hash !== path) {
    history.pushState(null, "", path);
  }
  route();
}

// the page the location and the history's state say: the Conversa (the
// Mesa and the settings over it), the pipeline's page, the memory's;
// leaving the chat, where it was is kept for its return
export function route(): void {
  const page = location.pathname === PIPE || location.pathname === TREE;
  const st = history.state ?? {};
  if (st.mode === "desk" || st.mode === "chat") {
    P.mode = st.mode;
  }
  if (typeof st.sel === "string") {
    P.sel = st.sel;
  }
  P.pane = st.pane === true && NARROW.matches;
  const log = document.getElementById("log");
  const shown = log !== null && !log.hidden;
  if (page && shown && SCROLL.away === null) {
    SCROLL.away = { y: scrollY, end: SCROLL.end };
  }
  P.at = location.pathname + location.hash;
  if (!page && SCROLL.away !== null) {
    const away = SCROLL.away;
    SCROLL.away = null;
    SCROLL.end = away.end;
    P.rows = true;
    P.shown = "";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      scrollTo(0, away.end ? document.documentElement.scrollHeight : away.y);
      SCROLL.y = scrollY;
    }));
  }
  draw(!page && SCROLL.end);
}

function popped(): void {
  const st = history.state ?? {};
  const desk = (st.mode === "desk" || st.mode === "chat") && (st.mode !== P.mode || (st.pane === true) !== P.pane || (typeof st.sel === "string" && st.sel !== P.sel));
  if (location.pathname + location.hash !== P.at || desk) {
    route();
  }
  Viewer.viewer_sync();
  draw(true);
}

// The link
// --------

function connect(): void {
  View.link_open(v, {
    open : (query) => new WebSocket(location.origin.replace(/^http/, "ws") + "/ws" + query),
    post : (path, body) => fetch(path, { method: "POST", body: body as BodyInit }),
    hear : hear,
    lost : lost,
  });
}

// this tab in use or not (the server reads where to push)
function in_use(off = false): void {
  const on = !off && document.visibilityState === "visible" && document.hasFocus();
  const ws = v.ws;
  if (ws === null || !v.up || ws.readyState !== WebSocket.OPEN || (ws === P.used.ws && on === P.used.on && (!on || Date.now() - P.used.at < View.USE_PING))) {
    return;
  }
  ws.send(on ? View.ACTIVE : View.IDLE);
  P.used = { ws, on, at: Date.now() };
}

async function lost(up: boolean): Promise<boolean> {
  draw(true);
  const me = up ? null : await fetch("/api/me").catch(() => null);
  if (me !== null && me.status === 401) {
    location.href = "/";
    return false;
  }
  return true;
}

function hear(msg: View.Server): void {
  if (v.ws !== P.used.ws) {
    in_use();
  }
  const was = View.view_pick(v);
  const agents = v.agents.join() + JSON.stringify(v.labels ?? {});
  for (const out of View.view_hear(v, msg)) {
    View.link_send(v, out);
  }
  if (msg.$ === "state") {
    desk_choose();
  }
  const now = View.view_pick(v).filter((k) => was.length > 0 && !was.some((w) => w.text === k.text));
  if (now.length > 0) {
    toast("Agora " + now.map((k) => k.hint).join("; ") + ".");
  }
  P.rows ||= msg.$ === "state" ? v.agents.join() + JSON.stringify(v.labels ?? {}) !== agents : msg.$ !== "delta" && msg.$ !== "live";
  if (msg.$ === "state") {
    renew_due(msg.build);
  }
  void import_welcome();
  draw(true);
}

export async function signout(): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration();
  await reg?.pushManager.getSubscription().then((sub) => sub?.unsubscribe()).catch(() => {});
  await View.post("/api/logout", {});
  location.href = "/";
}

// The theme
// ---------
// dark unless picked light (index.html reads it before the page paints);
// a swap crossfades the page, but under reduced motion

export function theme_dark(): boolean {
  return document.documentElement.dataset.theme !== "light";
}

export function theme_swap(): void {
  const dark = !theme_dark();
  const swap = () => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b0b0d" : "#f6f5f2");
    try {
      localStorage.setItem(kept("theme"), dark ? "dark" : "light");
    } catch {}
    draw(false);
  };
  if (STILL.matches || document.startViewTransition === undefined) {
    swap();
  } else {
    document.startViewTransition(swap);
  }
}

// A new build
// -----------
// The server runs a new build: the page reloads itself, once nothing is
// being typed, sent or recorded there, where it was put back (renewed)

function renew_due(build: string | undefined): void {
  if (build === undefined || build_same(build)) {
    RENEW.build ||= build ?? "";
    RENEW.due = false;
    return;
  }
  if (reloads_spent_on(build)) {
    RENEW.gave = v.ws;
    return;
  }
  RENEW.since = RENEW.due && RENEW.since;
  RENEW.due = true;
  draw(false);
}

function build_same(build: string): boolean {
  return RENEW.build === "" || build === RENEW.build;
}

function reloads_spent_on(build: string): boolean {
  const [was, n] = (sessionStorage.getItem(kept("build")) ?? "").split(" ");
  return was === build && Number(n) >= 2 && (RENEW.gave === null || RENEW.gave === v.ws);
}

function renew_free(hidden = false): boolean {
  const page = location.pathname !== "/" && location.pathname !== TREE;
  const quiet = P.rec === null && UPS.size === 0 && v.out.length === 0 && !IMPORT_BUSY() && !Viewer.viewer_on();
  const typing = !DESK.matches && Box.box_focused() && !hidden;
  return quiet && !typing && (!page || (RENEW.since && RENEW.dirty.size === 0 && RENEW.saving === 0));
}

async function renew(hidden = false): Promise<void> {
  const [was, n] = (sessionStorage.getItem(kept("build")) ?? "").split(" ");
  const tries = was === v.build ? Number(n) : 0;
  const store = isSecureContext && "caches" in window ? window.caches : null;
  const keys = (await store?.keys().catch(() => [])) ?? [];
  await Promise.all(store === null ? [] : keys.filter((k) => k.startsWith("unii-shell")).map((k) => store.delete(k)));
  if (tries > 0) {
    await Promise.all(["/", "/app.js", "/style.css", "/sw.js"].map((path) => fetch(path, { cache: "reload" }).catch(() => null)));
  }
  if (!RENEW.due || !renew_free(hidden)) {
    RENEW.going = false;
    return;
  }
  const log = document.getElementById("log");
  const chat = log !== null && !log.hidden;
  const back: Back = { at: chat && !SCROLL.end ? anchor() : null, y: chat ? null : scrollY, away: SCROLL.away, caret: Box.box_caret(), focus: Box.box_focused(), open: [...SCROLL.open] };
  sessionStorage.setItem(kept("back"), JSON.stringify(back));
  sessionStorage.setItem(kept("build"), (v.build ?? "") + " " + (tries + 1));
  location.reload();
}

function renewed(): void {
  const text = sessionStorage.getItem(kept("back"));
  sessionStorage.removeItem(kept("back"));
  const back = text === null ? null : (JSON.parse(text) as Back | null);
  if (back === null) {
    return;
  }
  if (back.focus && DESK.matches) {
    Box.box_focus();
  }
  Box.box_place(back.caret[0], back.caret[1]);
  back.open.forEach((id) => SCROLL.open.add(id));
  RENEW.back = back.at;
  SCROLL.away = back.away;
  const end = Date.now() + 3000;
  const y = () => {
    const to = back.y;
    if (to !== null) {
      if (document.documentElement.scrollHeight >= to + innerHeight || Date.now() > end) {
        scrollTo(0, to);
      } else {
        setTimeout(y, 100);
      }
    }
  };
  y();
}

export function down(): void {
  scrollTo(0, document.documentElement.scrollHeight);
  SCROLL.end = true;
  draw(false);
}

export function mine(): void {
  const rows = [...document.querySelectorAll<HTMLElement>("#log .msg.user")];
  const el = rows.findLast(mine_above);
  if (el !== undefined) {
    SCROLL.end = false;
    el.scrollIntoView();
  }
  draw(false);
}

export function mine_above(el: HTMLElement): boolean {
  const head = document.querySelector("header.top")?.getBoundingClientRect().bottom ?? 0;
  return el.getBoundingClientRect().top < head;
}


// a development build only (bun run web drops it): the state, for a
// browser test to put the page in a state the server can't make on its own
if (process.env.NODE_ENV !== "production") {
  Object.assign(window, { __unii: { v, P, draw } });
}

void boot();
