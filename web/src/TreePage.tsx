// The memory (/tree): Tree.ts's engine (its cards, levels and gestures)
// on this page's elements; VIEW (#view) what Unii's prompt holds now,
// TREE the whole tree
import { useEffect, type ReactNode } from "react";
import * as Tree from "./Tree.ts";

export function TreePage({ on }: { on: boolean }): ReactNode {
  const which = location.hash.toLowerCase() === "#view" ? "VIEW" : "TREE";
  useEffect(() => {
    if (on) {
      Tree.tree_show(which);
    } else {
      Tree.tree_hide();
    }
  }, [on, which]);
  return (
    <main id="tree" hidden={!on}>
      <nav className="top">
        <a className="tab" href="/tree#view" data-go="/tree#view" data-tab="VIEW">O que o Unii vê</a>
        <a className="tab" href="/tree" data-go="/tree" data-tab="TREE">Árvore</a>
        <small className="legend"></small>
        <button className="prev" aria-label="Nível abaixo">‹</button>
        <button className="next" aria-label="Nível acima">›</button>
      </nav>
      <section className="view" tabIndex={-1}></section>
      <section className="bracket" tabIndex={-1}></section>
    </main>
  );
}
