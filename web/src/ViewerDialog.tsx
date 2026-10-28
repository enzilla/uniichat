// A picture seen whole, over the chat: Viewer.ts's engine (zoom, pan,
// pinch, swipe between pictures) on this dialog's elements
import { useLayoutEffect, type ReactNode } from "react";
import * as Viewer from "./Viewer.ts";

export function ViewerDialog(): ReactNode {
  useLayoutEffect(() => Viewer.viewer_new(), []);
  return (
    <dialog id="viewer" aria-label="Imagem">
      <div className="bar">
        <p className="name"></p><span className="zoom"></span>
        <a className="get" title="Baixar" aria-label="Baixar"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" /></svg></a>
        <button className="shut" type="button" title="Fechar" aria-label="Fechar" autoFocus><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
      </div>
      <div className="stage">
        <img alt="" draggable="false" />
        <p className="why" hidden>Não foi possível carregar esta imagem.</p>
        <button className="prev" type="button" aria-label="Imagem anterior" hidden><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg></button>
        <button className="next" type="button" aria-label="Próxima imagem" hidden><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></button>
      </div>
    </dialog>
  );
}
