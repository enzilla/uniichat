// Pending tasks (Tasks.ts) on the Mesa
// ====================================
// The list at the left, by group (View.desk_list), a task a row; the
// task shown whole at the right: its head, whose move it is, then what to
// read and decide beside its ficha. What's typed in a task (its comment, fields, thread box) is
// the browser's own (uncontrolled inputs): the article is keyed by the
// task, so a draw keeps it as typed
import { Fragment, type ReactElement, type ReactNode } from "react";
import * as Md from "../../Md.ts";
import * as Deps from "../../TaskDeps.ts";
import type { Field, Task } from "../../Tasks.ts";
import * as View from "../../View.ts";
import { act_attr } from "./Act.ts";
import { Blocks } from "./Blocks.tsx";
import { Icon } from "./Icon.tsx";

// cold: the old ones go to "Antigas" (View.task_cold); order: the list's
// order while the one shown was in "now" ("Próxima" goes on from it);
// turn: Unii's turn, to say why a task waits for it
export type DeskOpts = { order?: string[]; turn?: View.Turn | null; cold?: boolean };

export type DeskParts = { list: ReactElement[]; detail: ReactElement[]; ids: string[] };

function joined(xs: ReactNode[], sep: ReactNode): ReactNode {
  return xs.map((x, k) => <Fragment key={k}>{k > 0 ? sep : null}{x}</Fragment>);
}

function and_joined(xs: ReactNode[]): ReactNode {
  return xs.map((x, k) => <Fragment key={k}>{k === 0 ? null : k === xs.length - 1 ? " e " : ", "}{x}</Fragment>);
}

function task_when(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function Marks({ t, tasks, now }: { t: Task; tasks: Task[]; now: number }): ReactElement[] {
  return View.task_marks(t, tasks, now).map(([cls, text]) => <span key={"m" + cls + text} className={"mark " + cls}>{text}</span>);
}

function marks(t: Task, tasks: Task[], now: number): ReactElement[] {
  return Marks({ t, tasks, now });
}

function Goto({ tasks, id }: { tasks: Task[]; id: string }): ReactNode {
  const u = tasks.find((x) => x.id === id);
  const how = u === undefined ? " (fora da lista)" : u.state === "open" ? "" : u.state === "done" ? " (concluída)" : " (descartada)";
  return <button className="goto" data-desk={id}>{View.id_whose(tasks, id)}{how}</button>;
}

function TaskButton({ t, state, text, cls, answer }: { t: Task; state: Task["state"]; text: string; cls: string; answer?: string }): ReactNode {
  return <button className={cls} {...act_attr({ $: "Task", task: t.id, state, ...(answer === undefined ? {} : { answer }) })}>{text}</button>;
}

function Origin({ t }: { t: Task }): ReactNode {
  const said = View.origin_said(t);
  if (said === "") {
    return null;
  }
  const url = t.origin_url !== null && /^https?:\/\//i.test(t.origin_url) ? t.origin_url : null;
  return url === null ? <span className="origin" title="Origem">{said}</span> : <a className="origin" title="Origem" href={url} target="_blank" rel="noopener noreferrer">{said}</a>;
}

function Detail({ t }: { t: Task }): ReactNode {
  return t.detail === "" ? null : <div className="detail"><div className="md"><Blocks blocks={Md.md_parse(t.detail)} /></div></div>;
}

function When({ iso, now }: { iso: string | null | undefined; now: number }): ReactNode {
  return iso == null || Number.isNaN(Date.parse(iso)) ? null : <><time dateTime={iso}>{task_when(iso)}</time> <span className="ago">({View.ago_said(iso, now)})</span></>;
}

// The ficha: a task's facts, label and value, only those it has
function Facts({ t, tasks, now, blocked }: { t: Task; tasks: Task[]; now: number; blocked: Set<string> }): ReactNode {
  const rows: [string, ReactNode][] = [];
  const add = (label: string, value: ReactNode) => value !== "" && value !== null && value !== false && !(Array.isArray(value) && value.length === 0) && rows.push([label, value]);
  const when = (iso: string | null | undefined) => (iso == null || Number.isNaN(Date.parse(iso)) ? "" : <When iso={iso} now={now} />);
  add("Situação", View.task_status_said(t));
  add("Responsável", t.assignee === "user" ? "Você" : t.assignee === "unii" ? "Unii" : t.assignee);
  add("Agente", t.agent == null ? (t.state === "open" && t.assignee !== "user" ? <span className="agent none">sem agente</span> : "") : t.agent);
  add("Origem", View.origin_said(t) === "" ? "" : <Origin t={t} />);
  add("Frente", t.ref === null ? "" : <span className="ref">{t.ref}</span>);
  add("Tipo", View.task_kind_said(t));
  add("Prioridade", View.task_priority_said(t).replace(/^prioridade /, ""));
  if (t.state === "open") {
    add("Prazo", View.task_limit_said(t, tasks, now, blocked));
  }
  add("Ordem recebida", (t.order ?? null) === null ? "" : (t.order!.answer ?? "sua escolha"));
  add("Próximo passo", t.state === "open" ? (t.next_step ?? "") : "");
  add("Pronto quando", t.done_when ?? "");
  add("Aguarda (fora da lista)", t.state === "open" ? (t.waits_for ?? "") : "");
  const after = t.after ?? [];
  add("Depende de", after.length === 0 ? "" : joined(after.map((id) => <Goto key={id} tasks={tasks} id={id} />), " "));
  const frees = t.state === "open" ? Deps.frees_ids(tasks, t) : [];
  add("Libera", frees.length === 0 ? "" : joined(frees.map((id) => <Goto key={id} tasks={tasks} id={id} />), " "));
  const prs = View.task_prs(t);
  const pr = (p: { url: string; label: string }) => {
    const c = (t.prs ?? []).find((x) => x.url === p.url);
    return (
      <span key={p.url} className="pr-fact">
        <a className="pr" href={p.url} target="_blank" rel="noopener noreferrer">{p.label}</a>
        {c === undefined ? null : <> <span className={"verdict " + c.verdict}>{View.VERDICT_SAID[c.verdict]}</span> <code>{c.head.slice(0, 7)}</code></>}
      </span>
    );
  };
  add(prs.length === 1 ? "PR" : "PRs", prs.length === 0 ? "" : prs.map(pr));
  if (t.state === "open" && (t.fields ?? []).length > 0) {
    const left = View.task_fields_left(t);
    const given = t.fields.filter((f) => Object.hasOwn(t.draft ?? {}, f.id) && !View.value_empty(t.draft[f.id])).length;
    add("Campos", given + " de " + t.fields.length + " respondidos" + (left.length === 0 ? "" : "; faltam: " + left.map((f) => f.label).join(", ")));
  }
  const thread = t.thread ?? [];
  if (thread.length > 0) {
    const last = thread[thread.length - 1];
    add("Conversa", thread.length + (thread.length === 1 ? " mensagem" : " mensagens") + "; última de " + (last.who === "user" ? "você" : "Unii") + " " + View.ago_said(last.at, now));
  }
  add("Criada", when(t.made));
  add("Última mudança", t.changed === t.made ? "" : when(t.changed));
  if (t.state !== "open") {
    add("Resolvida", when(t.closed));
    add("Resposta", t.answer ?? "");
  }
  add("Comentário", t.note ?? "");
  return (
    <aside className="facts" aria-label={"Ficha da pendência " + t.id}>
      <p className="sub">Ficha</p>
      <dl>{rows.map(([k, v]) => <div key={k} className="fact"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </aside>
  );
}

function Article({ t, cls, tasks, now, turn, marks: ms, children }: { t: Task; cls: string; tasks: Task[]; now: number; turn: View.Turn | null; marks: ReactNode[]; children: ReactNode }): ReactNode {
  const blocked = Deps.blocked_ids(tasks);
  const said = View.task_turn_said(t, tasks, now, turn, blocked);
  return (
    <article className={cls} data-task={t.id}>
      <p className="head"><span className="id">{t.id}</span><span className="title">{t.title}</span></p>
      {ms.length === 0 ? null : <p className="meta">{joined(ms, " · ")}</p>}
      <p className={"turn-line " + said.cls}><strong>{said.lead}</strong> {said.text}</p>
      <div className="cols"><div className="main">{children}</div><Facts t={t} tasks={tasks} now={now} blocked={blocked} /></div>
    </article>
  );
}

// an open task free to resolve; one of Unii's (P6): only Cobrar agora
// and Pode fechar (or Cancelar ordem, an order received)
function TaskOpen({ t, tasks, now, turn }: { t: Task; tasks: Task[]; now: number; turn: View.Turn | null }): ReactNode {
  const frees = View.task_frees_named(tasks, t);
  const mine = t.assignee === "user";
  const blocked = Deps.blocked_ids(tasks);
  const late = View.task_late_said(t, blocked, now);
  const stalled = View.task_stalled_said(t, blocked, now);
  const prio = View.task_priority_said(t);
  const said = View.task_talk_wait_said(t, now, turn, blocked);
  const ms = [
    ...(prio === "" ? [] : [<span key="prio" className={"prio " + Deps.priority_of(t)}>{prio}</span>]),
    ...(late === "" ? [] : [<span key="late" className="late">{late}</span>]),
    ...(frees === "" ? [] : [<span key="frees" className="frees">{frees}</span>]),
    ...(said === "" ? [] : [<span key="talk" className={"talk " + View.talk_cls(said)}>{said}</span>]),
    ...(stalled.text === "" ? [] : [<span key="stalled" className={stalled.late ? "late" : "stalled"}>{stalled.text}</span>]),
    ...marks(t, tasks, now),
    ...((t.waits_for ?? null) === null ? [] : [<span key="waits" className="waits-for">{View.task_waits_for_said(t)}</span>]),
  ];
  const cls = "task " + (mine ? "user" : "other " + t.assignee) + (t.talk === null ? "" : " talk-" + t.talk);
  const read = <><Detail t={t} /><Prs t={t} /></>;
  if (!mine) {
    const asked = t.talk === "unii";
    const why = "chase-why-" + t.id;
    const ordered = t.state === "open" && (t.order ?? null) !== null;
    return (
      <Article t={t} cls={cls} tasks={tasks} now={now} turn={turn} marks={ms}>
        {read}
        <div className="acts unii">
          {asked ? <span className="hint" id={why}>Você já cobrou e o Unii ainda não respondeu. “Cobrar agora” volta quando ele responder na conversa.</span> : null}
          <button className="chase" disabled={asked || undefined} aria-describedby={asked ? why : undefined} {...act_attr({ $: "TaskSay", task: t.id, text: View.CHASE })}>{asked ? "Cobrado: aguardando o Unii" : "Cobrar agora"}</button>
          {ordered ? <TaskButton t={t} state="dropped" text="Cancelar ordem" cls="drop cancel" /> : <TaskButton t={t} state="done" text="Pode fechar" cls="close" />}
        </div>
        <Thread t={t} />
      </Article>
    );
  }
  const rec = View.task_rec(t);
  const opt = (c: string, k: number) => {
    const on = View.rec_is(rec, c);
    return (
      <button key={c} className={"opt" + (on ? " rec" : "")} {...act_attr({ $: "Task", task: t.id, state: "done", answer: c })}>
        {c}
        {on && !View.rec_marked(c) ? <> <span className="rec-tag">recomendada</span></> : null}
        {View.act_unii(t, c) ? <> <span className="act-tag">{View.ACT_SAID}</span></> : null}
        {t.descriptions?.[k] ? <small>{t.descriptions[k]}</small> : null}
      </button>
    );
  };
  const orders = t.choices.some((c) => View.act_unii(t, c));
  return (
    <Article t={t} cls={cls} tasks={tasks} now={now} turn={turn} marks={ms}>
      {read}
      <section className="decide" aria-label="Decisão">
        <Fields t={t} />
        <input className="note" type="text" maxLength={1000} placeholder="Comentário (opcional)" aria-label={"Comentário sobre " + t.id} data-keep="note" />
        {t.choices.length === 0 ? null : <div className="opts" role="group" aria-label="Concluir como"><span className="lead">Concluir como:</span>{t.choices.map(opt)}</div>}
        <div className="acts">
          <span className="hint told">{orders ? `As opções marcadas “${View.ACT_SAID}” avisam o Unii na hora; as demais, em até 1 min.` : "O Unii é avisado sozinho em até 1 min."}</span>
          {View.task_accepts(t) ? <button className="accept" aria-keyshortcuts="a" title="Atalho: a" {...act_attr({ $: "TaskAccept", task: t.id })}>{View.task_accept_said(t)}</button> : null}
          <TaskButton t={t} state="done" text="Concluir" cls="done" />
          <TaskButton t={t} state="dropped" text="Descartar" cls="drop" />
        </div>
      </section>
      <Thread t={t} />
    </Article>
  );
}

// the pull requests a task points to: those verified each a card, then
// the other links by their "repo#n"
function Prs({ t }: { t: Task }): ReactNode {
  const verified = new Set((t.prs ?? []).map((p) => p.url));
  const prs = View.task_prs(t).filter((p) => !verified.has(p.url));
  return (
    <>
      {(t.prs ?? []).length === 0 ? null : <section className="checks" aria-label="Verificação">{t.prs.map((p) => <Check key={p.url} p={p} />)}</section>}
      {prs.length === 0 ? null : <p className="prs"><span className="lead">{prs.length === 1 ? "PR" : "PRs"}:</span> {joined(prs.map((p) => <a key={p.url} className="pr" href={p.url} target="_blank" rel="noopener noreferrer">{p.label}</a>), " ")}</p>}
    </>
  );
}

function Check({ p }: { p: NonNullable<Task["prs"]>[number] }): ReactNode {
  return (
    <div className={"check " + p.verdict}>
      <p className="check-head">
        <a className="pr" href={p.url} target="_blank" rel="noopener noreferrer">{View.pr_label(p.url)}</a> <span className="lead">head</span> <code className="head">{p.head.slice(0, 12)}</code>{" "}
        <span className="verdict">{p.verdict === "rejected" ? <Icon name="close" /> : p.verdict === "pending" ? null : <Icon name="check" />}{View.VERDICT_SAID[p.verdict]}{p.verifier === null ? "" : " por " + p.verifier}</span>{" "}
        <span className="count">{View.pr_notes_said(p)}</span>
      </p>
      {p.notes.length === 0 ? null : <ul className="notes">{p.notes.map((n, k) => <li key={k} className={"sev " + n.sev}><span className="sev-tag">{View.SEV_SAID[n.sev][0]}</span> {n.text}</li>)}</ul>}
      {p.untested.length === 0 ? null : <p className="untested"><span className="lead">Não testado:</span> {p.untested.join("; ")}</p>}
    </div>
  );
}

// a task closed lately: how, its evidence, detail, answers and thread to
// read, and Reabrir
function TaskClosed({ t, tasks, now }: { t: Task; tasks: Task[]; now: number }): ReactNode {
  const how = [...(t.told ? [] : ["o Unii será avisado em até 1 min"]), ...marks(t, [], now)];
  const all = t.evidence ?? [];
  return (
    <Article t={t} cls={"task closed" + (View.task_unproven(t) ? " unproven" : "")} tasks={tasks} now={now} turn={null} marks={how}>
      {all.length === 0
        ? <p className="evidence none"><span className="mark unproven">{View.UNPROVEN_SAID}</span> Fechada sem evidência registrada. Reabra-a se o problema não foi resolvido.</p>
        : <section className="evidence" aria-label="Evidência"><p className="sub">Evidência</p><ul>{all.map((e, k) => <li key={k}>{View.evidence_said(e)}</li>)}</ul></section>}
      <Detail t={t} /><Prs t={t} /><Answers t={t} />
      <div className="acts"><TaskButton t={t} state="open" text="Reabrir" cls="reopen" /></div>
      <ThreadRead t={t} />
    </Article>
  );
}

// a task waiting for others: what it waits for, each a link to it
function TaskWaiting({ t, tasks, now }: { t: Task; tasks: Task[]; now: number }): ReactNode {
  const frees = View.task_frees_named(tasks, t);
  return (
    <Article t={t} cls={"task waiting " + (t.assignee === "user" ? "user" : "other " + t.assignee)} tasks={tasks} now={now} turn={null} marks={frees === "" ? [] : [<span key="frees" className="frees">{frees}</span>]}>
      <p className="waits">Só pode ser resolvida depois de: {and_joined(Deps.waits(tasks, t).map((id) => <Goto key={id} tasks={tasks} id={id} />))}.</p>
      <Detail t={t} /><Prs t={t} /><ThreadRead t={t} />
    </Article>
  );
}

function Answers({ t }: { t: Task }): ReactNode {
  const fields = t.fields ?? [];
  const values = t.answers ?? {};
  if (t.state !== "done" || fields.length === 0) {
    return null;
  }
  const said = (f: Field) => {
    const v = Object.hasOwn(values, f.id) ? values[f.id] : undefined;
    return v === undefined || v.length === 0 ? "sem resposta" : Array.isArray(v) ? v.join(", ") : v;
  };
  return <dl className="answers">{fields.map((f) => <Fragment key={f.id}><dt>{f.label}</dt><dd>{said(f)}</dd></Fragment>)}</dl>;
}

// a task's fields, each a fieldset: a choice and yes or no as radios,
// many as checkboxes, a text as a textarea; its draft in it
function Fields({ t }: { t: Task }): ReactNode {
  const fields = t.fields ?? [];
  if (fields.length === 0) {
    return null;
  }
  const draft = t.draft ?? {};
  const one = (f: Field) => {
    const v = Object.hasOwn(draft, f.id) ? draft[f.id] : undefined;
    const name = "f-" + t.id + "-" + f.id;
    const legend = <legend>{f.label}{f.required ? <> <span className="req" title="Obrigatório">*</span></> : null}</legend>;
    const rec = View.field_rec(f);
    if (f.kind === "text") {
      return (
        <fieldset key={f.id} className="field" data-field={f.id} data-kind="text" data-required={f.required ? "true" : undefined}>
          {legend}
          {typeof rec === "string" ? <p className="rec-text"><span className="rec-tag">recomendado</span> {rec}</p> : null}
          <textarea rows={2} maxLength={1000} aria-label={f.label} data-keep={"f-" + f.id} defaultValue={typeof v === "string" ? v : ""}></textarea>
        </fieldset>
      );
    }
    const type = f.kind === "multi" ? "checkbox" : "radio";
    const on = (c: string) => (Array.isArray(v) ? v.includes(c) : v === c);
    return (
      <fieldset key={f.id} className="field" data-field={f.id} data-kind={f.kind} data-required={f.required ? "true" : undefined}>
        {legend}
        <div className="picks">{f.choices.map((c, k) => {
          const r = View.rec_is(rec, c);
          return (
            <label key={c} className={r ? "rec" : undefined}>
              <input type={type} name={name} value={c} defaultChecked={on(c)} /> {c}
              {r && !View.rec_marked(c) ? <> <span className="rec-tag">recomendada</span></> : null}
              {f.descriptions?.[k] ? <small>{f.descriptions[k]}</small> : null}
            </label>
          );
        })}</div>
      </fieldset>
    );
  };
  return <div className="fields">{fields.map(one)}</div>;
}

function ThreadMsg({ m }: { m: Task["thread"][number] }): ReactNode {
  return m.who === "unii"
    ? <li className="unii"><span className="who">Unii</span><div className="md"><Blocks blocks={Md.md_parse(m.text)} /></div></li>
    : <li className="user"><span className="who">Você</span><p>{m.text}</p></li>;
}

function ThreadRead({ t }: { t: Task }): ReactNode {
  const thread = t.thread ?? [];
  return thread.length === 0 ? null : <section className="thread read"><p className="sub">Conversa ({thread.length})</p><ol>{thread.map((m, k) => <ThreadMsg key={k} m={m} />)}</ol></section>;
}

// a task's thread: its messages, a box and Enviar (a TaskSay)
function Thread({ t }: { t: Task }): ReactNode {
  const thread = t.thread ?? [];
  return (
    <section className="thread">
      <p className="sub">{thread.length === 0 ? "Conversar sobre esta pendência" : "Conversa (" + thread.length + ")"}</p>
      {thread.length === 0 ? null : <ol>{thread.map((m, k) => <ThreadMsg key={k} m={m} />)}</ol>}
      <textarea className="say" rows={3} maxLength={4000} placeholder="Escreva sobre esta pendência (não a conclui)" aria-label={"Mensagem sobre " + t.id} data-keep="say"></textarea>
      <div className="acts"><span className="hint">Ctrl+Enter envia</span><button className="say-send" {...act_attr({ $: "TaskSay", task: t.id, text: "" })}>Enviar</button></div>
    </section>
  );
}

// The Mesa's two sides: the list's elements (each group's heading, then
// its rows; none, a note) and the detail's (← back, the task, Próxima)
export function desk_parts(tasks: Task[], q: string, ref: string, sel: string | null, now = Date.now(), opts: DeskOpts = {}): DeskParts {
  const groups = View.desk_list(tasks, q, ref, opts.cold === true ? now : null);
  const ids = groups.flatMap((g) => g.tasks.map((t) => t.id));
  const blocked = Deps.blocked_ids(tasks);
  const turn = opts.turn ?? null;
  const row = (t: Task, g: View.Desk) => {
    const frees = g === "closed" ? "" : View.task_frees_named(tasks, t);
    const late = View.task_late_said(t, blocked, now);
    const stalled = g === "others" ? View.task_stalled_said(t, blocked, now) : { text: "", late: false };
    const agent = g === "closed" ? "" : View.task_agent_said(t);
    const talk = g === "closed" ? "" : View.task_talk_wait_said(t, now, turn, blocked);
    const prs = g === "closed" ? [] : View.task_prs(t);
    const prio = g === "closed" ? "" : View.task_priority_said(t);
    const outside = g === "closed" ? "" : View.task_waits_for_said(t);
    const rejected = g === "closed" ? 0 : (t.prs ?? []).filter((p) => p.verdict === "rejected").length;
    const more: ReactNode[] = [
      ...(prio === "" ? [] : [<span className={"prio " + Deps.priority_of(t)}>{prio}</span>]),
      ...(late === "" ? [] : [<span className="late">{late}</span>]),
      ...(t.ref === null ? [] : [<span className="ref">{t.ref}</span>]),
      ...(prs.length === 0 ? [] : [<span className="pr"><Icon name="pr" />{prs.length === 1 ? "PR " + prs[0].label : prs.length + " PRs"}</span>]),
      ...(rejected === 0 ? [] : [<span className="late">{rejected === 1 ? "1 PR reprovado" : rejected + " PRs reprovados"}</span>]),
      ...(outside === "" ? [] : [<span className="waits-for">{outside}</span>]),
      ...(talk === "" ? [] : [<span className={"talk " + View.talk_cls(talk)}>{talk}</span>]),
      ...(t.assignee === "user" ? [] : [View.assignee_said(t)]),
      ...(agent === "" ? [] : [<span className={"agent" + (t.agent == null ? " none" : "")}>{agent}</span>]),
      ...(stalled.text === "" ? [] : [<span className={stalled.late ? "late" : "stalled"}>{stalled.text}</span>]),
      ...(frees === "" ? [] : [<span className="frees">{frees}</span>]),
      ...(g === "waiting" ? [View.task_waits_named(tasks, t)] : []),
      ...(g === "closed" ? [t.state === "done" ? "concluída" : "descartada"] : []),
      ...marks(t, tasks, now),
    ];
    const on = t.id === sel;
    return (
      <button key={t.id} className={"row " + g + (on ? " sel" : "")} role="option" aria-selected={on} data-desk={t.id}>
        <span className="head"><span className="id">{t.id}</span><span className="title">{t.title}</span></span>
        {more.length === 0 ? null : <span className="meta">{joined(more, " · ")}</span>}
      </button>
    );
  };
  const list: ReactElement[] = groups.flatMap((g) => [
    <p key={"g-" + g.group} className={"group " + g.group} role="presentation">{g.group === "now" ? <Icon name="open" /> : g.group === "closed" ? <Icon name="closed" /> : null}{g.label} <span className="n">({g.tasks.length})</span></p>,
    ...g.tasks.map((t) => row(t, g.group)),
  ]);
  const searched = q.trim() !== "" || ref !== "";
  const none = tasks.length === 0 ? "Nenhuma pendência. Quando o Unii precisar de você, ela aparece aqui." : searched && ids.length === 0 ? "Nenhuma pendência na busca." : "";
  const t = sel === null ? undefined : tasks.find((x) => x.id === sel);
  const after = t === undefined || View.desk_group(t, blocked) === "now" ? null : View.desk_next(tasks, t.id, q, ref, opts.order ?? []);
  const detail: ReactElement[] = t === undefined
    ? [<p key="empty" className="empty">{tasks.length === 0 ? <><Icon name="done" />Nenhuma pendência.</> : <>Escolha uma pendência na lista (<kbd>j</kbd> e <kbd>k</kbd> navegam).</>}</p>]
    : [
        <button key="back" className="back" type="button" data-desk-back="" aria-label="Voltar à lista">← Pendências</button>,
        t.state !== "open" ? <TaskClosed key={"t-" + t.id} t={t} tasks={tasks} now={now} />
          : blocked.has(t.id) ? <TaskWaiting key={"t-" + t.id} t={t} tasks={tasks} now={now} />
          : <TaskOpen key={"t-" + t.id} t={t} tasks={tasks} now={now} turn={turn} />,
        ...(after === null ? [] : [<button key="next" className="next" type="button" data-desk={after.id}>Próxima: <span className="id">{after.id}</span> {after.title} →</button>]),
      ];
  return { list: none === "" ? list : [...list, <p key="none" className="none">{tasks.length === 0 ? <Icon name="done" /> : <Icon name="search" />}{none}</p>], detail, ids };
}
