// The message box
// ===============
// Its field (Box.ts, a plain-text editable with files in it, kept behind a
// ref), and below it: attach (a liquid + that splits into its two picks),
// the pick (model, effort, speed), dictate, and send. The beam rides its
// border while Unii works (the one place it says so), faint while you
// type; dictating, the box becomes the voice: a ring that bends with it,
// the glow rising under the box. Send is liquid metal; with the box empty
// while Unii works, it stops the turn. A message waiting behind the turn:
// how many, the first one's words, and Enviar agora (the turn stops, the
// queue goes next)
import { BorderBeam } from "border-beam";
import { Liquid } from "liquid-gooey";
import { MetalFx } from "metal-fx";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { VoiceBeam } from "voice-glow";
import * as View from "../../View.ts";
import { Knobs } from "./Bars.tsx";
import * as Box from "./Box.ts";
import { Icon } from "./Icon.tsx";
import { NARROW, P, act, v } from "./state.ts";
import { VoiceRing } from "./vendor/voice-ring/index.ts";

export type ComposerHooks = {
  typed  : () => void;
  attach : (files: File[]) => void;
  submit : () => void;
  mic    : () => void;
  dark   : boolean;
};

export function Composer({ hooks }: { hooks: ComposerHooks }): ReactNode {
  const field = useRef<HTMLDivElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const images = useRef<HTMLInputElement>(null);
  const [plus, setPlus] = useState(false);
  const [focus, setFocus] = useState(false);
  useLayoutEffect(() => {
    const el = field.current!;
    Box.box_new(el, { input: hooks.typed, files: hooks.attach });
    el.dataset.placeholder = View.HINT;
  }, []);
  const on = View.view_typing(v);
  const rec = P.rec !== null;
  const stop = on && v.busy && Box.box_blank();
  const queued = View.view_queued(v);
  const first = (v.queue[View.TURN] ?? [])[0]?.text ?? "";
  const voicing = v.out.some((p) => p.msg.$ === "voice");
  const theme = hooks.dark ? "dark" : "light";
  // the attach buttons' size (style.css: 44px on a phone): the picks sit
  // on the + by one and two of it, and part from it by as much
  const step = NARROW.matches ? 44 : 40;
  const pick = (input: HTMLInputElement | null) => {
    setPlus(false);
    input?.click();
  };
  const taken = (ev: React.ChangeEvent<HTMLInputElement>) => {
    hooks.attach([...(ev.target.files ?? [])]);
    ev.target.value = "";
  };
  const box = (
    <form
      className={"composer" + (on ? "" : " off") + (rec ? " rec" : "")}
      hidden={!on}
      onSubmit={(ev) => {
        ev.preventDefault();
        hooks.submit();
      }}
      onFocus={() => setFocus(true)}
      onBlur={(ev) => !ev.currentTarget.contains(ev.relatedTarget as Node | null) && setFocus(false)}
    >
      {queued === 0 ? null : (
        <div className="queue" role="status">
          <span className="queued">{queued === 1 ? "1 na fila" : queued + " na fila"}{first === "" ? null : <> · <b>“{first}”</b></>}</span>
          <button className="force" type="button" title="Interrompe o turno do Unii; as mensagens na fila vão em seguida" onClick={() => act({ $: "Jump" })}>Enviar agora</button>
        </div>
      )}
      <div className="field" ref={field} role="textbox" aria-multiline="true" aria-label="Mensagem" spellCheck hidden={rec}></div>
      {rec ? (
        <div className="voice" role="status" aria-live="off">
          <VoiceRing stream={P.stream} size={72} theme={theme} state="listening" aria-hidden="true" />
          <span className="secs">{Math.floor(P.secs / 60) + ":" + String(P.secs % 60).padStart(2, "0")}</span>
          <span className="said">Ditando: toque em parar para escrever o que ouvi</span>
        </div>
      ) : null}
      <div className="bar">
        <div className={"plus" + (plus ? " open" : "")} onBlur={(ev) => !ev.currentTarget.contains(ev.relatedTarget as Node | null) && setPlus(false)} onKeyDown={(ev) => ev.key === "Escape" && plus && (ev.stopPropagation(), setPlus(false))}>
          <Liquid blur={7} contrast={20} filterPadding={140} fill={hooks.dark ? "#26262c" : "#e6e3db"}>
            <Liquid.Item x={plus ? step * 4 + 16 : step * 2} y={0} transition="bouncy">
              <button type="button" className="drop" tabIndex={plus ? 0 : -1} aria-hidden={!plus} aria-label="Anexar arquivos" title="Arquivos" onClick={() => pick(files.current)}><Icon name="read" /></button>
            </Liquid.Item>
            <Liquid.Item x={plus ? step * 2 + 8 : step} y={0} transition="bouncy" delay={40}>
              <button type="button" className="drop" tabIndex={plus ? 0 : -1} aria-hidden={!plus} aria-label="Anexar imagens" title="Imagens" onClick={() => pick(images.current)}><Icon name="image" /></button>
            </Liquid.Item>
            <Liquid.Item>
              <button type="button" className="attach" aria-expanded={plus} aria-label={plus ? "Fechar o anexo" : "Anexar"} title="Anexar" onClick={() => setPlus(!plus)}><Icon name={plus ? "close" : "plus"} /></button>
            </Liquid.Item>
          </Liquid>
        </div>
        <input ref={files} type="file" multiple hidden onChange={taken} />
        <input ref={images} type="file" accept="image/*,video/*" multiple hidden onChange={taken} />
        <div className="knobs" inert={plus || undefined}><Knobs knobs={View.view_pick(v)} /></div>
        <span className="grow"></span>
        <button className={"mic" + (rec ? " rec" : "")} type="button" aria-label={rec ? "Parar de ditar" : "Ditar"} title={rec ? "Parar" : "Ditar"} disabled={voicing} onClick={hooks.mic}>
          {rec ? <i className="sq" aria-hidden="true"></i> : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>}
        </button>
        <MetalFx variant="circle" preset="silver" theme={theme}>
          <button className={"send" + (stop ? " stop" : "")} type="submit" aria-label={stop ? "Parar o Unii" : "Enviar"}>
            {stop ? <i className="sq" aria-hidden="true"></i> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>}
          </button>
        </MetalFx>
      </div>
    </form>
  );
  // the wrappers stay put, voice or not, so the field (Box.ts's element)
  // is never made again
  return (
    <VoiceBeam type="pill" stream={P.stream} theme={theme} active={rec}>
      <BorderBeam size="md" theme={theme} colorVariant="colorful" active={!rec && (v.busy || focus)} strength={v.busy ? 1 : 0.35} duration={v.busy ? 2.2 : 4} borderRadius={22}>
        {box}
      </BorderBeam>
    </VoiceBeam>
  );
}
