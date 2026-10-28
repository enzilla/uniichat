// The page's frame
// ================
// A rail of icons at the left (at the foot on a phone): the Conversa, the
// Mesa with how many tasks are the user's, the memory, the pipeline, the
// settings, and More (import, theme, sign out). The column: a bar on top
// (what is shown, offline, the import running, the schedules), the chat
// or a page, and the foot (back to your message, to the end, a note,
// what Unii is doing, the box, the tabs). The Mesa is a sheet from the
// right over the chat; the settings a dialog
import { ThinkingOrb } from "thinking-orbs";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import * as View from "../../View.ts";
import { Talk, Tabs, Timers } from "./Bars.tsx";
import { Composer } from "./Composer.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { ImportBar, ImportPop, import_open } from "./Import.tsx";
import { Intro } from "./Intro.tsx";
import { Log } from "./Log.tsx";
import { Mesa } from "./Mesa.tsx";
import { PipelinePage } from "./PipelinePage.tsx";
import { Settings } from "./Settings.tsx";
import { TreePage } from "./TreePage.tsx";
import { ViewerDialog } from "./ViewerDialog.tsx";
import { attach, desk_mode, down, field_key, go, left, mic, mine, mine_above, roam, signout, submit, theme_dark, theme_swap, typed } from "./main.tsx";
import { P, PAGES, PIPE, SCROLL, TREE, at_end, useScrolled, useTick, v } from "./state.ts";

export function Solo({ title, sub }: { title: string; sub: ReactNode }): ReactNode {
  return <main><h1>{title}</h1><p className="sub">{sub}</p></main>;
}

type Place = "chat" | "desk" | "tree" | "pipe" | "set";

function RailButton({ icon, label, here, badge, onClick, className }: { icon: IconName; label: string; here?: boolean; badge?: number; onClick: () => void; className?: string }): ReactNode {
  return (
    <button type="button" className={"go" + (here ? " here" : "") + (className ? " " + className : "")} aria-label={badge ? label + ": " + badge + " na sua vez" : label} aria-current={here ? "page" : undefined} title={label} onClick={onClick}>
      <Icon name={icon} />
      <span className="lbl">{label}</span>
      {badge ? <span key={badge} className="badge" aria-hidden="true">{badge}</span> : null}
    </button>
  );
}

function Rail({ place, turn }: { place: Place; turn: number }): ReactNode {
  return (
    <nav className="rail" aria-label="Navegação">
      <button type="button" className="logo" aria-label="UniiChat: voltar ao começo da conversa" onClick={() => go("/")}><i className="mark"></i></button>
      <RailButton icon="chat" label="Conversa" here={place === "chat"} onClick={() => (place === "desk" ? desk_mode("chat") : go("/"))} />
      <RailButton icon="desk" label="Mesa" here={place === "desk"} badge={turn} onClick={() => desk_mode(place === "desk" ? "chat" : "desk")} />
      <RailButton icon="memory" label="Memória" here={place === "tree"} onClick={() => go(TREE)} />
      <RailButton icon="pipeline" label="Pipeline" here={place === "pipe"} onClick={() => go(PIPE)} />
      <span className="space"></span>
      <RailButton icon="cog" label="Configurações" className="end" here={place === "set"} onClick={() => go("/settings")} />
      <button type="button" className="go more" popoverTarget="menu" aria-label="Mais" title="Mais"><Icon name="menu" /><span className="lbl">Mais</span></button>
    </nav>
  );
}

function Menu(): ReactNode {
  const dark = theme_dark();
  return (
    <div id="menu" popover="auto">
      <button type="button" onClick={() => { document.getElementById("menu")?.hidePopover(); go("/settings"); }}><Icon name="cog" />Configurações</button>
      <button type="button" className="imp" onClick={() => void import_open(false)}><Icon name="import" />Importar histórico</button>
      <button type="button" className="theme" onClick={theme_swap}><Icon name={dark ? "light" : "dark"} />{dark ? "Tema claro" : "Tema escuro"}</button>
      <button type="button" className="out" onClick={() => void signout()}><Icon name="out" />Sair</button>
    </div>
  );
}

// what Unii is doing while it works: an orb thinking, its step, the
// subagents at work
// (its last words kept while it fades out, as the turn ends)
let DID: View.Activity | null = null;
function Doing({ a: now }: { a: View.Activity | null }): ReactNode {
  DID = now ?? DID;
  const a = DID;
  if (a === null) {
    return <p id="doing" role="status" aria-live="polite" hidden></p>;
  }
  return (
    <p id="doing" role="status" aria-live="polite" hidden={now === null}>
      <ThinkingOrb className="orb" state="working" size={32} theme={theme_dark() ? "dark" : "light"} aria-hidden="true" />
      <span className="step">{a.step}</span>
      {a.agents.length === 0 ? null : <span className="agents">{a.agents.length === 1 ? "subagente" : a.agents.length + " subagentes"}: {a.agents.map((x, k) => <span key={x.name}>{k > 0 ? ", " : ""}<span className="agent" title={x.name}>{x.label}</span></span>)}</span>}
    </p>
  );
}

// back to your message (above the screen), to the end (away from it):
// drawn again as the page scrolls, alone
function Jumps({ chat }: { chat: boolean }): ReactNode {
  useScrolled();
  const first = document.querySelector<HTMLElement>("#log .msg.user");
  const up = first !== null && chat && mine_above(first);
  const away = chat && !SCROLL.end && innerHeight + scrollY < document.documentElement.scrollHeight - 1;
  return (
    <>
      <button className="mine" type="button" title="Até a sua mensagem" aria-label="Até a sua mensagem" hidden={!up} onClick={mine}><svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" /></svg></button>
      <button className="down" type="button" title="Até o fim" aria-label="Até o fim" hidden={!away} onClick={down}><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg></button>
    </>
  );
}

export function App(): ReactNode {
  useTick();
  const path = location.pathname;
  const pipe = path === PIPE;
  const tree = path === TREE;
  const set = PAGES.includes(path);
  const desk = !pipe && !tree && P.mode === "desk";
  const chat = !pipe && !tree;
  const place: Place = set ? "set" : pipe ? "pipe" : tree ? "tree" : desk ? "desk" : "chat";
  const turn = View.desk_list(v.tasks).find((g) => g.group === "now")?.tasks.length ?? 0;
  const tabs = View.view_tabs(v);
  const dark = theme_dark();
  const foot = useRef<HTMLElement>(null);
  useEffect(() => {
    document.body.classList.toggle("tree", tree);
    document.body.classList.toggle("account", pipe);
    document.body.classList.toggle("desk", desk);
    document.body.classList.toggle("pane", desk && P.pane);
  });
  // the chat at its end stays there as it or the foot grows
  useLayoutEffect(() => {
    const log = document.getElementById("log");
    const keep = new ResizeObserver(() => {
      if (SCROLL.still) {
        SCROLL.still = false;
      } else if (SCROLL.end && log !== null && !log.hidden && !at_end()) {
        scrollTo(0, document.documentElement.scrollHeight);
      }
    });
    if (log !== null) {
      keep.observe(log);
    }
    if (foot.current !== null) {
      keep.observe(foot.current);
    }
    return () => keep.disconnect();
  }, []);
  const here = tabs.find((t) => t.here);
  const title = pipe ? "Pipeline" : tree ? "Memória" : here === undefined || here.name === null ? "Conversa" : here.text;
  return (
    <>
      <Rail place={place} turn={turn} />
      <div className="col">
        <header className="top">
          <h1>{title}</h1>
          {chat ? <span className="ctx"><Talk fold={View.view_fold(v)} on={v.fold === null} /></span> : null}
          <span className="net" hidden={v.up}>sem conexão</span>
          <ImportBar />
          <button className="timers" popoverTarget="timers" title="Agendamentos" aria-label={"Agendamentos: " + v.timers.length} hidden={v.timers.length === 0}><Icon name="bell" /><span>{v.timers.length}</span></button>
        </header>
        <Log hidden={!chat} />
        {pipe ? <PipelinePage /> : null}
        <TreePage on={tree} />
        <footer ref={foot} hidden={!chat}>
          <Jumps chat={chat} />
          <Doing a={View.activity_of(v)} />
          <div onKeyDown={(ev) => ev.target instanceof HTMLElement && ev.target.matches(".field") && field_key(ev.nativeEvent)} onKeyDownCapture={roam} onBlur={left}>
            <Composer hooks={{ typed, attach, submit, mic: () => void mic(), dark }} />
          </div>
          <nav id="tabs" hidden={tabs.length < 2}><Tabs tabs={tabs} /></nav>
        </footer>
        <div id="toast" role="status" aria-live="polite" hidden={!P.toast.on}>{P.toast.text}</div>
      </div>
      <Mesa open={desk} />
      <Settings open={set} />
      <Menu />
      <div id="timers" popover="auto">
        <p className="title">Agendamentos</p>
        <ul><Timers timers={v.timers} /></ul>
      </div>
      <ImportPop />
      <ViewerDialog />
      <Intro />
    </>
  );
}

