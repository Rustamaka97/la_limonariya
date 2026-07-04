import { useEffect, useRef, useState } from "react";

const reduceMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useCountUp(target: number, duration = 400): number {
  const [value, setValue] = useState(target);
  // Ҳар tick'да янгиланадиган "жорий кўринган қиймат" — фақат анимация
  // тугаганда эмас (акс ҳолда target анимация ЎРТАСИДА яна ўзгарса, янги
  // анимация эски бошланиш нуқтасидан орқага сакраб бошланади).
  const valueRef = useRef(target);

  useEffect(() => {
    if (reduceMotion()) {
      valueRef.current = target;
      setValue(target);
      return;
    }
    const from = valueRef.current;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(from + (target - from) * eased);
      valueRef.current = current;
      setValue(current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}
