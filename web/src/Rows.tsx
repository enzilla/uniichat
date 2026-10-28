// The chat's rows (View.view_body, View.view_tail): a message, a tool's
// or thought's one-line summary, an unfolded box of them, a caption.
// Html.ts's row_html, element for element
import { memo, type ReactNode } from "react";
import * as Call from "../../Call.ts";
import * as Theme from "../../Theme.ts";
import * as View from "../../View.ts";
import { act_attr } from "./Act.ts";
import { Blocks, Copy } from "./Blocks.tsx";
import { Icon, type IconName } from "./Icon.tsx";

const TALL = 4000;

// a tool's icon (Icons.ts); one not listed, the cog
const TOOL_ICON: Record<string, IconName> = {
  zoom: "search", date: "calendar", shell: "code", read: "read", write: "write", edit: "edit",
  spawn: "spawn", tell: "tell", computer: "computer", schedule: "bell", schedules: "bell", unschedule: "bell",
};

// a row whose object is unchanged keeps its element (View makes a new
// object only for a row that changed), so a line-md icon in it doesn't
// draw itself in again
export const Row = memo(function Row({ row }: { row: View.Row }): ReactNode {
  switch (row.$) {
    case "Sum": {
      const cls = row.mark === undefined ? "block" : "block " + row.mark;
      if (row.n === 0) {
        const live = row.mark === "live";
        return (
          <div className={cls} role={live ? "status" : undefined}>
            {live ? null : <span className="lv">{Theme.GLYPH.open}</span>}
            {live ? <div className="shimmer" data-text={row.text}>{row.text}</div> : <div>{row.text}</div>}
          </div>
        );
      }
      const lv = View.line_local(row.n) ? "1" : String(row.n);
      return (
        <div className={cls} {...act_attr({ $: "Open", id: row.id, n: row.n })} data-a={row.id}>
          <span className="lv">{lv}x</span>
          <div>{row.call === null ? row.text : <Head c={row.call} text={Call.call_line(row.call)} device="" />}</div>
        </div>
      );
    }
    case "Box": {
      return (
        <div className={"open" + (row.n === 1 ? " one" : "")} data-a={row.id}>
          <button className="fold" {...act_attr({ $: "Shut", id: row.id, n: row.n })}>{row.text}</button>
          {row.rows.map((r, k) => <Row key={rowkey(r, k)} row={r} />)}
        </div>
      );
    }
    case "Msg": {
      const text = row.call === null ? row.text : Call.call_text(row.call);
      const body = row.call === null ? <Blocks blocks={row.body} /> : <><Head c={row.call} text={row.call.head} device={row.call.device} /><Blocks blocks={row.call.blocks} /></>;
      const tall = ["user", "work"].includes(row.kind) && row.text.length + 80 * row.text.split("\n").length > TALL && !row.text.includes("](/media/");
      const media = row.body.some((b) => b.$ === "Para" && b.x.some((s) => s.$ === "Pict"));
      const cut = row.kind === "tool" || (row.kind === "echo" && !media);
      const fold = tall
        ? <><div className="clip">{body}</div><details className="more"><summary></summary></details></>
        : cut ? <><div className="cut">{body}</div><button className="unfold" aria-expanded="false">Show all</button></> : body;
      return (
        <div className={"msg " + row.kind + (row.queued === true ? " queued" : "")} data-a={row.id ?? undefined} data-who={row.who === "" ? undefined : row.who}>
          <Copy text={text} />{fold}<Pics names={row.images} />
        </div>
      );
    }
    case "Cap": {
      return <p className="cap">{row.text}</p>;
    }
  }
});

// a row's key: its id where it has one (body rows), else its place
export function rowkey(row: View.Row, k: number): string {
  return "id" in row && row.id !== null ? String(row.id) : "k" + k;
}

function Head({ c, text, device }: { c: Call.Call; text: string; device: string }): ReactNode {
  return (
    <p className="call">
      {device === "" ? null : <span className="on">· {device}</span>}
      <Icon name={TOOL_ICON[c.name] ?? "any"} />
      {c.name === "" ? null : <><b>{c.name}</b>{" "}</>}{text}
    </p>
  );
}

function Pics({ names }: { names: string[] }): ReactNode {
  if (names.length === 0) {
    return null;
  }
  return <div className="pics">{names.map((name) => <a key={name} href={"/image/" + name} target="_blank"><img src={"/image/" + name} alt={name} loading="lazy" /></a>)}</div>;
}
