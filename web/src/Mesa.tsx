// The Mesa: the pending list, a sheet from the right over the chat
// (Desk.tsx draws it). m, Esc or its close go back to the chat; on a
// phone, Esc goes from the task shown back to the list first. Made again
// only as the tasks, the search, the project, the task shown, Unii's turn
// or the minute change (how long a task waited is said by the minute)
import { useLayoutEffect, useRef, type ReactNode } from "react";
import * as View from "../../View.ts";
import { desk_parts, type DeskParts } from "./Desk.tsx";
import { Icon } from "./Icon.tsx";
import { desk_back, desk_enter, desk_mode, task_draft } from "./main.tsx";
import { NARROW, P, draw, v } from "./state.ts";

let MADE: { key: string; of: unknown; parts: DeskParts } | null = null;

function parts(): DeskParts {
  const turn = View.turn_of(v);
  const key = [P.q, P.ref, P.sel, JSON.stringify(turn), Math.floor(Date.now() / 60e3)].join("\u0000");
  if (MADE !== null && MADE.of === v.tasks && MADE.key === key) {
    return MADE.parts;
  }
  const groups = View.desk_list(v.tasks, P.q, P.ref, Date.now());
  const ids = groups.flatMap((g) => g.tasks.map((t) => t.id));
  if (P.sel === null && !NARROW.matches && ids.length > 0) {
    P.sel = ids[0];
  }
  // the shown one still in "now": the order "Próxima" goes on from
  if (P.sel !== null && groups.some((g) => g.group === "now" && g.tasks.some((t) => t.id === P.sel))) {
    P.order = { sel: P.sel, ids };
  }
  const order = P.order.sel === P.sel ? P.order.ids : [];
  const made = desk_parts(v.tasks, P.q, P.ref, P.sel, Date.now(), { order, turn, cold: true });
  MADE = { key: [P.q, P.ref, P.sel, JSON.stringify(turn), Math.floor(Date.now() / 60e3)].join("\u0000"), of: v.tasks, parts: made };
  return made;
}

export function Mesa({ open }: { open: boolean }): ReactNode {
  const dlg = useRef<HTMLDialogElement>(null);
  const refs = View.desk_refs(v.tasks);
  if (P.ref !== "" && !refs.includes(P.ref)) {
    P.ref = "";
  }
  // the task shown gone from the list: on a wide screen the first, on a
  // phone the list
  if (P.chose && P.sel !== null && !v.tasks.some((t) => t.id === P.sel)) {
    P.sel = null;
    P.pane = false;
  }
  const { list, detail, ids } = open ? parts() : { list: [], detail: [], ids: [] };
  P.ids = ids;
  const turn = View.turn_of(v);
  const shown = v.tasks.find((t) => t.id === P.sel);
  const wait = shown !== undefined && shown.state === "open" && shown.talk === "unii" ? shown.id + ": " + View.task_talk_wait_said(shown, Date.now(), turn) : "";
  const untold = View.view_untold(v).length;
  const now = View.desk_list(v.tasks).find((g) => g.group === "now")?.tasks.length ?? 0;
  // a field's answer kept as it's left (the change event, not each key)
  useLayoutEffect(() => {
    const desk = document.getElementById("desk")!;
    const changed = (ev: Event) => task_draft(ev);
    desk.addEventListener("change", changed);
    return () => desk.removeEventListener("change", changed);
  }, []);
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
      id="mesa"
      ref={dlg}
      aria-labelledby="mesa-title"
      onCancel={(ev) => {
        ev.preventDefault();
        if (NARROW.matches && P.pane) {
          desk_back();
        } else {
          desk_mode("chat");
        }
      }}
      onClose={() => P.mode === "desk" && desk_mode("chat")}
      onClick={(ev) => ev.target === ev.currentTarget && desk_mode("chat")}
    >
      <div className="bar">
        <h2 id="mesa-title">Mesa</h2>
        <span className="sub">{now === 0 ? "nada na sua vez" : now === 1 ? "1 na sua vez" : now + " na sua vez"}</span>
        <span className="keys"><kbd>m</kbd> ou <kbd>Esc</kbd> fecha</span>
        <button className="shut" type="button" aria-label="Fechar a Mesa" title="Fechar (Esc)" onClick={() => desk_mode("chat")}><Icon name="close" /></button>
      </div>
      <div id="desk" onKeyDown={desk_enter}>
        <nav className="list" aria-label="Pendências">
          <div className="find">
            <Icon name="search" />
            <input className="q" type="search" placeholder="Buscar pendências" aria-label="Buscar pendências" autoComplete="off" value={P.q} onChange={(ev) => { P.q = ev.target.value; draw(false); }} />
            <select className="ref" aria-label="Projeto" hidden={refs.length === 0} value={P.ref} onChange={(ev) => { P.ref = ev.target.value; draw(false); }}>
              <option value="">Todos os projetos</option>
              {refs.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="rows" role="listbox" aria-label="Pendências">{list}</div>
          <button className="tell" type="button" data-act='{"$":"TasksTell"}' title="Suas respostas já estão salvas; o Unii as vê quando voltar a trabalhar. Este botão o chama agora." hidden={untold === 0}>Avisar o Unii agora ({untold})</button>
          <p className="pipe-go"><button type="button" className="link" data-go="/pipeline">Ver o painel da pipeline</button></p>
          <p className="keys"><kbd>j</kbd> <kbd>k</kbd> ou setas navegam · <kbd>Enter</kbd> abre · <kbd>/</kbd> busca</p>
        </nav>
        <section className="pane" aria-label="Pendência">{detail}</section>
        <p className="sr live" aria-live="polite" aria-atomic="true">{wait}</p>
      </div>
    </dialog>
  );
}
