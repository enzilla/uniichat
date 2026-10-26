// UniiChat (the site)
// ===================
// The page around View.ts's chat: the server's messages go to
// View.view_hear, a click's `data-act` (Html.ts) to View.view_act, and
// both answer what to send back. The page is drawn once a frame, keeping
// the first row in sight in place, or the bottom while the page is at it;
// the log's rows only once a message (but a stream's piece) or an act
// changed them, what streams in a place of its own, so typing, or a reply
// streaming, touches no row.
// The markup is index.html's: the header, the chat, the settings page
// (/settings, once /account) or the memory tree (/tree: Tree.ts), and the
// footer as the terminal's; a picture opens over them (Viewer.ts). A tab
// is no device; a signed-out one is told how to sign in (`unii serve
// link`). The site installs as an app
// (manifest.webmanifest, sw.js) and may notify (Notifications); in the
// iOS app (ios/: APP) the app notifies.

import * as Import from "../../Import.ts";
import { theme_css } from "../../Theme.ts";
import * as View from "../../View.ts";
import * as Box from "./Box.ts";
import * as Html from "./Html.ts";
import * as Tree from "./Tree.ts";
import * as Viewer from "./Viewer.ts";

// Types
// =====

// a source the import read (a folder, an export): its sessions, and its
// files left out as they changed while read
type Read = { sessions: Import.Session[]; moved: number };

// Constants
// =========

// the iOS app's bridge (ios/), in its web view only
const APP = (window as any).webkit?.messageHandlers?.unii ?? null;

// a page with a hover has a keyboard of its own; on a touch screen,
// Enter types a new line (the arrow sends), and the page never focuses
// the box itself, which would pop the keyboard up
const DESK = matchMedia("(hover: hover)");

// a folder without sessions
const NONE   = "No Claude or ChatGPT chats in that folder. Choose ~/.claude or ~/.codex.";

// the intro's scenes: two lines, then the logo above the name
const SCENES = `
  <div class="scene"><p>Your entire life.</p><p>One single chat.</p></div>
  <div class="scene"><i class="mark"></i><h1>UniiChat</h1></div>`;

// the chat
const v = View.view_new();

// the message box (Box.ts)
const BOX = $<HTMLElement>(".composer .field");

// the files uploading into it, by their item (Uploads)
const UPS = new Map<HTMLElement, XMLHttpRequest>();

// the import's slider: the first day it takes, in days since 1970, from
// the first new message's (its left end: all) to today's
const BACK = $<HTMLInputElement>("#import [name=back]");

// the page's: end: at its bottom; stick: the next draw may keep it;
// y: its scroll when last scrolled; open: the tool calls and results
// unfolded, by id (folds); still: the page left where it is at the
// log's next resize (unfold); build, due, going, since, dirty, saving,
// gave, back: the web app's build and its reload into another (Renew);
// after: a message sent while files upload (Uploads);
// frame: awaited (0: none); rows: the log's rows changed, to draw;
// found: the sources read, by name; done: sessions imported before; off:
// left out (Import.Want); step: the import's; away: the chat's scroll as
// a page (the settings, the tree) was opened over it, kept for its return;
// used: what the server was last told of this page's use (in_use); at:
// the path (and hash) route last showed
const P = {
  rec   : null as MediaRecorder | null,
  shown : "",
  end   : true,
  stick : true,
  y     : 0,
  frame : 0,
  rows  : true,
  toast : 0,
  found : new Map<string, Read>(),
  done  : {} as Import.Done,
  off   : new Set<string>(),
  step  : "" as "" | "start" | "send" | "run" | "seen" | "done",
  push  : null as { reg: ServiceWorkerRegistration; key: string } | null,
  // the Mesa's (desk): which screen shows (chat: the Conversa); chose:
  // the first state picked it (P19); sel: the task shown; q, ref: the
  // search and the project; pane: on a narrow screen, the task shown
  // (else the list); ids: the list's order; order: the list's order the
  // last time the task shown was in "now" (where "Próxima" goes on
  // from, View.desk_next)
  mode  : (sessionStorage.getItem(kept("mode")) === "desk" ? "desk" : "chat") as "chat" | "desk",
  chose : false,
  sel   : null as string | null,
  q     : "",
  ref   : "",
  pane  : false,
  ids   : [] as string[],
  order : { sel: null as string | null, ids: [] as string[] },
  away  : null as { y: number; end: boolean } | null,
  used  : { ws: null as WebSocket | null, on: false, at: 0 },
  open  : new Set<string>(),
  build : document.documentElement.dataset.build ?? "",
  still : false,
  due   : false,
  going : false,
  since : false,
  dirty : new Set<HTMLFormElement>(),
  saving: 0,
  gave  : null as WebSocket | null,
  back  : null as { a: number; top: number } | null,
  after : false,
  at    : "",
};

// the Mesa and the list side by side, above this width (style.css)
const NARROW = matchMedia("(max-width: 760px)");

function $<T extends HTMLElement>(sel: string): T {
  return document.querySelector(sel) as T;
}

// where this browser keeps a fact: "draft", the box's text, for the tab
// (a reload keeps it); "welcomed", offered the import
function kept(fact: string): string {
  return "unii." + fact;
}

// Boot
// ====

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
  // (reloaded with a picture open: its entry, now the chat's, holds the
  // chat's under it too, so back would do nothing; it steps off it)
  const pic = history.state?.pic != null;
  history.replaceState(null, "", PAGES.includes(location.pathname) ? "/settings" : location.pathname === PIPE ? PIPE : tree ?? "/");
  if (pic) {
    history.back();
  }
  if (await boot_me() === null) {
    solo("Sign in", "This UniiChat server is private. On the computer it runs on, run <code>unii serve link</code> and open the link it prints here.");
    return;
  }
  chat();
  signed();
  route();
  connect();
  // (input a person makes: a page scrolling itself, to a reply, is none)
  for (const ev of ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"]) {
    addEventListener(ev, () => in_use(), { capture: true, passive: true });
  }
  addEventListener("focus", () => in_use());
  document.addEventListener("visibilitychange", () => {
    in_use();
    if (document.hidden && P.due && !P.going && renew_free(true)) {
      P.going = true;
      renew(true);
    }
  });
  addEventListener("blur", () => in_use(true));
  addEventListener("pagehide", () => in_use(true));
}

// whether signed in (null: no, as the server refuses the session);
// any other answer (a restart, no connection)
// says nothing of who, so it is asked again, saying so while it lasts (the
// app opened from sw.js's shell with the server down)
async function boot_me(): Promise<any> {
  for (let k = 0; ; k++) {
    const res = await fetch("/api/me").catch(() => null);
    if (res?.status === 200 || res?.status === 401) {
      if (k > 0) {
        $("#toast").hidden = true;
      }
      return res.ok ? res.json() : null;
    }
    if (k === 0) {
      toast("Can't reach UniiChat. Reconnecting…", true);
    }
    await new Promise((ok) => setTimeout(ok, View.RETRY));
  }
}

// the settings page's paths, drawn in #account (/account: an older link)
const PAGES = ["/settings", "/account"];

// the pipeline's panel (R6), a page drawn in #account too
const PIPE = "/pipeline";
// the memory tree's path, drawn in #tree (Tree.ts): its TREE, or with
// #view its VIEW (#VIEW: the old page's link)
const TREE = "/tree";

function tree_view(): boolean {
  return location.hash.toLowerCase() === "#view";
}

// a page of one note: how to sign in
function solo(title: string, sub: string): void {
  document.body.className = "solo";
  document.body.innerHTML = `<main><h1>${title}</h1><p class="sub">${sub}</p></main>`;
}

// Chat
// ====

function chat(): void {
  const file = $<HTMLInputElement>("input[type=file]");
  Box.box_new(BOX, { input: typed, files: attach });
  // (a phone's keyboard down: a reload may be due, and was waiting for it)
  BOX.addEventListener("blur", () => draw(false));
  // never the Enter that ends a composition (Japanese, Chinese: Safari
  // ends it first, so only its keyCode, 229, says so)
  BOX.onkeydown = (ev) => {
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
  };
  $("form").onsubmit = (ev) => {
    ev.preventDefault();
    submit();
  };
  $(".attach").onclick = () => file.click();
  $("#pick").onkeydown = roam;
  $("#pick").addEventListener("focusout", left);
  $("#menu .out").onclick = signout;
  $(".mic").onclick = mic;
  file.onchange = () => {
    attach([...(file.files ?? [])]);
    file.value = "";
  };
  onpopstate = popped;
  Viewer.viewer_new();
  importer();
  document.ondragover = (ev) => ev.preventDefault();
  document.ondrop = (ev) => {
    ev.preventDefault();
    if (View.view_typing(v) && (ev.dataTransfer?.files.length ?? 0) > 0) {
      attach([...(ev.dataTransfer?.files ?? [])]);
    }
  };
  document.onclick = click;
  for (const root of [$("#tasks"), $("#desk")]) {
    root.addEventListener("change", task_draft);
    root.addEventListener("keydown", (ev) => {
      const el = ev.target as HTMLElement;
      if (!el.matches("textarea") || ev.key !== "Enter" || ev.isComposing || ev.keyCode === 229) {
        return;
      }
      // (a phone's keyboard has no Alt: its Enter stays a new line)
      if (!DESK.matches && !(ev.ctrlKey || ev.metaKey)) {
        return;
      }
      // in a task's boxes, as in the message's: Enter sends (a message
      // about it) or keeps (a field's answer, the draft saved as it
      // leaves), Alt+Enter or Shift+Enter a new line
      ev.preventDefault();
      const box = el as HTMLTextAreaElement;
      if (ev.altKey || ev.shiftKey) {
        box.setRangeText("\n", box.selectionStart, box.selectionEnd, "end");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (el.matches("textarea.say")) {
        task_say(el.closest<HTMLElement>("[data-task]")!.dataset.task!, root);
      } else {
        box.blur();
      }
    });
  }
  $("#tasks").addEventListener("toggle", thread_toggle, true);
  desk_wire();
  // a phone's keyboard up or down: the box's last line stays in sight, if
  // the caret is there; the page's bottom, if at it
  visualViewport!.onresize = () => {
    if (Box.box_focused() && Box.box_caret()[0] === Box.box_text().length) {
      BOX.scrollTop = BOX.scrollHeight;
    }
    draw(true);
  };
  // the page leaves its bottom only as it scrolls up (the user's swipe,
  // wheel, keys or scrollbar: a page that grows or shrinks at its bottom
  // stays at it); one that grows (the box, a reply, an image) is kept
  // there
  document.onscroll = () => {
    if (at_end()) {
      P.end = true;
    } else if (scrollY < P.y) {
      P.end = false;
    }
    P.y = scrollY;
    mine_show();
  };
  $(".mine").onclick = mine;
  $(".down").onclick = down;
  const keep = new ResizeObserver(() => {
    if (P.still) {
      P.still = false;
    } else if (P.end && !$("#log").hidden && !at_end()) {
      scrollTo(0, document.documentElement.scrollHeight);
    }
  });
  keep.observe($("#log"));
  keep.observe($("footer"));
  let width = innerWidth;
  addEventListener("resize", () => {
    if (innerWidth !== width) {
      width = innerWidth;
      measured = new WeakSet();
      folds();
    }
    frames(true);
  });
  draw(true);
}

// the page signed in
function signed(): void {
  document.body.className = "";
  BOX.dataset.placeholder = View.HINT;
  Box.box_set(sessionStorage.getItem(kept("draft")) ?? "");
  renewed();
}

// the box changed: its text kept as the draft; an upload whose item was
// deleted ends
function typed(): void {
  sessionStorage.setItem(kept("draft"), Box.box_text());
  for (const [item, xhr] of UPS) {
    if (!item.isConnected) {
      UPS.delete(item);
      xhr.abort();
    }
  }
  draw(true);
}

// a message sent: never with a file that didn't upload in it (deleted, it
// may go); with files still uploading, once they are
function submit(): void {
  if (Box.box_items().some((item) => item.dataset.state === "bad")) {
    P.after = false;
    toast(FAILED);
    return;
  }
  if (UPS.size > 0) {
    P.after = true;
    toast("Sends once uploaded.");
    return;
  }
  P.after = false;
  const text = Box.box_text().trim();
  act({ $: "Send", text });
  Box.box_set("");
}

// a message refused goes back in the box, unless another is in it; the
// why is a toast
function back(sent: View.Sent, out: View.Answer): void {
  if (out.error === undefined) {
    return;
  }
  if (Box.box_blank()) {
    Box.box_set(sent.text);
  }
  toast(out.error);
}

// Uploads
// =======
// A file pasted, dropped or picked (an image, a video, a sound, a page,
// any other file) goes to the media store at once (Server.ts /api/media),
// an item in the box where the caret is (Box.ts) showing it and how far
// it is; once uploaded, the item is its markdown, ![name](/media/…), or
// a file that isn't media its link, [name](/media/…). One refused says
// so on it and in a toast: the message can't be sent till it is deleted.
// A message sent meanwhile goes as the last upload ends (not if one is
// refused); an item deleted ends its upload.

const FAILED = "A file in the message didn't upload: delete it (Backspace after it), then send.";

function attach(files: File[]): void {
  for (const file of files) {
    const name = file.name.replace(/[[\]\\\n]/g, "") || "file";
    // its kind as the store will name it (Memory.media_add): by its
    // extension; with none, a picture if it says so (its bytes decide)
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
      Box.item_state(item, "bad", "Failed");
      toast(out.error);
    }
    typed();
    if (P.after && UPS.size === 0) {
      submit();
    }
  };
  xhr.send(file);
}

// an upload's answer: the file's name in the store, or why not
function upload_answer(xhr: XMLHttpRequest): { name: string } | { error: string } {
  let out: unknown = null;
  try {
    out = JSON.parse(xhr.responseText);
  } catch {}
  if (typeof out === "object" && out !== null && "name" in out && typeof out.name === "string") {
    return { name: out.name };
  }
  const why = typeof out === "object" && out !== null && "error" in out && typeof out.error === "string" ? out.error : xhr.status === 0 ? "Can't reach UniiChat." : "HTTP " + xhr.status;
  return { error: "Could not upload: " + why };
}

function act(a: View.Act): void {
  const said = a.$ === "Send" ? a.text.trim() : "";
  P.end = P.end || a.$ === "Send";
  P.rows = true;
  for (const msg of View.view_act(v, a)) {
    View.link_send(v, msg, a.$ === "Send" ? (out) => back(a, out) : undefined, said);
  }
  draw(a.$ === "Send");
}

// a click on a View.Act, a Copy button, a page (go), a knob or its
// menu's row (Html.ts), unless it ends a selection dragged in its element
function click(ev: MouseEvent): void {
  const target = ev.target as HTMLElement;
  const el = target.closest<HTMLElement>("[data-act], [data-copy], [data-go], [data-knob], [data-desk], [data-desk-back], .choices > button");
  const sel = getSelection();
  // a picture opens in the page (Viewer.ts); with a key held, as a link
  const pic = Viewer.viewer_pic(target);
  if (pic !== null && !(ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) && (sel === null || sel.isCollapsed)) {
    ev.preventDefault();
    // (on a touch screen, the box focused would take the focus back as
    // the picture closes, and its keyboard pop up)
    if (!DESK.matches) {
      BOX.blur();
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
  const menu = el.closest("#menu") !== null;
  if (menu) {
    $("#menu").hidePopover();
  }
  if (path !== undefined || (a !== undefined && menu)) {
    ev.preventDefault();
    go(path ?? "/");
  }
  if (a !== undefined) {
    const made = JSON.parse(a) as View.Act;
    if (made.$ === "TaskSay" && made.text !== "") {
      act(made);
    } else if (made.$ === "TaskSay") {
      task_say(made.task, el.closest<HTMLElement>("#tasks, #desk") ?? $("#tasks"));
    } else if (made.$ === "TaskAccept") {
      task_accept(el, made.task);
    } else if (made.$ === "Task" && made.state === "done" && task_missing(el)) {
      return;
    } else {
      act(task_act(el, made));
    }
  }
  if (text !== undefined) {
    navigator.clipboard.writeText(text).then(() => copied(el), () => toast("Could not copy."));
  }
}

// a knob's menu, before it opens (the knob's own click opens and closes
// it): over the knob, its right edge at the knob's (one on the screen's
// left half, as the mode's: its left edge at the knob's), as tall and
// wide as the screen has room for (style.css: it scrolls past that)
function place(knob: HTMLElement): void {
  const menu = $("#pick-" + knob.dataset.knob);
  const box = knob.getBoundingClientRect();
  const { clientWidth: w, clientHeight: h } = document.documentElement;
  const left = box.left + box.width / 2 < w / 2 ? Math.max(8, box.left) : null;
  const right = Math.max(8, w - box.right);
  menu.style.left = left === null ? "auto" : left + "px";
  menu.style.right = left === null ? right + "px" : "auto";
  menu.style.bottom = h - box.top + 4 + "px";
  menu.style.maxWidth = (left === null ? w - right : w - left) - 8 + "px";
  menu.style.maxHeight = box.top - 12 + "px";
}

// in a knob's menu, the arrows go down and up its rows, Home and End to
// its ends (Tab too goes through them; Escape, a click out, or Tab out
// either end closes it)
function roam(ev: KeyboardEvent): void {
  const menu = (ev.target as HTMLElement).closest<HTMLElement>(".choices");
  // back to its knob: a click there toggles it, so left() keeps it open
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

// focus tabbed out of a knob's menu closes it; but to its knob, whose
// click closes it, or to nothing (a tap on a row may not focus it)
function left(ev: FocusEvent): void {
  const menu = (ev.target as HTMLElement).closest<HTMLElement>(".choices:popover-open");
  const to = ev.relatedTarget as Node | null;
  if (menu !== null && to !== null && !menu.contains(to) && to !== menu.previousElementSibling) {
    menu.hidePopover();
  }
}

// a task's Concluir, Descartar or choice (Html.tasks_html) takes its
// item's comment and answers (Unii is told on its own: Server.ts
// Chat.tell_soon)
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
// put in the item's empty fields (seen as picked), the required still
// empty marked as Concluir marks them; else the task concluded with them
// and the recommended choice. With choices and none recommended, only
// filled (kept as a draft), the choice left to the user (R1)
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
  // choices, none recommended (View.task_accept_mode "fill"): the
  // answers filled are kept as a draft, and the choice is the user's
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

// a field's answer as its fieldset holds it (Html.fields_html): a text,
// the choices checked (multi), the one checked ("" none)
function field_value(set: HTMLElement): unknown {
  if (set.dataset.kind === "text") {
    return set.querySelector("textarea")?.value ?? "";
  }
  const on = [...set.querySelectorAll<HTMLInputElement>("input:checked")].map((i) => i.value);
  return set.dataset.kind === "multi" ? on : (on[0] ?? "");
}

// every field's answer of a task's item, by field id
function task_fields(item: Element): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const set of item.querySelectorAll<HTMLElement>("fieldset.field")) {
    out[set.dataset.field!] = field_value(set);
  }
  return out;
}

// a field marked unanswered (or not): aria-invalid on the fieldset (its
// red border) and on each of its controls, which screen readers announce
// more reliably than a fieldset's
function field_invalid(set: HTMLElement, on: boolean): void {
  for (const el of [set, ...set.querySelectorAll<HTMLElement>("input, textarea, select")]) {
    if (on) {
      el.setAttribute("aria-invalid", "true");
    } else {
      el.removeAttribute("aria-invalid");
    }
  }
}

// a Concluir (or a choice) with required fields unanswered: each marked
// (aria-invalid), the first focused, which ones said; nothing sent (the
// server refuses it too). Whether any was missing
function task_missing(el: HTMLElement): boolean {
  const item = el.closest("[data-task]");
  const sets = item === null ? [] : [...item.querySelectorAll<HTMLElement>("fieldset.field[data-required]")];
  const empty = (set: HTMLElement) => {
    const v = field_value(set);
    return Array.isArray(v) ? v.length === 0 : String(v).trim() === "";
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
function task_draft(ev: Event): void {
  const set = (ev.target as HTMLElement).closest<HTMLElement>("fieldset.field");
  const item = set?.closest<HTMLElement>("[data-task]");
  if (set === null || set === undefined || item === null || item === undefined) {
    return;
  }
  field_invalid(set, false);
  act({ $: "TaskDraft", task: item.dataset.task!, fields: { [set.dataset.field!]: field_value(set) } });
}

// a message in a task's thread (its box's text, in root: the aside or
// the Mesa): the box emptied, its text back in it if the server refuses
// (and it's still empty)
function task_say(task: string, root: HTMLElement): void {
  const box = () => root.querySelector<HTMLTextAreaElement>(`[data-task="${CSS.escape(task)}"] textarea.say`);
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

// what's typed in the list (root: the aside or the Mesa's task) and not
// sent (data-keep: a comment, a text field, a thread's box, a box
// checked), and where the focus is, taken before its items are made
// again and put back in the new ones
type Kept = { el: Element; value: string | null; checked: boolean | null; focus: boolean; start: number | null; end: number | null };
function keep_take(root: HTMLElement): Map<string, Kept> {
  const kept = new Map<string, Kept>();
  for (const el of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-task] :is(input, textarea)[data-keep]")) {
    const key = el.closest<HTMLElement>("[data-task]")!.dataset.task + "/" + el.dataset.keep;
    const box = el instanceof HTMLInputElement && el.type === "checkbox";
    const focus = document.activeElement === el;
    const value = !box && el.value !== el.defaultValue ? el.value : null;
    const checked = box && (el as HTMLInputElement).checked !== (el as HTMLInputElement).defaultChecked ? (el as HTMLInputElement).checked : null;
    if (value !== null || checked !== null || focus) {
      kept.set(key, { el, value, checked, focus, start: box ? null : el.selectionStart, end: box ? null : el.selectionEnd });
    }
  }
  return kept;
}
function keep_put(root: HTMLElement, kept: Map<string, Kept>): void {
  for (const [key, k] of kept) {
    const [task, name] = key.split("/");
    const el = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-task="${CSS.escape(task)}"] [data-keep="${CSS.escape(name)}"]`);
    if (el === null || el === k.el) {
      continue;
    }
    if (k.value !== null) {
      el.value = k.value;
    }
    if (k.checked !== null) {
      (el as HTMLInputElement).checked = k.checked;
    }
    if (k.focus) {
      el.focus();
      if (k.start !== null && k.end !== null) {
        el.setSelectionRange(k.start, k.end);
      }
    }
  }
}

// a thread opened or shut by hand stays so, its item made again, till
// a message comes to it (THREADS: by task, how and at how many messages)
const THREADS = new Map<string, { open: boolean; n: number }>();
function thread_toggle(ev: Event): void {
  const el = ev.target as HTMLElement;
  const item = el.closest<HTMLElement>("#tasks li[data-task]");
  if (!(el instanceof HTMLDetailsElement) || !el.classList.contains("thread") || item === null) {
    return;
  }
  THREADS.set(item.dataset.task!, { open: el.open, n: el.querySelectorAll("ol > li").length });
}
function threads_put(): void {
  for (const el of document.querySelectorAll<HTMLDetailsElement>("#tasks li[data-task] details.thread")) {
    const task = el.closest<HTMLElement>("li[data-task]")!.dataset.task!;
    const was = THREADS.get(task);
    if (was !== undefined && was.n === el.querySelectorAll("ol > li").length && el.open !== was.open) {
      el.open = was.open;
    }
  }
}

// the user's count of tasks (the Mesa's "Agora"), wherever it shows
// besides the list: the tab's title ("(2) UniiChat"), the ✓ marked, the
// app's badge (an installed app: sw.js sets it too, as pushes come); none,
// all cleared. Set only as it changes
let TURN = -1;
const TITLE = document.title;
function turn_show(n: number): void {
  if (n === TURN) {
    return;
  }
  TURN = n;
  document.title = View.turn_title(TITLE, n);
  $(".tasks").classList.toggle("turn", n > 0);
  $(".mode").classList.toggle("turn", n > 0);
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  (n === 0 ? nav.clearAppBadge?.() : nav.setAppBadge?.(n))?.catch(() => {});
}

// the pending list: the header's ✓ (on a wide screen, an aside instead:
// style.css), its items made again only as the list changes (a state)
// (those that wait for others: out of the count, a summary that opens
// to them)
let TASKS: { of: unknown; html: { open: string[]; now: string[]; waiting: string[]; closed: string[] } } = { of: null, html: { open: [], now: [], waiting: [], closed: [] } };
function tasks_bar(): void {
  if (TASKS.of !== v.tasks) {
    TASKS = { of: v.tasks, html: Html.tasks_html(v.tasks) };
  }
  const { open, now, waiting, closed } = TASKS.html;
  const untold = View.view_untold(v).length;
  document.body.classList.toggle("tasking", v.tasks.length > 0);
  $(".tasks").hidden = v.tasks.length === 0;
  $(".tasks span").textContent = View.tasks_count_said(open.length, waiting.length);
  $("#tasks .n").textContent = open.length === 0 ? "" : "(" + open.length + ")";
  $("#tasks .none").hidden = open.length > 0;
  $("#tasks .none").textContent = View.tasks_none_said(waiting.length);
  const kept = keep_take($("#tasks"));
  markup($("#tasks ul.now"), now);
  keep_put($("#tasks"), kept);
  threads_put();
  markup($("#tasks .waiting ul"), waiting);
  $("#tasks .waiting").hidden = waiting.length === 0;
  $("#tasks .waiting summary").textContent = View.tasks_waiting_said(waiting.length);
  markup($("#tasks .closed ul"), closed);
  $("#tasks .closed").hidden = closed.length === 0;
  $("#tasks .tell").hidden = untold === 0;
  $("#tasks .tell span").textContent = String(untold);
  if (v.tasks.length === 0 && $("#tasks").matches(":popover-open")) {
    $("#tasks").hidePopover();
  }
}

// Mesa
// ====
// The pending list as a screen (Html.desk_html), the Conversa's
// alternative, the header's .mode (or m) switching them; each a step of
// the tab's history, so Back goes back to the other. As the page opens,
// it shows the Mesa if a task is the user's move (P19), else the
// Conversa; a reload keeps the one shown (sessionStorage). The list at
// the left, by group, searched (q) and filtered by project (ref); the
// task shown (sel) whole at the right, the first if none (a wide
// screen). On a narrow one (a phone), one at a time: the list, or the
// task (pane, a step of the history, Back to the list). Keys, unless
// typing: j or ↓, k or ↑ move; Enter or o open (on a wide screen, focus
// in the task); / the search; Esc back to the list; m Mesa or Conversa.
// The task's markup is made only as it, the search or the selection
// change, what's typed in it kept (keep_take)

function desk_wire(): void {
  const q = $<HTMLInputElement>("#desk .q");
  const ref = $<HTMLSelectElement>("#desk .ref");
  q.oninput = () => {
    P.q = q.value;
    draw(false);
  };
  ref.onchange = () => {
    P.ref = ref.value;
    draw(false);
  };
  $(".mode").onclick = () => desk_mode(P.mode === "desk" ? "chat" : "desk");
  document.addEventListener("keydown", desk_keys);
  // the Mesa drawn again each minute, so how long a task waited or
  // stalled is said as time goes (desk_draw remakes only on a new minute)
  setInterval(() => P.mode === "desk" && document.visibilityState === "visible" && draw(false), 60e3);
  NARROW.addEventListener("change", () => route());
}

// the Mesa or the Conversa shown, a step of the history (from the
// settings page, back to the chat first)
function desk_mode(mode: "chat" | "desk", push = true): void {
  sessionStorage.setItem(kept("mode"), mode);
  const st = { mode, sel: P.sel, pane: false };
  if (push) {
    history.pushState(st, "", "/");
  } else {
    history.replaceState(st, "", "/");
  }
  route();
}

// a task shown on the Mesa (by a click: on a phone, its own screen)
function desk_open(id: string, pane: boolean): void {
  P.sel = id;
  if (P.mode !== "desk") {
    P.mode = "desk";
  }
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

// on a phone, from a task back to the list (its step of the history)
function desk_back(): void {
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
  if (mode !== P.mode && PAGES.includes(location.pathname) === false && location.pathname !== PIPE && location.pathname !== TREE) {
    desk_mode(mode, false);
  }
}

let DESKED: { of: unknown; q: string; ref: string; sel: string | null; said: string; html: ReturnType<typeof Html.desk_html> } | null = null;
function desk_draw(): void {
  const refs = View.desk_refs(v.tasks);
  if (P.ref !== "" && !refs.includes(P.ref)) {
    P.ref = "";
  }
  // the task shown gone (not in the list's view any more): on a wide
  // screen the first, on a phone the list
  if (P.chose && P.sel !== null && !v.tasks.some((t) => t.id === P.sel)) {
    P.sel = null;
    P.pane = false;
    document.body.classList.remove("pane");
  }
  // Unii's turn (why a task waits for it) and the minute (how long)
  // change what the Mesa says, as the list does
  const turn = View.turn_of(v);
  const said = JSON.stringify(turn) + Math.floor(Date.now() / 60e3);
  if (DESKED === null || DESKED.of !== v.tasks || DESKED.q !== P.q || DESKED.ref !== P.ref || DESKED.sel !== P.sel || DESKED.said !== said) {
    const groups = View.desk_list(v.tasks, P.q, P.ref);
    const ids = groups.flatMap((g) => g.tasks.map((t) => t.id));
    if (P.sel === null && !NARROW.matches && ids.length > 0) {
      P.sel = ids[0];
    }
    // the shown one still in "now": the order "Próxima" goes on from
    if (P.sel !== null && groups.some((g) => g.group === "now" && g.tasks.some((t) => t.id === P.sel))) {
      P.order = { sel: P.sel, ids };
    }
    const order = P.order.sel === P.sel ? P.order.ids : [];
    DESKED = { of: v.tasks, q: P.q, ref: P.ref, sel: P.sel, said, html: Html.desk_html(v.tasks, P.q, P.ref, P.sel, Date.now(), { order, turn }) };
  }
  const { list, detail, ids } = DESKED.html;
  P.ids = ids;
  const select = $<HTMLSelectElement>("#desk .ref");
  markup(select, [`<option value="">Todos os projetos</option>`, ...refs.map((r) => `<option value="${Html.esc(r)}">${Html.esc(r)}</option>`)]);
  select.value = P.ref;
  select.hidden = refs.length === 0;
  markup($("#desk .rows"), list);
  const pane = $("#desk .pane");
  const was = keep_take(pane);
  markup(pane, detail);
  keep_put(pane, was);
  // the shown task waiting for Unii: its wait said, politely, to a
  // screen reader, as the minute (or why it waits) changes; a region
  // kept across draws, as the pane's article is remade
  const live = $("#desk .live");
  const shown = v.tasks.find((t) => t.id === P.sel);
  const wait = shown !== undefined && shown.state === "open" && shown.talk === "unii" ? shown.id + ": " + View.task_talk_wait_said(shown, Date.now(), turn) : "";
  if (live.textContent !== wait) {
    live.textContent = wait;
  }
  const untold = View.view_untold(v).length;
  $("#desk .tell").hidden = untold === 0;
  $("#desk .tell span").textContent = String(untold);
}

// the Mesa's keys (none while typing, but Esc, which leaves the box)
function desk_keys(ev: KeyboardEvent): void {
  if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || !$("#account").hidden || document.body.classList.contains("guest")) {
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
  // a: "Aceitar as recomendadas" of the task shown, if it offers it
  if (ev.key === "a" && P.sel !== null) {
    const accept = $("#desk .pane").querySelector<HTMLButtonElement>("button.accept");
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
      $("#desk .pane").querySelector<HTMLElement>("input, textarea, button:not(.back)")?.focus();
    }
    return;
  }
  if (ev.key === "/") {
    ev.preventDefault();
    if (NARROW.matches && P.pane) {
      desk_back();
    }
    $("#desk .q").focus();
    return;
  }
  if (ev.key === "Escape") {
    if (NARROW.matches && P.pane) {
      ev.preventDefault();
      desk_back();
    } else if (P.sel !== null) {
      ev.preventDefault();
      document.querySelector<HTMLElement>(`#desk .row[data-desk="${CSS.escape(P.sel)}"]`)?.focus();
    }
  }
}

// Folds
// =====
// A tool call or result taller than FOLD of its own lines is long: it
// shows 8 (style.css), its button and a tap on it unfold it, the button
// folds it again; unfolded by id (P.open), so a row drawn anew keeps it.
// Each is measured once as drawn, all again as the width changes.

const FOLD = 10;

let measured = new WeakSet<Element>();

function folds(): void {
  for (const cut of document.querySelectorAll<HTMLElement>("#log .msg > .cut")) {
    const msg = cut.parentElement!;
    if (!measured.has(msg)) {
      measured.add(msg);
      msg.classList.toggle("long", cut.scrollHeight > FOLD * parseFloat(getComputedStyle(cut).lineHeight));
    }
    fold_show(msg, P.open.has(msg.dataset.a ?? ""));
  }
}

function fold_show(msg: HTMLElement, open: boolean): void {
  msg.classList.toggle("shown", open);
  const button = msg.querySelector(":scope > .unfold")!;
  button.setAttribute("aria-expanded", String(open));
  button.textContent = open ? "Show less" : "Show all";
}

// its top stays where it is: the page follows its bottom again only if
// still at it
function unfold(msg: HTMLElement): void {
  const open = !msg.classList.contains("shown");
  const id = msg.dataset.a ?? "";
  open ? P.open.add(id) : P.open.delete(id);
  const [top, follow] = [msg.getBoundingClientRect().top, P.end];
  P.end = false;
  fold_show(msg, open);
  scrollBy(0, msg.getBoundingClientRect().top - top);
  // (following the chat's end, it still is: the next message pulls the
  // page down again; this resize leaves it)
  P.end = follow || at_end();
  P.still = follow;
}

// a page in a message (Html.ts) as tall as its content, measured as it
// loads and as the window's size changes (all: each again); style.css
// caps it, and it scrolls inside past that. Nothing runs in it, but its
// frame is of this site, so this page reads its height
const FRAMED = new WeakSet<HTMLIFrameElement>();

function frames(all = false): void {
  for (const f of document.querySelectorAll<HTMLIFrameElement>("#log iframe.page")) {
    const fit = () => {
      const root = f.contentDocument?.documentElement;
      if (root !== undefined && f.contentDocument?.URL !== "about:blank") {
        f.style.height = Math.ceil(root.getBoundingClientRect().height) + 2 + "px";
      }
    };
    if (!FRAMED.has(f)) {
      FRAMED.add(f);
      f.addEventListener("load", fit);
    } else if (all) {
      fit();
    }
  }
}

function copied(button: HTMLElement): void {
  button.innerHTML = Html.CHECK;
  setTimeout(() => (button.innerHTML = Html.SHEETS), 1200);
}

// Voice
// =====
// The mic records (the browser's MediaRecorder: webm, or mp4 where only
// that is made) until clicked again; the server writes the recording
// out, paid as the calls, and its words join the box where the cursor
// is, to edit and send.

async function mic(): Promise<void> {
  if (P.rec !== null) {
    P.rec.stop();
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
  if (stream === null) {
    toast("UniiChat can't use the microphone.");
    return;
  }
  const mimeType = ["audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
  const rec = new MediaRecorder(stream, { mimeType });
  const parts: Blob[] = [];
  rec.ondataavailable = (ev) => parts.push(ev.data);
  rec.onstop = () => {
    stream.getTracks().forEach((track) => track.stop());
    P.rec = null;
    words(new Blob(parts, { type: rec.mimeType }));
  };
  rec.start();
  P.rec = rec;
  draw(false);
  meter(stream, rec);
}

// While rec records, the box shows its loudness: a bar every 50 ms,
// scrolling left, and the time so far.
function meter(stream: MediaStream, rec: MediaRecorder): void {
  const audio = new AudioContext();
  const probe = audio.createAnalyser();
  audio.createMediaStreamSource(stream).connect(probe);
  const buf = new Uint8Array(probe.fftSize);
  const canvas = $<HTMLCanvasElement>(".voice canvas");
  const pen = canvas.getContext("2d")!;
  const levels: number[] = [];
  const start = performance.now();
  const frame = (now: number): void => {
    if (P.rec !== rec) {
      audio.close();
      return;
    }
    probe.getByteTimeDomainData(buf);
    const power = buf.reduce((sum, b) => sum + ((b - 128) / 128) ** 2, 0) / buf.length;
    const level = Math.min(1, Math.sqrt(power) * 5);
    const slot = Math.floor((now - start) / 50);
    levels[slot] = Math.max(levels[slot] ?? 0, level);
    const secs = Math.floor((now - start) / 1000);
    $(".voice span").textContent = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
    const dpr = devicePixelRatio;
    const w = (canvas.width = canvas.clientWidth * dpr);
    const h = (canvas.height = canvas.clientHeight * dpr);
    pen.fillStyle = getComputedStyle(canvas).color;
    const step = 5 * dpr;
    for (let i = 0; i * step < w && slot - i >= 0; i++) {
      const bar = Math.max(2 * dpr, (levels[slot - i] ?? 0) * h);
      pen.fillRect(w - (i + 1) * step, (h - bar) / 2, 3 * dpr, bar);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function words(audio: Blob): void {
  const act: View.Client = { $: "voice", type: audio.type, body: () => audio };
  View.link_send(v, act, heard);
  draw(false);
}

function heard(out: View.Answer): void {
  draw(false);
  const text = out.text?.trim() ?? "";
  if (text === "") {
    toast(out.error ?? "No words heard.");
    return;
  }
  const gap = /\S$/.test(Box.box_text().slice(0, Box.box_caret()[0])) ? " " : "";
  Box.box_insert(gap + text);
  Box.box_focus();
}

// Socket
// ======
// View's link; a socket lost opens again, but one that never showed the
// chat may be a session gone: then the page starts over.

function connect(): void {
  View.link_open(v, {
    open : (query) => new WebSocket(location.origin.replace(/^http/, "ws") + "/ws" + query),
    post : (path, body) => fetch(path, { method: "POST", body }),
    hear : hear,
    lost : lost,
  });
}

// whether this page is in use (shown and focused; off: leaving it), told
// the server on each socket, and again while in use at most each
// USE_PING: no push goes out meanwhile (Server.ts Chat.phone)
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

// a pick changed shows what it is now (a click on a knob moves it). The
// rows change with what they show: a state (~10/s importing)
// only by its agents, an agent's page saying whether it runs
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
    toast("Now " + now.map((k) => k.hint).join("; ") + ".");
  }
  P.rows ||= msg.$ === "state" ? v.agents.join() + JSON.stringify(v.labels ?? {}) !== agents : msg.$ !== "delta" && msg.$ !== "live";
  if (msg.$ === "state") {
    renew_due(msg.build);
  }
  import_welcome();
  draw(true);
}

// Import
// ======
// Import History: offered once to a new chat on a computer, and in
// the menu. A folder picked, or a site's export (a zip), is read for its
// sessions' heads, each app's list folded (all picked; open it to
// leave some out); then what it finds, and Import; then its progress,
// Pause or Resume. All follows from P and
// a status. A picked file can't be read once it changes, so each is
// copied as first read.

function importer(): void {
  const form = $<HTMLFormElement>("#import form");
  const dir  = $<HTMLInputElement>("#import [name=dir]");
  $(".imp").onclick = () => import_open(false);
  const zip  = $<HTMLInputElement>("#import [name=zip]");
  $(".pickdir").onclick = () => dir.click();
  for (const src of import_srcs()) {
    src.querySelector<HTMLButtonElement>(".pickzip")!.onclick = () => zip.click();
    src.querySelector<HTMLButtonElement>(".pickzip")!.title = "From the website: " + Import.EXPORTS[src.dataset.app!] + ", which emails you a zip.";
  }
  $(".into").onclick = () => {
    P.step = "";
    import_draw("");
  };
  $("#import").onclick = (ev) => (ev.target as HTMLElement).closest(".skip") && $("#import").hidePopover();
  $("#import .prog .sub").textContent = Import.MIDWAY;
  $("#import .flow").onclick = import_flow;
  $("#import").ontoggle = (ev) => {
    if ((ev as ToggleEvent).newState === "closed") {
      P.step = P.step === "start" || P.step === "done" ? "" : P.step;
    }
    import_draw("");
  };
  form.oninput = (ev) => {
    const box = ev.target as HTMLInputElement;
    if (box.name === "session") {
      box.checked ? P.off.delete(box.value) : P.off.add(box.value);
    }
    import_draw("");
  };
  // drawn once as the read starts (a draw lists every session found)
  dir.onchange = async () => {
    const all = [...(dir.files ?? [])];
    const files = all.filter((f) => Import.import_file(f.webkitRelativePath));
    const found: Import.Session[] = [];
    let moved = 0;
    const reading = (k: number) => "Reading " + k + " of " + files.length + " files…";
    import_draw(reading(1));
    for (const [k, f] of files.entries()) {
      $("#import .guess").textContent = reading(k + 1);
      const s = await import_copy(f).then((b) => Import.import_session(b, "log"), () => undefined);
      moved += s === undefined ? 1 : 0;
      found.push(...(s ? [s] : []));
    }
    dir.value = "";
    import_took(all[0]?.webkitRelativePath.split("/")[0] ?? "", { sessions: found, moved }, found.length > 0 ? "" : NONE);
  };
  zip.onchange = async () => {
    for (const f of zip.files ?? []) {
      import_draw("Reading " + f.name + "…");
      try {
        const found = await Import.import_export(await import_copy(f));
        import_took(f.name, { sessions: found, moved: 0 }, found.length > 0 ? "" : "No chats in " + f.name + ".");
      } catch (e) {
        import_took(f.name, { sessions: [], moved: 0 }, f.name + ": " + (e as Error).message);
      }
    }
    zip.value = "";
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    import_send();
  };
}

// the progress's button: Pause or Resume
function import_flow(): void {
  View.link_send(v, { $: "go", on: Boolean(v.importing?.why) }, (out) => out.error && toast(out.error));
}

// the box, opened by the menu or as a new chat's first step
async function import_open(first: boolean): Promise<void> {
  $("#menu").hidePopover();
  P.done = await fetch("/api/imported").then((res) => res.json()).catch(() => ({}));
  $("#import form .skip").textContent = first ? "Start fresh" : "Close";
  P.step = first ? "start" : P.step === "done" ? "" : P.step;
  import_draw("");
  $("#import").showPopover();
}

// a source read, its sessions by name; the slider at all again (its left end:
// the draw's min pulls it up to the first day). Its min goes first: a range
// keeps its value within its bounds (set under the last min, today with nothing
// read, it stays at today)
function import_took(name: string, read: Read, status: string): void {
  P.found.set(name, read);
  BACK.min = "0";
  BACK.value = "0";
  import_draw(status);
}

// a new chat (only its OPENING), on a computer: the box, once on this
// browser (a reload never asks again), after the intro
async function import_welcome(): Promise<void> {
  await INTRO;
  const key = kept("welcomed");
  if (localStorage.getItem(key) === null && v.pick !== null && v.parts.length === View.OPENING && v.importing === null && DESK.matches) {
    localStorage.setItem(key, "1");
    import_open(true);
  }
}

function import_send(): void {
  const picked = import_plan().picked;
  P.step = "send";
  import_draw("");
  const body = async () => new Blob(await Array.fromAsync(Import.import_body(picked), (part) => new Blob([part])));
  View.link_send(v, { $: "import", body }, import_sent);
}

// the box stays open on the import's progress (the answer says whether it
// still runs: its first progress may come before or after it)
function import_sent(out: View.Answer): void {
  P.step = out.error !== undefined ? "" : out.going ? "run" : "done";
  if (out.error === undefined) {
    P.found.clear();
  }
  import_draw(out.error === undefined ? "" : "Not imported: " + out.error);
  $("#import").showPopover();
}

// the import the box wants
function import_plan(): Import.Plan {
  const form = new FormData($<HTMLFormElement>("#import form"));
  const want = { off: [...P.off], since: import_since(), tools: form.has("tools") };
  const found = [...P.found.values()].flatMap((read) => read.sessions);
  return Import.import_plan(found, want, P.done);
}

// the slider's day, the first one taken ("2026-06-01"; at its left end,
// all: ""): it runs in days from the first new message's to today
function import_since(): string {
  return BACK.valueAsNumber > Number(BACK.min) ? new Date(BACK.valueAsNumber * 864e5).toISOString().slice(0, 10) : "";
}

// an import's progress, in the box and the header, once it is sent or
// while one runs (from any tab: its step is then "seen", whatever the box
// showed); at its end the box says so, until closed. Whether it shows.
function import_bar(): boolean {
  const run = v.importing;
  P.step = run !== null ? "seen" : P.step === "seen" ? "done" : P.step;
  const done  = P.step === "done";
  const going = ["send", "run", "seen", "done"].includes(P.step);
  const part  = run === null ? Number(done) : run.done / Math.max(1, run.total);
  const why   = Boolean(run?.why);
  const said  = run !== null ? View.progress_show(run) : done ? Import.DONE : P.step === "send" ? "Sending…" : "Starting…";
  $("#import .start").hidden = P.step !== "start";
  $("#import form").hidden = going || P.step === "start";
  $("#import .prog").hidden = !going;
  $("#import .prog .title").textContent = done ? "Memory tree built" : "Building your memory tree";
  $<HTMLProgressElement>("#import progress").value = part;
  $<HTMLProgressElement>(".imping progress").value = part;
  $(".imping").hidden = run === null;
  $(".imping").classList.toggle("why", why);
  $(".imping span").textContent = why ? "Import paused" : "Building memory";
  $(".imping").title = $("#import .pct").textContent = said;
  $("#import .prog .sub").hidden = why || done;
  $("#import .flow").textContent = why ? "Resume" : "Pause";
  $<HTMLButtonElement>("#import .flow").hidden = run === null;
  return going;
}

// the box as P says, with a status (reading, or why not)
function import_draw(status: string): void {
  if (import_bar()) {
    return;
  }
  const reads    = [...P.found.values()];
  const sessions = reads.flatMap((read) => read.sessions);
  const plan     = import_plan();
  const msgs     = plan.msgs;
  const left     = reads.reduce((n, read) => n + read.moved, 0);
  const moved    = left === 0 ? "" : " (" + left + (left === 1 ? " file" : " files") + " changed while read: choose the folder again to add them)";
  const found    = sessions.length === 0 ? "" : plan.first === "" ? Import.OLD : Import.import_count(msgs, "new ");
  const day = (at: string | number) => new Date(at).getUTCDate() + " " + new Date(at).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  BACK.min = String(Math.floor(Date.parse(plan.first || new Date().toISOString()) / 864e5));
  BACK.max = String(Math.floor(Date.now() / 864e5));
  $("#import .since .from").textContent = day(import_since() || plan.first || Date.now());
  $("#import .since .to").textContent = day(Date.now());
  BACK.style.setProperty("--at", (100 * (BACK.valueAsNumber - Number(BACK.min))) / Math.max(1, Number(BACK.max) - Number(BACK.min)) + "%");
  $("#import .want").hidden = plan.first === "";
  $("#import .tools").hidden = !sessions.some((s) => s.heads.some((m) => m.kind === "tool" || m.kind === "echo"));
  $("#import .found").textContent = found + moved;
  for (const src of import_srcs()) {
    const list  = src.querySelector(".sessions")!;
    const shown = plan.sessions.filter((s) => s.app === src.dataset.app);
    markup(list, shown.map((s) => `<label title="${Html.esc(s.where + ", " + Import.import_count(s.heads.length, ""))}"><input type="checkbox" name="session" value="${Html.esc(Import.import_id(s))}">${Import.import_cells(s).map((c) => `<span>${Html.esc(c)}</span>`).join("")}</label>`));
    list.querySelectorAll("input").forEach((box) => (box.checked = !P.off.has(box.value)));
    const on = shown.filter((s) => !P.off.has(Import.import_id(s))).length;
    src.querySelector<HTMLElement>(".pick")!.hidden = shown.length === 0;
    src.querySelector(".pick summary")!.textContent = (on < shown.length ? on + " of " : shown.length > 1 ? "All " : "") + shown.length + (shown.length === 1 ? " session" : " sessions") + " picked · choose";
  }
  $("#import .guess").textContent = status;
  const [go, dir] = [$<HTMLButtonElement>("#import .go"), $<HTMLButtonElement>(".pickdir")];
  go.hidden = msgs === 0;
  go.disabled = status.startsWith("Reading");
  dir.textContent = msgs > 0 ? "Add a folder" : "Choose folder";
  dir.classList.toggle("alt", msgs > 0);
  dir.disabled = go.disabled;
  import_srcs().forEach((src) => (src.querySelector<HTMLButtonElement>(".pickzip")!.disabled = dir.disabled));
}

// each app's box (index.html .src, by data-app)
function import_srcs(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#import .src")];
}

// a picked file as it is now, copied a chunk at a time (the browser keeps
// the chunks, on disk when large, so the page never holds it whole)
async function import_copy(file: File): Promise<Blob> {
  const reader = file.stream().getReader();
  const parts: Blob[] = [];
  for (let got = await reader.read(); !got.done; got = await reader.read()) {
    parts.push(new Blob([got.value]));
  }
  return new Blob(parts);
}

// Drawing
// =======

// an element's children, one per markup, each made only when no child
// has its markup: the rest stay as they are, so a fold or a new message
// touches its own row only, and what is under the mouse, selected or
// loaded stays (a reply streams into its last row only)
const MARKUP = new WeakMap<Element, string>();

function markup(el: Element, htmls: string[]): void {
  const had = new Map<string, Element[]>();
  for (const child of el.children) {
    const html = MARKUP.get(child)!;
    const same = had.get(html) ?? [];
    same.push(child);
    had.set(html, same);
  }
  const kids = htmls.map((html) => had.get(html)?.shift() ?? html_parse(html));
  for (const left of had.values()) {
    left.forEach((child) => child.remove());
  }
  let at = el.firstElementChild;
  for (const kid of kids) {
    if (kid === at) {
      at = at.nextElementSibling;
    } else {
      el.insertBefore(kid, at);
    }
  }
}

// one markup's element, its markup kept
function html_parse(html: string): Element {
  const made = document.createElement("template");
  made.innerHTML = html;
  const child = made.content.firstElementChild!;
  MARKUP.set(child, html);
  return child;
}

// draws the page at the next frame; stick: keep the bottom, if at it
function draw(stick: boolean): void {
  P.stick = P.stick && stick;
  if (P.frame === 0) {
    P.frame = requestAnimationFrame(() => {
      paint();
      mine_show();
    });
  }
}

// a new chat shown opens at its bottom (folded: its top); a page shown
// (the settings, the tree), only the bars
function paint(): void {
  if ($("#log").hidden) {
    P.frame = 0;
    P.stick = true;
    bars();
    return;
  }
  if (P.mode === "desk") {
    P.frame = 0;
    bars();
    desk_draw();
    return;
  }
  const doc = document.documentElement;
  const follow = P.stick && P.end;
  const at = P.rows && !follow ? anchor() : null;
  const shown = shown_key();
  P.frame = 0;
  P.stick = true;
  bars();
  if (P.rows) {
    markup($("#log .rows"), View.view_body(v).map(Html.row_html));
    Box.box_sizes($("#log .rows"));
    P.rows = false;
  }
  markup($("#log .tail"), View.view_tail(v).map(Html.row_html));
  Box.box_sizes($("#log .tail"));
  folds();
  frames();
  const back = P.back === null ? null : document.querySelector<HTMLElement>(`#log [data-a="${P.back.a}"]`);
  if (back !== null && P.back !== null) {
    P.shown = shown;
    scrollBy(0, back.getBoundingClientRect().top - P.back.top);
    P.back = null;
    P.end = at_end();
    return;
  }
  if (shown !== P.shown) {
    P.shown = shown;
    P.end = v.fold === null;
    scrollTo(0, v.fold === null ? doc.scrollHeight : 0);
    return;
  }
  if (follow) {
    scrollTo(0, doc.scrollHeight);
    return;
  }
  if (at === null) {
    return;
  }
  const rows = [...document.querySelectorAll<HTMLElement>("#log [data-a]")];
  const el = rows.filter((r) => Number(r.dataset.a) <= at.a).pop();
  if (el !== undefined) {
    scrollBy(0, el.getBoundingClientRect().top - at.top);
    P.end = at_end();
  }
}

// which chat shows (an agent's, folded): one other than last drawn opens
// anew
function shown_key(): string {
  return (v.page === null ? "" : v.page.name) + (v.fold === null ? "" : "/fold");
}

// the page at its bottom
function at_end(): boolean {
  return innerHeight + scrollY >= document.documentElement.scrollHeight - 1;
}

// the header's and the footer's parts that change, and the notes, a
// server's or an act's ("/help is no command", "haiku-5.5 has no fast"),
// as toasts
function bars(): void {
  for (const note of v.notes.splice(0)) {
    toast(note);
  }
  // (after this draw: a page shown is drawn and placed first)
  if (P.due && !P.going && renew_free()) {
    P.going = true;
    setTimeout(renew);
  }
  const on = View.view_typing(v);
  const stop = on && v.busy && Box.box_blank();
  const tabs = View.view_tabs(v);
  const send = $<HTMLButtonElement>(".send");
  $(".net").hidden = v.up;
  $(".timers").hidden = v.timers.length === 0;
  $(".timers span").textContent = String(v.timers.length);
  markup($("#timers ul"), Html.timers_html(v.timers));
  if (v.timers.length === 0 && $("#timers").matches(":popover-open")) {
    $("#timers").hidePopover();
  }
  tasks_bar();
  const turn = View.desk_list(v.tasks).find((g) => g.group === "now")?.tasks.length ?? 0;
  turn_show(turn);
  $(".mode").hidden = false;
  $(".mode").textContent = P.mode === "desk" ? "Conversa" : turn === 0 ? "Mesa" : "Mesa · " + turn;
  send.classList.toggle("stop", stop);
  // an agent's page has no box: messages go to UniiChat
  $(".composer").hidden = !on;
  $<HTMLButtonElement>(".mic").disabled = v.out.some((p) => p.msg.$ === "voice");
  $(".mic").classList.toggle("rec", P.rec !== null);
  $(".composer").classList.toggle("off", !on);
  $(".composer").classList.toggle("rec", P.rec !== null);
  // a knob focused (its menu just closed) stays so as its value changes
  const knob = (document.activeElement as HTMLElement | null)?.dataset?.knob;
  markup($("#pick"), Html.pick_html(View.view_fold(v), v.fold === null, View.view_pick(v)));
  if (knob !== undefined) {
    $("#pick [data-knob=" + knob + "]").focus();
  }
  mcp_draw();
  $("#tabs").hidden = tabs.length < 2;
  markup($("#tabs"), Html.tabs_html(tabs));
  import_bar();
}

// the first row in sight with a first message (no row inside it): that
// message, and where it is on screen. None in sight: the page keeps its
// scroll, as those rows only grow at its end
function anchor(): { a: number; top: number } | null {
  for (const r of document.querySelectorAll<HTMLElement>("#log [data-a]")) {
    const box = r.getBoundingClientRect();
    if (box.bottom > 60 && r.querySelector("[data-a]") === null) {
      return box.top < innerHeight ? { a: Number(r.dataset.a), top: box.top } : null;
    }
  }
  return null;
}

// Mine
// ====
// The button at the top goes up to the user's last message out of
// sight above, and each press after to the one before it: a reply's
// thinking, tool calls and output can bury the prompt it answers.

function mine(): void {
  const rows = [...document.querySelectorAll<HTMLElement>("#log .msg.user")];
  const el = rows.findLast(mine_above);
  if (el !== undefined) {
    P.end = false;
    el.scrollIntoView();
  }
  mine_show();
}

// shown while one of the user's messages is above the screen; the one
// down (down), while the page is not at its bottom nor kept at it
function mine_show(): void {
  const first = document.querySelector<HTMLElement>("#log .msg.user");
  $(".mine").hidden = first === null || !mine_above(first);
  $(".down").hidden = P.end || innerHeight + scrollY >= document.documentElement.scrollHeight - 1;
}

// the button above the pick bar goes down to the page's bottom, which the
// next draws then keep
function down(): void {
  scrollTo(0, document.documentElement.scrollHeight);
  P.end = true;
  mine_show();
}

function mine_above(el: HTMLElement): boolean {
  return el.getBoundingClientRect().top < $("header").getBoundingClientRect().bottom;
}

// Settings
// ========
// The settings page (Html.account_html), drawn anew each time it is shown
// and after each act on it: the prompts, this browser's sign-in, then the
// server's settings (Html.settings_html), drawn anew after each save, which sends only what changed (null: back to the default; a key
// out), and the version of the files it read, so a save on what changed
// since is refused. A key typed is sent once and gone from the page as
// it is drawn again.

// shows the page at path: the chat ("/"), the settings or the tree (its
// #view too)
function go(path: string): void {
  if (location.pathname + location.hash !== path) {
    history.pushState(null, "", path);
  }
  route();
}

// the settings page and the tree keep of the footer only its toasts
// (style.css); the chat, back from them, is where it was (P.away): at its
// bottom, kept there
function route(): void {
  const pipe = location.pathname === PIPE;
  const page = PAGES.includes(location.pathname) || pipe;
  const tree = location.pathname === TREE;
  const st = history.state ?? {};
  if (st.mode === "desk" || st.mode === "chat") {
    P.mode = st.mode;
  }
  if (typeof st.sel === "string") {
    P.sel = st.sel;
  }
  P.pane = st.pane === true && NARROW.matches;
  const desk = !page && !tree && P.mode === "desk";
  const chat = !page && !tree && !desk;
  if (!chat && !$("#log").hidden && P.away === null) {
    P.away = { y: scrollY, end: P.end };
  }
  $("#log").hidden = !chat;
  $("#desk").hidden = !desk;
  document.body.classList.toggle("account", page);
  document.body.classList.toggle("tree", tree);
  document.body.classList.toggle("desk", desk);
  document.body.classList.toggle("pane", desk && P.pane);
  $("#account").hidden = !page;
  $("#tree").hidden = !tree;
  P.at = location.pathname + location.hash;
  P.shown = chat && P.away !== null ? shown_key() : location.pathname + (desk ? "/mesa" : "");
  if (chat && P.away !== null) {
    P.end = P.away.end;
    // its rows drawn first (none yet, if the page was reloaded away from it)
    P.rows = true;
    paint();
    scrollTo(0, P.end ? document.documentElement.scrollHeight : P.away.y);
    P.y = scrollY;
    P.away = null;
  }
  $("#account").classList.toggle("pipe", pipe);
  if (pipe) {
    pipeline();
  } else if (page) {
    account();
  }
  if (tree) {
    Tree.tree_show(tree_view() ? "VIEW" : "TREE");
  } else {
    Tree.tree_hide();
  }
  draw(chat && P.end);
}

// back or forward: another page shows (route), or the same, a picture
// opened or closed over it only (Viewer.ts: no page of its own); a
// reload put off while it showed may go now (bars)
function popped(): void {
  // the Mesa and the Conversa (and a task's pane) share "/": their step
  // is told by the history's state
  const st = history.state ?? {};
  const desk = (st.mode === "desk" || st.mode === "chat") && (st.mode !== P.mode || (st.pane === true) !== P.pane || (typeof st.sel === "string" && st.sel !== P.sel));
  if (location.pathname + location.hash !== P.at || desk) {
    route();
  }
  Viewer.viewer_sync();
  draw(true);
}

// The pipeline's panel
// --------------------
// /api/pipeline read and drawn (Html.pipeline_html); while the server
// reads PRs live (refreshing), read again in PIPE_AGAIN, PIPE_TRIES times
// at most; the fronts open stay open
const PIPE_AGAIN = 4000;
const PIPE_TRIES = 5;
let PIPED = 0;
async function pipeline(tries = 0): Promise<void> {
  const el = $("#account");
  const run = ++PIPED;
  if (tries === 0 && el.querySelector(".pipe-totals") === null) {
    el.innerHTML = `<a class="back" href="/" data-go="/">← Voltar</a><h1>Pipeline</h1><p class="pipe-read">Lendo…</p>`;
  }
  const got = await fetch("/api/pipeline").catch(() => null);
  const panel = got !== null && got.ok ? await got.json().catch(() => null) : null;
  if (run !== PIPED || location.pathname !== PIPE) {
    return;
  }
  const shown = el.querySelectorAll<HTMLDetailsElement>("details.pipe-front");
  const opened = shown.length === 0 ? null : new Set([...shown].filter((d) => d.open).map((d) => d.dataset.ref ?? ""));
  const y = scrollY;
  el.innerHTML = Html.pipeline_html(panel, Date.now(), got === null ? "Sem conexão com o UniiChat." : "Não foi possível ler o painel (" + (got.status || "erro") + ").", opened);
  scrollTo(0, y);
  el.querySelectorAll<HTMLButtonElement>(".pipe-reload").forEach((b) => (b.onclick = () => pipeline()));
  if (panel?.refreshing === true && tries < PIPE_TRIES) {
    setTimeout(() => run === PIPED && location.pathname === PIPE && pipeline(tries + 1), PIPE_AGAIN);
  }
}

async function account(): Promise<void> {
  const el = $("#account");
  const [got, set] = await Promise.all([fetch("/api/prompts").catch(() => null), fetch("/api/settings").catch(() => null)]);
  const prompts: View.Prompts | null = got !== null && got.ok ? await got.json().catch(() => null) : null;
  const push = await notify_state().catch(() => null);
  el.innerHTML = Html.account_html(prompts, push);
  // (drawn anew: nothing on it edited yet)
  P.dirty.clear();
  el.oninput = (ev) => {
    const form = (ev.target as Element).closest("form");
    if (form !== null) {
      P.dirty.add(form);
    }
  };
  el.querySelectorAll<HTMLFormElement>("form.prompt").forEach((form) => (form.onsubmit = (ev) => {
    ev.preventDefault();
    account_prompt(form);
  }));
  mcp_draw();
  el.querySelectorAll<HTMLButtonElement>(".retry").forEach((retry) => (retry.onclick = () => account()));
  $("#account .out").onclick = signout;
  const bell = document.querySelector<HTMLButtonElement>("#account .notify");
  bell?.addEventListener("click", () => {
    bell.disabled = true;
    notify(push !== "on");
  });
  const page = set?.ok ? await set.json().catch(() => null) : null;
  if (page === null) {
    $("#account .owned").innerHTML = `<p class="sub">Could not read the server's settings. Try again in a moment.</p>`;
    return;
  }
  settings_draw(page);
}

// the page's MCP servers, as the chat's state has them (Html.mcp_html);
// a switch focused stays so as it flips
function mcp_draw(): void {
  // (no pick: the chat's state not here yet)
  const box = document.querySelector("#account .mcp");
  if (box === null || v.pick === null) {
    return;
  }
  const on = box.contains(document.activeElement) ? document.activeElement!.getAttribute("aria-label") : null;
  markup(box, Html.mcp_html(v.mcp));
  [...box.querySelectorAll<HTMLElement>("[role=switch]")].find((b) => b.getAttribute("aria-label") === on)?.focus();
}

async function signout(): Promise<void> {
  await notify_sub().then((sub) => sub?.unsubscribe()).catch(() => {});
  await View.post("/api/logout", {});
  location.href = "/";
}

// a prompt saved (the user prompt or the compaction prompt), shown as
// it is now (empty: the default); text typed while it saved is not, and
// says so
async function account_prompt(form: HTMLFormElement): Promise<void> {
  const area = form.querySelector("textarea")!;
  const why  = form.querySelector(".why")!;
  const save = form.querySelector("button")!;
  const sent = area.value;
  save.disabled = true;
  P.saving++;
  const out = await View.post("/api/prompts", { [area.name]: sent });
  P.saving--;
  save.disabled = false;
  if (out.error === undefined && area.value === sent) {
    area.value = out[area.name]?.text ?? sent;
  }
  why.textContent = out.error ?? (area.value === out[area.name]?.text ? "Saved." : "Not saved yet: Save again.");
  form.classList.toggle("bad", out.error !== undefined);
  if (out.error === undefined && area.value === sent) {
    P.dirty.delete(form);
    P.since = true;
  }
  draw(false);
}

// Notifications
// =============
// Web Push (Push.ts): turned on on the account page, by a click, as only
// a click may ask the browser's permission (subscribing asks it), so
// what subscribing needs (P.push) is read as the page is drawn. On while
// this browser's subscription is kept for this sign-in
// (Owner.web_subscribe); signing out ends it.

// null: none to offer (the app notifies by itself; a browser without
// push, or whose push service fails, as Firefox's with push turned off)
async function notify_state(): Promise<Html.Notify | null> {
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
  const out = res?.ok ? await res.json() : null;
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
    toast(out.error ?? (on ? "Notificações ativadas." : "Notificações desativadas."));
  } catch (err: any) {
    const denied = typeof Notification !== "undefined" && Notification.permission === "denied";
    toast(denied ? "As notificações estão bloqueadas nas configurações deste navegador." : (on ? "Não foi possível ativar as notificações: " : "Não foi possível desativar as notificações: ") + (err?.message ?? err));
  }
  account();
}

// the browser asked first, at once (the click's); a subscription to
// another key (the server's keys made anew) is replaced
async function notify_on(reg: ServiceWorkerRegistration, key: string): Promise<any> {
  const bytes = notify_bytes(key);
  const ask = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  const sub = await ask().catch(async (err) => {
    const old = await reg.pushManager.getSubscription();
    if (old === null || err?.name !== "InvalidStateError") {
      throw err;
    }
    await old.unsubscribe();
    return ask();
  });
  return View.post("/api/webpush", sub.toJSON());
}

async function notify_off(reg: ServiceWorkerRegistration): Promise<any> {
  const sub = await reg.pushManager.getSubscription();
  if (sub !== null) {
    const headers = { "content-type": "application/json" };
    await fetch("/api/webpush", { method: "DELETE", headers, body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  }
  return {};
}

function settings_draw(page: any): void {
  $("#account .owned").innerHTML = Html.settings_html(page);
  const form = $<HTMLFormElement>("#account form.settings");
  const rows = new Map<string, any>(page.settings.map((r: any) => [r.key, r]));
  const unset = new Set<string>();
  // the profiles as edited (none shown: UNII_PROFILES sets them), each
  // its name and models in order; drawn anew as one changes, the focus
  // put back on what it was on
  const profs: Array<[string, string[]]> = Object.entries(page.profiles ?? {});
  const box = form.querySelector<HTMLElement>(".profiles .field");
  const names = () => profs.map(([name]) => name.trim()).filter((name) => name !== "");
  // a list's items: its boxes checked, or (not shown) its value
  const listed = (key: string) => {
    const boxes = [...form.querySelectorAll<HTMLInputElement>(`input[name="${key}"]`)];
    return boxes.length === 0 ? Html.list(rows.get(key).value) : boxes.filter((b) => b.checked).map((b) => b.value);
  };
  // the models of the vendors checked shown, each pick's four lists of
  // what they offer, a vendor checked without a key warned of
  const picks = () => {
    const vendors = listed("vendors");
    form.querySelectorAll<HTMLElement>(".opt[data-vendor]:not([data-vendor=''])").forEach((o) => (o.hidden = !o.dataset.vendor!.split(" ").some((v) => vendors.includes(v))));
    for (const key of Html.PICKS) {
      const value = form.querySelector<HTMLInputElement>(`input[name="${key}"]`);
      const four = value?.parentElement!.querySelector<HTMLElement>(".four");
      if (value && four) {
        const focus = (document.activeElement as HTMLSelectElement | null)?.name;
        four.innerHTML = Html.picks_html(key, vendors, listed("models"), value.value, key === "agents" ? "The chat's pick" : null, names());
        four.querySelector<HTMLSelectElement>(`select[name="${focus}"]`)?.focus();
      }
    }
    const keyless = vendors.filter((v) => {
      const name = Html.VENDOR_KEY[v];
      const key = page.keys.find((k: any) => k.name === name);
      const typed = form.querySelector<HTMLInputElement>(`[name="key.${name}"]`)?.value.trim() ?? "";
      return key !== undefined && (key.from === "default" || unset.has("key." + name)) && typed === "";
    });
    const warn = form.querySelector(".warn");
    if (warn !== null) {
      warn.textContent = keyless.length === 0 ? "" : keyless.join(" and ") + (keyless.length === 1 ? " has" : " have") + " no key set: its calls will fail till one is.";
    }
  };
  form.oninput = (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>(".set");
    if (el === null) {
      return;
    }
    unset.delete(el.dataset.key!);
    el.classList.remove("unset");
    el.querySelector(".err")!.textContent = "";
    const value = el.querySelector<HTMLInputElement>("input[type=hidden]");
    if (value !== null) {
      value.value = Html.pick_mend([...el.querySelectorAll("select")].map((s) => s.value), listed("models"), names());
    }
    picks();
    if (el.dataset.key === "vendors" || el.dataset.key === "models") {
      profs_draw();
    }
  };
  form.onclick = (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>(".reset");
    if (btn === null) {
      return;
    }
    const el = btn.closest<HTMLElement>(".set")!;
    const key = el.dataset.key!;
    const r = rows.get(key);
    el.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((b) => (b.checked = Html.list(r.def).includes(b.value)));
    el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type=checkbox]), textarea").forEach((i) => (i.value = r?.def ?? ""));
    picks();
    unset.add(key);
    el.classList.add("unset");
    btn.hidden = true;
    el.querySelector(".from")!.insertAdjacentText("beforeend", key.startsWith("key.") ? " · removed once saved" : " · the default once saved");
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    settings_save(form, page, unset, listed, profs);
  };
  const profs_draw = (focus?: string) => {
    if (box !== null) {
      box.innerHTML = Html.profiles_html(profs, Html.offered(listed("vendors"), listed("models")));
      (focus === undefined ? null : box.querySelector<HTMLElement>(focus) ?? box.querySelector<HTMLElement>(".pnew"))?.focus();
    }
  };
  const profs_changed = (focus: string) => {
    profs_draw(focus);
    box!.closest(".set")!.querySelector(".err")!.textContent = "";
    picks();
  };
  // a pick on a profile renamed follows it
  const renamed = (was: string, now: string) => {
    for (const key of Html.PICKS) {
      const value = form.querySelector<HTMLInputElement>(`input[name="${key}"]`);
      if (value !== null && was.trim() !== "" && now !== "" && value.value === was.trim()) {
        value.value = now;
      }
    }
  };
  box?.addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button");
    const [i, j] = [Number(b?.dataset.i), Number(b?.dataset.j)];
    if (b?.classList.contains("pnew")) {
      profs.push(["", []]);
      profs_changed(`.pname[data-i="${profs.length - 1}"]`);
    } else if (b?.classList.contains("pdel")) {
      profs.splice(i, 1);
      profs_changed(".pnew");
    } else if (b?.classList.contains("out")) {
      profs[i][1].splice(j, 1);
      profs_changed(`.add[data-i="${i}"]`);
    }
  });
  box?.addEventListener("change", (ev) => {
    const add = (ev.target as HTMLElement).closest<HTMLSelectElement>("select.add");
    if (add !== null && add.value !== "") {
      const i = Number(add.dataset.i);
      profs[i][1].push(add.value);
      profs_changed(`.add[data-i="${i}"]`);
    }
  });
  box?.addEventListener("input", (ev) => {
    const name = (ev.target as HTMLElement).closest<HTMLInputElement>("input.pname");
    if (name !== null) {
      const i = Number(name.dataset.i);
      renamed(profs[i][0], name.value.trim());
      profs[i][0] = name.value;
    }
  });
  // a model moved by its handle: arrow keys a place up or down
  box?.addEventListener("keydown", (ev) => {
    const grip = (ev.target as HTMLElement).closest<HTMLButtonElement>(".grip");
    if (grip === null || (ev.key !== "ArrowUp" && ev.key !== "ArrowDown")) {
      return;
    }
    ev.preventDefault();
    const [i, j] = [Number(grip.dataset.i), Number(grip.dataset.j)];
    const k = j + (ev.key === "ArrowUp" ? -1 : 1);
    const list = profs[i][1];
    if (k >= 0 && k < list.length) {
      [list[j], list[k]] = [list[k], list[j]];
      profs_changed(`.grip[data-i="${i}"][data-j="${k}"]`);
    }
  });
  // or dragged (a mouse, a finger, a pen): its row follows the pointer
  // among the others, and stays where it is let go
  box?.addEventListener("pointerdown", (ev) => {
    const grip = (ev.target as HTMLElement).closest<HTMLButtonElement>(".grip");
    if (grip === null || ev.button !== 0) {
      return;
    }
    ev.preventDefault();
    const li = grip.closest("li")!;
    const ol = li.parentElement!;
    const [i, from] = [Number(grip.dataset.i), Number(grip.dataset.j)];
    li.classList.add("drag");
    const move = (e: PointerEvent) => {
      const below = [...ol.children].find((c) => c !== li && e.clientY < c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2);
      if (below !== li.nextElementSibling || below === undefined) {
        ol.insertBefore(li, below ?? null);
      }
    };
    // on the window: a row moved loses its pointer capture
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const to = [...ol.children].indexOf(li);
      const list = profs[i][1];
      list.splice(to, 0, ...list.splice(from, 1));
      profs_changed(`.grip[data-i="${i}"][data-j="${to}"]`);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
  profs_draw();
  picks();
}

async function settings_save(form: HTMLFormElement, page: any, unset: Set<string>, listed: (key: string) => string[], profs: Array<[string, string[]]>): Promise<void> {
  const set: Record<string, string | null> = {};
  const keys: Record<string, string | null> = {};
  for (const r of page.settings) {
    // one not shown isn't sent
    if (form.querySelector(`.set[data-key="${r.key}"]`) === null) {
      continue;
    }
    const field = form.querySelector<HTMLInputElement>(`input[name="${r.key}"]`);
    // a list changed only if its items did (the boxes' order is no
    // change: Html.list_changed)
    const now = r.key === "vendors" || r.key === "models" ? Html.list_changed(Html.list(r.value), listed(r.key))?.join(",") ?? r.value : field?.value.trim() ?? r.value;
    if (unset.has(r.key)) {
      set[r.key] = null;
    } else if (now !== r.value) {
      set[r.key] = now;
    }
  }
  for (const k of page.keys) {
    const typed = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="key.${k.name}"]`)?.value.trim() ?? "";
    if (unset.has("key." + k.name)) {
      keys[k.name] = null;
    } else if (typed !== "") {
      keys[k.name] = typed;
    }
  }
  const why = form.querySelector(".save .why")!;
  form.querySelectorAll(".err").forEach((e) => (e.textContent = ""));
  // the profiles, sent whole if changed; each named, once, with a model
  let profiles: Record<string, string[]> | undefined;
  if (page.profiles != null) {
    const now = profs.map(([name, list]): [string, string[]] => [name.trim(), list]);
    const all = now.map(([name]) => name);
    const bad = all.includes("") ? "Name each profile." : all.some((name, k) => all.indexOf(name) !== k) ? "Two profiles have the same name." : now.some(([, list]) => list.length === 0) ? "Add a model to each profile." : null;
    if (bad !== null) {
      const at = form.querySelector<HTMLElement>(".profiles")!;
      at.querySelector(".err")!.textContent = bad;
      at.scrollIntoView({ block: "center" });
      return;
    }
    const was = JSON.stringify(page.profiles);
    profiles = JSON.stringify(Object.fromEntries(now)) === was ? undefined : Object.fromEntries(now);
  }
  if (Object.keys(set).length === 0 && Object.keys(keys).length === 0 && profiles === undefined) {
    why.textContent = "Nothing changed.";
    return;
  }
  const go = form.querySelector<HTMLButtonElement>(".go")!;
  go.disabled = true;
  why.textContent = "";
  P.saving++;
  const out = await View.post("/api/settings", { version: page.version, set, keys, ...(profiles === undefined ? {} : { profiles }) });
  P.saving--;
  go.disabled = false;
  if (!out.ok) {
    const at = out.key === undefined ? null : form.querySelector<HTMLElement>(`.set[data-key="${out.key}"]`);
    (at?.querySelector(".err") ?? why).textContent = out.error ?? "Could not save.";
    (at ?? why).scrollIntoView({ block: "center" });
    return;
  }
  const later = (out.saved as string[]).filter((key) => page.settings.find((r: any) => r.key === key)?.apply === "restart");
  // (drawn anew from what was saved: nothing edited on it now)
  settings_draw(out);
  P.dirty.delete(form);
  P.since = true;
  draw(false);
  toast(later.length === 0 ? "Saved." : "Saved. " + later.join(", ") + " " + (later.length === 1 ? "applies" : "apply") + " once the server restarts.");
}

// Renew
// =====
// The server's web app has another build than this page (after an
// update): the page reloads into it by itself, once nothing would be
// lost, keeping what it showed: the box's text and caret, the folds
// opened, where the chat or the page was scrolled. Never while the mic
// records, a file uploads, an act awaits its answer, or Import History
// or a picture (Viewer.ts) is open; on a phone, not while its keyboard
// is up (the box focused), but as the page is hidden. On the settings
// page only once a change is saved after the new build came, with
// nothing else edited and unsaved, or as it is left. Checked again
// right before reloading. The cached shell is dropped first; at most two
// reloads per build (the second past the browser's cache too), then one
// more on each new socket.

function renew_due(build: string | undefined): void {
  if (build === undefined || P.build === "" || build === P.build) {
    P.build ||= build ?? "";
    P.due = false;
    return;
  }
  const [was, n] = (sessionStorage.getItem(kept("build")) ?? "").split(" ");
  if (was === build && Number(n) >= 2 && (P.gave === null || P.gave === v.ws)) {
    P.gave = v.ws;
    return;
  }
  P.since = P.due && P.since;
  P.due = true;
  draw(false);
}

function renew_free(hidden = false): boolean {
  const page = location.pathname !== "/" && location.pathname !== TREE;
  const quiet = P.rec === null && UPS.size === 0 && v.out.length === 0 && !$("#import").matches(":popover-open") && !Viewer.viewer_on();
  const typing = !DESK.matches && Box.box_focused() && !hidden;
  return quiet && !typing && (!page || (P.since && P.dirty.size === 0 && P.saving === 0));
}

async function renew(hidden = false): Promise<void> {
  const [was, n] = (sessionStorage.getItem(kept("build")) ?? "").split(" ");
  const tries = was === v.build ? Number(n) : 0;
  const store = isSecureContext && "caches" in window ? window.caches : null;
  const keys = (await store?.keys().catch(() => [])) ?? [];
  await Promise.all(keys.filter((k) => k.startsWith("unii-shell")).map((k) => store?.delete(k)));
  if (tries > 0) {
    await Promise.all(["/", "/app.js", "/style.css", "/sw.js"].map((path) => fetch(path, { cache: "reload" }).catch(() => null)));
  }
  // (the page may have changed meanwhile)
  if (!P.due || !renew_free(hidden)) {
    P.going = false;
    return;
  }
  const chat = !$("#log").hidden;
  const back = { at: chat && !P.end ? anchor() : null, y: chat ? null : scrollY, away: P.away, caret: Box.box_caret(), focus: Box.box_focused(), open: [...P.open] };
  sessionStorage.setItem(kept("back"), JSON.stringify(back));
  sessionStorage.setItem(kept("build"), (v.build ?? "") + " " + (tries + 1));
  location.reload();
}

// after a renew, what the page showed before
function renewed(): void {
  const text = sessionStorage.getItem(kept("back"));
  sessionStorage.removeItem(kept("back"));
  const back = text === null ? null : JSON.parse(text);
  if (back === null) {
    return;
  }
  if (back.focus && DESK.matches) {
    Box.box_focus();
  }
  Box.box_place(back.caret[0], back.caret[1]);
  back.open.forEach((id: string) => P.open.add(id));
  P.back = back.at;
  P.away = back.away;
  // a page (the settings, the tree) back where it was, once drawn that long
  const end = Date.now() + 3000;
  const y = () => back.y !== null && (document.documentElement.scrollHeight >= back.y + innerHeight || Date.now() > end ? scrollTo(0, back.y) : setTimeout(y, 100));
  y();
}

// Notes
// =====

// shown 7 s, or till hidden (stay)
function toast(text: string, stay = false): void {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(P.toast);
  P.toast = stay ? 0 : (setTimeout(() => (el.hidden = true), 7000) as unknown as number);
}

// Intro
// =====
// Once per browser (?skip: never), over the page; style.css times it, and
// its last animation, a click or a key ends it. Played, it is done once
// gone (INTRO), so no box opens over it.

function intro_play(): Promise<void> {
  const skip = new URLSearchParams(location.search).has("skip");
  if (localStorage.getItem("unii.intro") !== null || skip) {
    return Promise.resolve();
  }
  localStorage.setItem("unii.intro", "1");
  const el = document.createElement("div");
  return new Promise((gone) => {
    function end(): void {
      removeEventListener("keydown", end);
      el.classList.add("out");
      el.ontransitionend = () => {
        el.remove();
        gone();
      };
      if (DESK.matches) {
        BOX.focus();
      }
    }
    el.id = "intro";
    el.innerHTML = SCENES;
    el.onclick = end;
    el.onanimationend = (ev) => {
      if (ev.target === el) {
        end();
      }
    };
    addEventListener("keydown", end);
    document.documentElement.append(el);
  });
}

const INTRO = intro_play();
boot();
