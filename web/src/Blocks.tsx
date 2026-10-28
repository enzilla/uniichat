// Markdown (Md.ts) as elements: a message's blocks, a task's detail, a
// thread's message. The same markup Html.ts wrote as strings, class for
// class, so style.css and the tests read it the same
import { Fragment, type CSSProperties, type ReactNode } from "react";
import * as Md from "../../Md.ts";
import * as View from "../../View.ts";
import { Icon } from "./Icon.tsx";
import { act_attr } from "./Act.ts";

const MARKS: Record<Md.Line["s"], string> = { " ": "", "-": "del", "+": "add" };

// the copy button's two faces (main.tsx copied swaps them)
export const SHEETS = `<svg viewBox="0 0 16 16" width="15" height="15"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.5v-.2A1.8 1.8 0 0 0 8.7 1.5H4.3A1.8 1.8 0 0 0 2.5 3.3v4.4a1.8 1.8 0 0 0 1.8 1.8h.2"/></svg>`;
export const CHECK  = `<svg viewBox="0 0 16 16" width="15" height="15"><path d="M3 8.5l3.2 3L13 4.5"/></svg>`;

export function Copy({ text }: { text: string }): ReactNode {
  return <button className="copy" data-copy={text} title="Copy" dangerouslySetInnerHTML={{ __html: SHEETS }} />;
}

export function Blocks({ blocks }: { blocks: Md.Block[] }): ReactNode {
  return blocks.map((b, k) => <Block key={k} b={b} />);
}

function Block({ b }: { b: Md.Block }): ReactNode {
  switch (b.$) {
    case "Para": {
      return <p><Spans spans={b.x} /></p>;
    }
    case "Head": {
      const Tag = ("h" + Math.min(4, b.k + 1)) as "h1" | "h2" | "h3" | "h4";
      return <Tag><Spans spans={b.x} /></Tag>;
    }
    case "Code": {
      return <pre><Copy text={b.x} />{b.k === "" ? null : <span className="lang">{b.k}</span>}<code>{b.x}</code></pre>;
    }
    case "Rule": {
      return <hr />;
    }
    case "Quot": {
      return <blockquote><Blocks blocks={b.x} /></blockquote>;
    }
    case "List": {
      const Tag = b.k ? "ol" : "ul";
      const box = (c: boolean | null) => (c === null ? null : <><input type="checkbox" disabled defaultChecked={c} />{" "}</>);
      return (
        <Tag start={b.k && b.n !== 1 ? b.n : undefined}>
          {b.x.map((item, k) => (
            <li key={k} className={b.c[k] == null ? undefined : "task"}>{box(b.c[k] ?? null)}<Item blocks={item} tight={b.t} /></li>
          ))}
        </Tag>
      );
    }
    case "Tabl": {
      return (
        <table><tbody>
          {b.x.map((row, i) => (
            <tr key={i}>{row.map((cell, c) => {
              const style = b.a[c] ? { textAlign: b.a[c] as "left" | "right" | "center" } : undefined;
              return i === 0 ? <th key={c} style={style}><Spans spans={cell} /></th> : <td key={c} style={style}><Spans spans={cell} /></td>;
            })}</tr>
          ))}
        </tbody></table>
      );
    }
    case "Diff": {
      return <Diff file={b.k} hunks={b.x} />;
    }
    case "File": {
      return <File shown={b.k} from={b.n} lines={b.x} />;
    }
  }
}

function Item({ blocks, tight }: { blocks: Md.Block[]; tight: boolean }): ReactNode {
  return blocks.map((b, k) => (tight && b.$ === "Para" ? <Spans key={k} spans={b.x} /> : <Block key={k} b={b} />));
}

function Diff({ file, hunks }: { file: string; hunks: Md.Line[][] }): ReactNode {
  const all  = hunks.flat();
  const nw   = all.reduce((w, l) => Math.max(w, String(l.n).length), 0);
  const adds = all.filter((l) => l.s === "+").length;
  const dels = all.filter((l) => l.s === "-").length;
  const line = (l: Md.Line, k: number) => <span key={k} className={MARKS[l.s] || undefined}><i>{l.n}</i>{l.s} {l.x}</span>;
  return (
    <pre className="diff" style={{ "--nw": nw + "ch" } as CSSProperties}>
      <span className="lang">{file} <b className="add">+{adds}</b> <b className="del">-{dels}</b></span>
      <code>{hunks.map((h, k) => <Fragment key={k}>{k > 0 ? <span className="gap">⋯</span> : null}{h.map(line)}</Fragment>)}</code>
    </pre>
  );
}

function File({ shown, from, lines }: { shown: string; from: number; lines: string[] }): ReactNode {
  const nw = String(from + lines.length - 1).length;
  return (
    <pre className="diff" style={{ "--nw": nw + "ch" } as CSSProperties}>
      <span className="lang">{shown}</span>
      <code>{lines.map((x, k) => <span key={k} className="file"><i>{from + k}</i>{x}</span>)}</code>
    </pre>
  );
}

function Chip({ url, name }: { url: string; name: string }): ReactNode {
  const shown = name.trim() || (url.split("/").pop() ?? "");
  return <a className="file" href={url} download={shown} title={"Download " + shown}><Icon name="read" /><span className="fname">{shown}</span><small data-of={url}></small></a>;
}

function Spans({ spans }: { spans: Md.Span[] }): ReactNode {
  return spans.map((s, k) => <Span key={k} s={s} />);
}

// the product's name, in its own face, wherever a text says it
function Text({ x }: { x: string }): ReactNode {
  const parts = x.split("UniiChat");
  return parts.map((p, k) => (k === 0 ? p : <Fragment key={k}><span className="brand">UniiChat</span>{p}</Fragment>));
}

function Span({ s }: { s: Md.Span }): ReactNode {
  switch (s.$) {
    case "Text": {
      return <Text x={s.x} />;
    }
    case "Code": {
      return <code>{s.x}</code>;
    }
    case "Bold": {
      return <strong><Spans spans={s.x} /></strong>;
    }
    case "Ital": {
      return <em><Spans spans={s.x} /></em>;
    }
    case "Strk": {
      return <del><Spans spans={s.x} /></del>;
    }
    case "Link": {
      if (View.store_file(s.k)) {
        return <Chip url={s.k} name={Md.spans_text(s.x)} />;
      }
      return <a href={s.k} title={s.t === "" ? undefined : s.t} target="_blank" rel="noopener"><Spans spans={s.x} /></a>;
    }
    case "Pict": {
      const title = s.t === "" ? undefined : s.t;
      const kind = View.media_kind(s.k);
      return kind === "image" ? <a className="media" href={s.k} target="_blank"><img src={s.k} alt={s.x} title={title} loading="lazy" /></a>
        : kind === "video" ? <video className="media" src={s.k} title={title} controls preload="metadata"></video>
        : kind === "audio" ? <audio className="media" src={s.k} title={title} controls preload="metadata"></audio>
        : kind === "html" ? <iframe className="media page" src={s.k} title={s.t || s.x} sandbox="allow-same-origin allow-popups" loading="lazy"></iframe>
        : View.store_file(s.k) ? <Chip url={s.k} name={s.x} />
        : <a href={s.k} title={title} target="_blank" rel="noopener">{s.x || s.k}</a>;
    }
    case "Brk": {
      return <br />;
    }
    case "Name": {
      const label = View.agent_label(s.x);
      return <button className="name" title={s.x} {...act_attr({ $: "Goto", name: s.x })}>[{label === undefined ? s.x : <>{label} <small>{s.x}</small></>}]</button>;
    }
  }
}
