// Термо-принтер интеграцияси: касса компьютеридаги print-agent'га
// (tools/print-agent, localhost:9110) юбориб кўради; агент йўқ/хато бўлса
// caller window.print() браузер диалогига қайтади. Line формати агент билан
// келишилган: {text|pair:[l,r], align, bold, big, hr}.

export type PrintLine = {
  text?: string;
  pair?: [string, string];
  align?: "left" | "center" | "right";
  bold?: boolean;
  big?: boolean;
  hr?: boolean;
};

const AGENT = "http://127.0.0.1:9110";

export async function printViaAgent(lines: PrintLine[]): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${AGENT}/print`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lines }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return false;
    const j = (await res.json()) as { ok?: boolean };
    return j.ok === true;
  } catch {
    return false;
  }
}
