// The first visit on a device: two scenes ("Your entire life. One single
// chat.", then the mark and the name), till they end, a click or a key;
// ?skip skips them. The import is offered after it (Import.tsx waits)
import { useEffect, useState, type ReactNode } from "react";
import * as Box from "./Box.ts";
import { DESK } from "./state.ts";

let told: () => void = () => {};

export const INTRO: Promise<void> = new Promise((ok) => (told = ok));

const FIRST = typeof localStorage !== "undefined" && localStorage.getItem("unii.intro") === null && !new URLSearchParams(location.search).has("skip");

if (!FIRST) {
  told();
}

export function Intro(): ReactNode {
  const [state, setState] = useState<"on" | "out" | "gone">(FIRST ? "on" : "gone");
  useEffect(() => {
    if (state !== "on") {
      return;
    }
    localStorage.setItem("unii.intro", "1");
    const end = () => setState("out");
    addEventListener("keydown", end);
    return () => removeEventListener("keydown", end);
  }, [state]);
  if (state === "gone") {
    return null;
  }
  const gone = () => {
    setState("gone");
    told();
    if (DESK.matches) {
      Box.box_focus();
    }
  };
  return (
    <div id="intro" className={state === "out" ? "out" : undefined} onClick={() => setState("out")} onAnimationEnd={(ev) => ev.target === ev.currentTarget && setState("out")} onTransitionEnd={(ev) => ev.target === ev.currentTarget && state === "out" && gone()}>
      <div className="scene"><p>Your entire life.</p><p>One single chat.</p></div>
      <div className="scene"><i className="mark"></i><h1>UniiChat</h1></div>
    </div>
  );
}
