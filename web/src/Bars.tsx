// The bars around the box: the pick (model, effort, speed, the talk's
// mode and its meter), the tabs (the chat and each agent at work), the
// schedules, the MCP switches. Html.ts's pick_html, tabs_html,
// timers_html, mcp_html
import { Fragment, type CSSProperties, type ReactNode } from "react";
import * as Timer from "../../Timer.ts";
import * as View from "../../View.ts";
import { act_attr } from "./Act.ts";

const MODES: Array<[string, string]> = [
  ["standard", "Each message is summarized for Unii's memory. Cheapest, good for long working sessions."],
  ["conversation", "Messages stay word-for-word in Unii's view until you switch back. Use it for discussions. It costs more per turn."],
];

function Knob({ move, hint, text, children }: { move: string; hint: string; text: string; children: ReactNode }): ReactNode {
  return (
    <>
      <button title={hint} data-knob={move} popoverTarget={"pick-" + move} aria-haspopup="menu">{text}</button>
      <div id={"pick-" + move} className="choices" popover="auto" role="menu" aria-label={move[0].toUpperCase() + move.slice(1)}>{children}</div>
    </>
  );
}

function Choice({ c }: { c: View.Choice }): ReactNode {
  return (
    <>
      {c.vendor === null ? null : <p>{c.vendor}</p>}
      <button role="menuitemradio" aria-checked={c.here} autoFocus={c.here || undefined} {...(c.here ? {} : act_attr({ $: "Move", move: c.move, to: c.to }))}>{c.text}</button>
    </>
  );
}

// the model, effort and speed, each a menu of its choices (one with none,
// a word)
export function Knobs({ knobs }: { knobs: View.Knob[] }): ReactNode {
  return knobs.map((k, i) => (
    <Fragment key={k.move}>
      {i === 0 ? null : <span className="dot">·</span>}
      {k.choices.length === 0
        ? <span className="knob" title={k.hint}>{k.text}</span>
        : <Knob move={k.move} hint={k.hint} text={k.text}>{k.choices.map((c, j) => <Choice key={j} c={c} />)}</Knob>}
    </Fragment>
  ));
}

// fold all, the talk's mode, and how much of its space it used (a meter)
export function Talk({ fold, on, talk }: { fold: string | null; on: boolean; talk?: View.Talk | null }): ReactNode {
  const [now, about] = MODES[talk == null ? 0 : 1];
  const used = talk == null ? 0 : Math.round(talk.used * 100);
  const heat = used >= 80 ? " hot" : used >= 50 ? " warm" : "";
  return (
    <>
      {fold === null ? null : <button className="all" {...act_attr({ $: "Fold", on })}>{fold}</button>}
      {talk === undefined ? null : (
        <Knob move="mode" hint={about} text={now}>
          {MODES.map(([name, hint], k) => {
            const here = (talk != null) === (k === 1);
            return <button key={name} role="menuitemradio" aria-checked={here} title={hint} autoFocus={here || undefined} {...(here ? {} : act_attr({ $: "Talk", on: k === 1 }))}>{name}</button>;
          })}
        </Knob>
      )}
      {talk == null ? null : <span className={"rule meter" + heat} style={{ "--used": used + "%" } as CSSProperties} title={`Conversation: ${used}% of space used (${View.talk_tokens(talk)})`} role="meter" aria-valuenow={used} aria-valuemin={0} aria-valuemax={100} aria-label="Conversation space used"></span>}
    </>
  );
}

export function Tabs({ tabs }: { tabs: View.Tab[] }): ReactNode {
  return tabs.map((tab) => (
    <button key={tab.name ?? "main"} className={tab.here ? "here" : undefined} title={tab.sub} {...act_attr({ $: "Goto", name: tab.name })}>
      {tab.text}{tab.sub === undefined ? null : <> <small>{tab.sub}</small></>}
    </button>
  ));
}

export function Timers({ timers }: { timers: Timer.Timer[] }): ReactNode {
  return timers.map((t) => (
    <li key={t.id} data-id={t.id}>
      <span className="when">{Timer.timer_when(t)}</span><span className="text">{t.text}</span>
      <button className="cancel" {...act_attr({ $: "Unschedule", id: t.id })}>Cancel</button>
    </li>
  ));
}

export function Mcp({ plugs }: { plugs: View.Plug[] }): ReactNode {
  if (plugs.length === 0) {
    return <p className="sub">None set up. Add them as <code>mcp</code> in a device's own config.json: they run on that device.</p>;
  }
  return plugs.map((p) => (
    <div key={p.name} className="item">
      <p>{p.name}<small>Its tools are {p.on ? "on" : "off"} in this chat.</small></p>
      <button className="chip" role="switch" aria-checked={p.on} aria-label={p.name} {...act_attr({ $: "Plug", name: p.name })}>{p.on ? "Turn off" : "Turn on"}</button>
    </div>
  ));
}
