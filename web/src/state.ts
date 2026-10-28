// The page's state
// ================
// v: the chat as the server tells it (View.ts, the terminal's too), kept
// as it is and mutated in place; P, SCROLL, RENEW, IMPORT: the page's
// own. A change calls draw(), which waits for the next frame and bumps
// the version every mounted view reads (useTick), so many changes in a
// frame draw once. Before it bumps, it measures what the chat shows (the
// anchor), on the page as it still is; the chat's view puts it back after
// the new one is on the page (Log.tsx)
import { useSyncExternalStore } from "react";
import type * as Import from "../../Import.ts";
import * as View from "../../View.ts";

export type Read = { sessions: Import.Session[]; moved: number };

export const v = View.view_new();

export const DESK   = matchMedia("(hover: hover)");
export const STILL  = matchMedia("(prefers-reduced-motion: reduce)");
// the Mesa and its list side by side, above this width (style.css)
export const NARROW = matchMedia("(max-width: 760px)");

export const PAGES = ["/settings", "/account"];
export const PIPE  = "/pipeline";
export const TREE  = "/tree";

export function kept(fact: string): string {
  return "unii." + fact;
}

export const P = {
  rec   : null as MediaRecorder | null,
  stream: null as MediaStream | null,
  secs  : 0,
  shown : "",
  rows  : true,
  push  : null as { reg: ServiceWorkerRegistration; key: string } | null,
  // the Mesa: which screen (chat: the Conversa); chose: the first state
  // picked it (P19); sel: the task shown; q, ref: the search and the
  // project; pane: on a phone, the task shown (else the list); ids: the
  // list's order; order: the list's order the last time the task shown
  // was in "now" (where "Próxima" goes on from, View.desk_next)
  mode  : (sessionStorage.getItem(kept("mode")) === "desk" ? "desk" : "chat") as "chat" | "desk",
  chose : false,
  sel   : null as string | null,
  q     : "",
  ref   : "",
  pane  : false,
  ids   : [] as string[],
  order : { sel: null as string | null, ids: [] as string[] },
  used  : { ws: null as WebSocket | null, on: false, at: 0 },
  after : false,
  // the route: its path (and hash) as last drawn
  at    : location.pathname + location.hash,
  ups   : 0,
  toast : { text: "", on: false, id: 0 },
  menu  : false,
};

export const SCROLL = {
  end   : true,
  stick : true,
  y     : 0,
  open  : new Set<string>(),
  still : false,
  away  : null as { y: number; end: boolean } | null,
};

export const RENEW = {
  build : document.documentElement.dataset.build ?? "",
  due   : false,
  going : false,
  since : false,
  dirty : new Set<string>(),
  saving: 0,
  gave  : null as WebSocket | null,
  back  : null as { a: number; top: number } | null,
};

export const IMPORT = {
  found  : new Map<string, Read>(),
  done   : {} as Import.Done,
  off    : new Set<string>(),
  step   : "" as "" | "start" | "send" | "run" | "seen" | "done",
  status : "",
  first  : false,
  open   : false,
};

// what the chat showed before this draw (Log.tsx puts it back): follow,
// stuck to its end; at, the row at the top and where it was
export const PAINT = { follow: false, at: null as { a: number; top: number } | null, shown: "" };

let version = 0;
let frame = 0;
const subs = new Set<() => void>();

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

export function useTick(): number {
  return useSyncExternalStore(subscribe, () => version);
}

// the page scrolled: only what shows by where it is (back to your
// message, to the end) is drawn again, not the whole page
let scrolled = 0;
const scrolls = new Set<() => void>();

export function useScrolled(): number {
  return useSyncExternalStore((f) => {
    scrolls.add(f);
    return () => scrolls.delete(f);
  }, () => scrolled);
}

export function scroll_bump(): void {
  scrolled++;
  scrolls.forEach((f) => f());
}

// a change: drawn on the next frame (stick: may the chat stay stuck to
// its end; a change the user didn't make, as one of theirs, may not
// pull it away)
export function draw(stick: boolean): void {
  SCROLL.stick = SCROLL.stick && stick;
  if (frame === 0) {
    frame = requestAnimationFrame(paint);
  }
}

// what runs at each draw before the views (main.tsx: notes to toasts,
// the reload due, the tab's title)
export const BEFORE: Array<() => void> = [];

function paint(): void {
  frame = 0;
  BEFORE.forEach((f) => f());
  const log = document.getElementById("log");
  const chat = log !== null && !log.hidden;
  PAINT.follow = chat && SCROLL.stick && SCROLL.end;
  PAINT.at = chat && P.rows && !PAINT.follow ? anchor() : null;
  PAINT.shown = shown_key();
  SCROLL.stick = true;
  version++;
  subs.forEach((f) => f());
}

function shown_key(): string {
  return (v.page === null ? "" : v.page.name) + (v.fold === null ? "" : "/fold");
}

export function at_end(): boolean {
  return innerHeight + scrollY >= document.documentElement.scrollHeight - 1;
}

// the first row the chat shows at its top, and where
export function anchor(): { a: number; top: number } | null {
  for (const r of document.querySelectorAll<HTMLElement>("#log [data-a]")) {
    const box = r.getBoundingClientRect();
    if (box.bottom > 60 && r.querySelector("[data-a]") === null) {
      return box.top < innerHeight ? { a: Number(r.dataset.a), top: box.top } : null;
    }
  }
  return null;
}

// a note at the foot of the page, for 7 s (stay: till the next)
export function toast(text: string, stay = false): void {
  const id = ++P.toast.id;
  P.toast = { text, on: true, id };
  if (!stay) {
    setTimeout(() => {
      if (P.toast.id === id) {
        P.toast = { ...P.toast, on: false };
        draw(false);
      }
    }, 7000);
  }
  draw(false);
}

// an act of the user's (View.view_act), sent; the chat follows a message
// sent to its end
export function act(a: View.Act, back?: (out: View.Answer) => void): void {
  const said = a.$ === "Send" ? a.text.trim() : "";
  SCROLL.end = SCROLL.end || a.$ === "Send";
  P.rows = true;
  for (const msg of View.view_act(v, a)) {
    View.link_send(v, msg, back, said);
  }
  draw(a.$ === "Send");
}
