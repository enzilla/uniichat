// a line-md icon (Icons.ts): its SVG put in once, as it comes, so it draws
// itself in then and not again on each render; under reduced motion it
// jumps to its end (motion_end)
import { memo, useLayoutEffect, useRef } from "react";
import { ICON } from "./Icons.ts";

export type IconName = keyof typeof ICON;

const STILL = typeof matchMedia === "undefined" ? null : matchMedia("(prefers-reduced-motion: reduce)");

export const Icon = memo(function Icon({ name }: { name: IconName }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const svg = ref.current?.querySelector("svg");
    if (svg && STILL?.matches) {
      svg.setCurrentTime(60);
      svg.pauseAnimations();
    }
  }, [name]);
  return <span ref={ref} className="icw" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON[name] }} />;
});
