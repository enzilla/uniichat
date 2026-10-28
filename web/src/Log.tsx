// The chat: its rows (View.view_body, made again only as they change:
// P.rows) and its tail (the reply as it streams, at each piece). After a
// draw: the rows new to the page rise in (Arrive.ts), long tool output
// folds, a page's frame fits its height, and the chat stays where it was
// (PAINT, measured before the draw), or at its end, or, another tab
// shown, at its end
import { useLayoutEffect, useRef, type ReactNode } from "react";
import * as View from "../../View.ts";
import * as Arrive from "./Arrive.ts";
import * as Box from "./Box.ts";
import { Row, rowkey } from "./Rows.tsx";
import { P, PAINT, RENEW, SCROLL, STILL, at_end, v } from "./state.ts";

let BODY: View.Row[] = [];

const FOLD = 10;
const LAST = new Map<string, number>();
const MEASURED = new WeakMap<Element, number>();
const FRAMED = new WeakSet<HTMLIFrameElement>();

export function Log({ hidden }: { hidden: boolean }): ReactNode {
  if (P.rows && !hidden) {
    BODY = View.view_body(v);
  }
  const tail = View.view_tail(v);
  const rows = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLDivElement>(null);
  const had = useRef<{ rows: Set<Element>; tail: number }>({ rows: new Set(), tail: 0 });
  useLayoutEffect(() => {
    const body = rows.current;
    const end = tailRef.current;
    if (hidden || body === null || end === null) {
      return;
    }
    const born = [...body.children].filter((c) => !had.current.rows.has(c));
    const kids = [...end.children];
    const was = had.current.tail;
    if (P.rows) {
      Box.box_sizes(body);
      P.rows = false;
    }
    Box.box_sizes(end);
    arrive(PAINT.shown, born, kids.slice(was), kids, was);
    had.current = { rows: new Set(body.children), tail: kids.length };
    folds(end);
    frames(false);
    settle();
  });
  return (
    <main id="log" hidden={hidden}>
      <div className="rows" ref={rows}>{BODY.map((r, k) => <Row key={rowkey(r, k)} row={r} />)}</div>
      <div className="tail" ref={tailRef}>{tail.map((r, k) => <Row key={"t" + k} row={r} />)}</div>
    </main>
  );
}

// the rows that just arrived rise in, a few apart
function arrive(shown: string, born: Element[], streamed: Element[], kids: Element[], was: number): void {
  const a = (el: Element) => (el instanceof HTMLElement && el.dataset.a !== undefined ? Number(el.dataset.a) : null);
  const ids = [...document.querySelectorAll<HTMLElement>("#log .rows > [data-a]")].map((el) => Number(el.dataset.a));
  const up = Arrive.arrivals(LAST, { shown, body: born.map(a), tail: streamed.map((el) => kids.indexOf(el)), tail_was: was, tail_now: kids.length, ids });
  const rise = [...up.body.map((k) => born[k]), ...up.tail.map((k) => kids[k])];
  rise.forEach((el, k) => {
    (el as HTMLElement).style.animationDelay = k * 50 + "ms";
    el.classList.add("arrive");
    el.addEventListener("animationend", () => el.classList.remove("arrive"), { once: true });
  });
}

// a message of a tool's output taller than FOLD lines folds, "Show all"
// unfolds it (main.tsx unfold); measured once per element and height of
// its content (the tail's grow as they stream)
export function folds(tail: Element | null = null): void {
  for (const cut of document.querySelectorAll<HTMLElement>("#log .msg > .cut")) {
    const msg = cut.parentElement!;
    const h = cut.scrollHeight;
    if (MEASURED.get(msg) !== h || (tail !== null && tail.contains(msg))) {
      MEASURED.set(msg, h);
      msg.classList.toggle("long", h > FOLD * parseFloat(getComputedStyle(cut).lineHeight));
    }
    fold_show(msg, SCROLL.open.has(msg.dataset.a ?? ""));
  }
}

export function fold_reset(): void {
  document.querySelectorAll("#log .msg").forEach((m) => MEASURED.delete(m));
}

export function fold_show(msg: HTMLElement, open: boolean): void {
  msg.classList.toggle("shown", open);
  const button = msg.querySelector(":scope > .unfold");
  if (button !== null) {
    button.setAttribute("aria-expanded", String(open));
    button.textContent = open ? "Show less" : "Show all";
  }
}

// a page shown in a message (an iframe) as tall as its content
export function frames(all: boolean): void {
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

// where the chat stays after a draw
function settle(): void {
  const doc = document.documentElement;
  const back = RENEW.back === null ? null : document.querySelector<HTMLElement>(`#log [data-a="${RENEW.back.a}"]`);
  if (back !== null && RENEW.back !== null) {
    P.shown = PAINT.shown;
    scrollBy(0, back.getBoundingClientRect().top - RENEW.back.top);
    RENEW.back = null;
    SCROLL.end = at_end();
    return;
  }
  if (PAINT.shown !== P.shown) {
    P.shown = PAINT.shown;
    // another tab: its rows fade in, so the swap reads as a move, not a blink
    if (!STILL.matches) {
      document.querySelector("#log .rows")?.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    }
    SCROLL.end = v.fold === null;
    scrollTo(0, v.fold === null ? doc.scrollHeight : 0);
    return;
  }
  if (PAINT.follow) {
    scrollTo(0, doc.scrollHeight);
    return;
  }
  const at = PAINT.at;
  PAINT.at = null;
  if (at === null) {
    return;
  }
  const rows = [...document.querySelectorAll<HTMLElement>("#log [data-a]")];
  const el = rows.filter((r) => Number(r.dataset.a) <= at.a).pop();
  if (el !== undefined) {
    scrollBy(0, el.getBoundingClientRect().top - at.top);
    SCROLL.end = at_end();
  }
}
