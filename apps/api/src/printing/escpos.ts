import net from "node:net";
import { LOGO_RASTER, PHRASE_RASTERS } from "./assets";

// ── CP866 кодлаш (кирилл термал принтерлар учун стандарт) ──────────────────
// ASCII ўзгармайди. Кирилл А-Я/а-я/Ё диапазонлари CP866 харитасига. Ўзбек
// кирилл (Ў Қ Ғ Ҳ ...) CP866'да йўқ → энг яқин рус ҳарфига fallback (менюда
// ўқилиши учун, "?" эмас).
const UZ_FALLBACK: Record<string, string> = {
  Ў: "У", ў: "у", Қ: "К", қ: "к", Ғ: "Г", ғ: "г", Ҳ: "Х", ҳ: "х",
  Ё: "Е", ё: "е", // (Ё CP866'да бор, лекин рус Е'га ҳам мос)
};

function cp866Byte(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c < 0x80) return c; // ASCII
  if (c >= 0x0410 && c <= 0x041f) return 0x80 + (c - 0x0410); // А..П
  if (c >= 0x0420 && c <= 0x042f) return 0x90 + (c - 0x0420); // Р..Я
  if (c >= 0x0430 && c <= 0x043f) return 0xa0 + (c - 0x0430); // а..п
  if (c >= 0x0440 && c <= 0x044f) return 0xe0 + (c - 0x0440); // р..я
  if (c === 0x0401) return 0xf0; // Ё
  if (c === 0x0451) return 0xf1; // ё
  return 0x3f; // "?"
}

export function encodeCp866(text: string): Buffer {
  const out: number[] = [];
  for (const ch of text) {
    const mapped = UZ_FALLBACK[ch] ?? ch;
    for (const m of mapped) out.push(cp866Byte(m));
  }
  return Buffer.from(out);
}

// ── ESC/POS команда байтлари ──────────────────────────────────────────────
const ESC = {
  // ESC @ (reset) + ESC t 17 (CP866 код-саҳифани танлаш). Иккинчисисиз принтер
  // ўз default саҳифасини ишлатиб кирилчани крякозябра қилади (зал принтерларида
  // n=17 тасдиқланган — реал тест-чек, 2026-07-22).
  init: Buffer.from([0x1b, 0x40, 0x1b, 0x74, 0x11]),
  boldOn: Buffer.from([0x1b, 0x45, 0x01]),
  boldOff: Buffer.from([0x1b, 0x45, 0x00]),
  alignL: Buffer.from([0x1b, 0x61, 0x00]),
  alignC: Buffer.from([0x1b, 0x61, 0x01]),
  dblOn: Buffer.from([0x1d, 0x21, 0x11]), // қўш баланд+кенг
  dblOff: Buffer.from([0x1d, 0x21, 0x00]),
  feedCut: Buffer.from([0x1b, 0x64, 0x03, 0x1d, 0x56, 0x42, 0x00]), // 3 қатор + qisman kesish
  kick: Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]), // касса қутиси
};

const WIDTH = 48;
const nl = Buffer.from([0x0a]);

function txt(s: string): Buffer {
  return encodeCp866(s);
}

// Икки устун қатор: чапга ном, ўнгга сон/нарх, орасини space билан тўлдириш.
function twoCol(left: string, right: string): Buffer {
  const space = Math.max(1, WIDTH - left.length - right.length);
  return Buffer.concat([txt(left + " ".repeat(space) + right), nl]);
}

function hr(): Buffer {
  return Buffer.concat([txt("-".repeat(WIDTH)), nl]);
}

const pad = (n: number) => String(n).padStart(2, "0");
function hhmm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const RU_MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
function ruDateTime(d: Date): string {
  return `${d.getDate()} ${RU_MONTHS[d.getMonth()]} ${d.getFullYear()} г., ${hhmm(d)}`;
}
// CloPOS каби: вергул-минг + .00 (itemRow ва мижоз чеки суммалари).
const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// CloPOS каби 4 устунли таом жадвали (48 кенг): Наименование | К-во | Цена | Сумма.
// Рақам устунлари жами 29 белги (5+11+13), ном 19. Узун ном алоҳида қаторга
// тушади, кейин рақамлар — кесилмайди, устун бузилмайди.
const COLW = 5 + 11 + 13;
const ITEM_HEAD = Buffer.concat([
  txt(
    "Наименование".padEnd(WIDTH - COLW) +
      "К-во".padStart(5) +
      "Цена".padStart(11) +
      "Сумма".padStart(13),
  ),
  nl,
]);
function itemRow(name: string, qty: number, price: number): Buffer {
  const cols =
    String(qty).padStart(5) + money(price).padStart(11) + money(price * qty).padStart(13);
  if (name.length <= WIDTH - COLW) {
    return Buffer.concat([ESC.boldOn, txt(name.padEnd(WIDTH - COLW)), ESC.boldOff, txt(cols), nl]);
  }
  return Buffer.concat([ESC.boldOn, txt(name), ESC.boldOff, nl, txt(" ".repeat(WIDTH - COLW) + cols), nl]);
}

// ── Кухня тикети (битта станция) ──────────────────────────────────────────
export type KitchenMeta = {
  hall: string | null;
  tableNo: string | null;
  createdAt: Date;
  station: string;
  saleType?: string | null;
};
const SALE_TYPE_TICKET: Record<string, string> = { delivery: "ДОСТАВКА", takeaway: "СОБОЙ (олиб кетиш)" };
export function buildKitchenTicket(
  meta: KitchenMeta,
  items: { name: string; qty: number; note?: string | null }[],
): Buffer {
  const parts: Buffer[] = [
    ESC.init,
    ESC.alignC,
    ESC.boldOn,
    ESC.dblOn,
    txt(meta.station.toUpperCase()), nl,
  ];
  // Собой/доставка — ошпаз ўраш кераклигини ДАРҲОЛ кўрсин (катта ҳарф, стол остида эмас).
  const stLabel = meta.saleType ? SALE_TYPE_TICKET[meta.saleType] : undefined;
  if (stLabel) parts.push(txt("* " + stLabel + " *"), nl);
  parts.push(
    ESC.dblOff,
    ESC.boldOff,
    ESC.alignL,
    hr(),
    twoCol("Зал", meta.hall ?? "—"),
  );
  if (meta.tableNo) parts.push(twoCol("Стол", meta.tableNo));
  parts.push(twoCol("Вақт", hhmm(meta.createdAt)), hr());
  for (const it of items) {
    parts.push(ESC.boldOn, twoCol(it.name, `x${it.qty}`), ESC.boldOff);
    // Официант изоҳи — ошпаз кўриши шарт («пиёзсиз», «соус алоҳида»...)
    if (it.note) parts.push(txt("  >> " + it.note), nl);
  }
  parts.push(ESC.feedCut);
  return Buffer.concat(parts);
}

// ── Мижоз чеки ─────────────────────────────────────────────────────────────
export type CheckData = {
  brandName: string;
  brandCity: string;
  brandPhone: string;
  checkNo: string;
  hall: string | null;
  tableNo: string | null;
  waiter: string | null;
  createdAt: Date;
  closedAt?: Date;
  isComp: boolean;
  compReason: string | null;
  items: { name: string; price: number; qty: number }[];
  subtotal: number;
  service: number;
  servicePct: number;
  discount?: number;
  total: number;
  payments: { method: string; amount: number }[];
};
const PAY_LABEL: Record<string, string> = {
  cash: "Наличными", card: "Карта", click: "Click", payme: "Payme", humo: "Humo", debt: "Долг",
  balance: "Баланс", avans: "Аванс (бронь)",
};
export function buildCheck(o: CheckData): Buffer {
  const dhOn = Buffer.from([0x1d, 0x21, 0x01]); // 2× баланд (кенгликка тегмайди)
  const dhOff = Buffer.from([0x1d, 0x21, 0x00]);
  // Лого — Palatino расм (assets.ts'да муҳрланган; сервер шрифт чизмайди).
  const parts: Buffer[] = [ESC.init, LOGO_RASTER, nl, ESC.alignL];
  if (o.isComp)
    parts.push(ESC.alignC, txt(o.compReason ? `БЕСПЛАТНО: ${o.compReason}` : "БЕСПЛАТНО (гость)"), nl, ESC.alignL);
  // Мета — 2× баланд (Официант жирный, эга сўрови бўйича).
  parts.push(ESC.boldOn, txt(`Официант: ${o.waiter ?? "—"}`), nl, ESC.boldOff);
  parts.push(ESC.boldOn, txt(`Стол: ${o.hall ?? "—"}${o.tableNo ? ` / ${o.tableNo}` : ""}`), nl, ESC.boldOff);
  parts.push(txt(`Заказ: ${o.checkNo}`), nl);
  parts.push(txt(`Открыт: ${ruDateTime(o.createdAt)}`), nl);
  if (o.closedAt) parts.push(txt(`Закрыт: ${ruDateTime(o.closedAt)}`), nl);
  parts.push(hr(), ITEM_HEAD);
  for (const it of o.items) parts.push(itemRow(it.name, it.qty, it.price));
  parts.push(
    hr(),
    twoCol("Промежуточный итог", `${money(o.subtotal)}uzs`),
    twoCol(`Плата за обслуживание (${o.servicePct}%)`, `${money(o.service)}uzs`),
  );
  if (o.discount && o.discount > 0) parts.push(twoCol("Скидка", `-${money(o.discount)}uzs`));
  // ИТОГО — 2× баланд + жирный (энг муҳим рақам).
  parts.push(ESC.boldOn, dhOn, twoCol("ИТОГО", `${money(o.total)}uzs`), dhOff, ESC.boldOff);
  parts.push(txt("Способ оплаты"), nl);
  for (const p of o.payments)
    parts.push(ESC.boldOn, twoCol("  " + (PAY_LABEL[p.method] ?? p.method), `${money(p.amount)}uzs`), ESC.boldOff);
  // Пер-гость бўлиш: чек 2..6 кишига тенг бўлса, ҳар бирига қанча.
  if (o.total > 0 && !o.isComp) {
    parts.push(hr(), txt("На каждого (поровну):"), nl);
    for (let n = 2; n <= 6; n++) {
      parts.push(twoCol(`  ${n} человек`, `${money(Math.round(o.total / n))}uzs`));
    }
  }
  parts.push(hr());
  // Пастки фраза — 4 тадан тасодифий (Palatino расм, story учун).
  const phrase = PHRASE_RASTERS[Math.floor(Math.random() * PHRASE_RASTERS.length)];
  if (phrase) parts.push(phrase);
  parts.push(ESC.feedCut, ESC.kick);
  return Buffer.concat(parts);
}

// ── Тармоққа юбориш (RAW TCP 9100) ─────────────────────────────────────────
export function sendToPrinter(ip: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const done = (err?: Error) => {
      socket.destroy();
      err ? reject(err) : resolve();
    };
    socket.setTimeout(3000);
    socket.once("timeout", () => done(new Error("printer timeout")));
    socket.once("error", done);
    socket.connect(9100, ip, () => {
      socket.write(data, () => socket.end(() => done()));
    });
  });
}

// ── Fire-and-forget оркестрация (заказ ёпилишини блокламайди) ──────────────
// Кухня тикетини станция бўйича гуруҳлаб, ҳар станция IP'сига ЎЗ тикетини.
export function printKitchenTicket(
  meta: Omit<KitchenMeta, "station">,
  items: { name: string; qty: number; note?: string | null; station: string }[],
  stationIp: Map<string, string | null>,
): void {
  const byStation = new Map<string, { name: string; qty: number; note?: string | null }[]>();
  for (const it of items) {
    const key = it.station || "Бошқа";
    const arr = byStation.get(key) ?? [];
    arr.push({ name: it.name, qty: it.qty, note: it.note });
    byStation.set(key, arr);
  }
  for (const [station, list] of byStation) {
    const ip = stationIp.get(station);
    if (!ip) continue; // принтери йўқ станция — ўтказилади
    const buf = buildKitchenTicket({ ...meta, station }, list);
    sendToPrinter(ip, buf).catch((e) =>
      console.error(`[print] kitchen station=${station} ip=${ip}:`, e instanceof Error ? e.message : e),
    );
  }
}

export function printCheck(order: CheckData, barIp: string | null): void {
  if (!barIp) return;
  sendToPrinter(barIp, buildCheck(order)).catch((e) =>
    console.error(`[print] check ip=${barIp}:`, e instanceof Error ? e.message : e),
  );
}

// ── Пречек (тўлов олдидан ҳисоб танишув, ҳали очиқ стол) ──────────────────
export function buildPrecheck(o: Omit<CheckData, "payments" | "isComp" | "compReason">): Buffer {
  const dhOn = Buffer.from([0x1d, 0x21, 0x01]); // 2× баланд (кенгликка тегмайди)
  const dhOff = Buffer.from([0x1d, 0x21, 0x00]);
  // Лого — чек билан бир хил (Palatino расм).
  const parts: Buffer[] = [ESC.init, LOGO_RASTER, nl, ESC.alignL];
  // ПРЕЧЕК банери — мижоз буни тўланган чек деб адашмасин.
  parts.push(ESC.alignC, ESC.boldOn, txt("*** ПРЕЧЕК ***"), nl, ESC.boldOff);
  parts.push(txt("Предварительный счёт — не оплата"), nl, ESC.alignL);
  // Мета — чек билан бир хил (Официант/Стол жирный).
  parts.push(ESC.boldOn, txt(`Официант: ${o.waiter ?? "—"}`), nl, ESC.boldOff);
  parts.push(ESC.boldOn, txt(`Стол: ${o.hall ?? "—"}${o.tableNo ? ` / ${o.tableNo}` : ""}`), nl, ESC.boldOff);
  parts.push(txt(`Заказ: ${o.checkNo}`), nl);
  parts.push(txt(`Открыт: ${ruDateTime(o.createdAt)}`), nl);
  parts.push(hr(), ITEM_HEAD);
  for (const it of o.items) parts.push(itemRow(it.name, it.qty, it.price));
  parts.push(
    hr(),
    twoCol("Промежуточный итог", `${money(o.subtotal)}uzs`),
    twoCol(`Плата за обслуживание (${o.servicePct}%)`, `${money(o.service)}uzs`),
  );
  if (o.discount && o.discount > 0) parts.push(twoCol("Скидка", `-${money(o.discount)}uzs`));
  // ИТОГО — 2× баланд + жирный (чек билан бир хил, энг муҳим рақам).
  parts.push(ESC.boldOn, dhOn, twoCol("ИТОГО", `${money(o.total)}uzs`), dhOff, ESC.boldOff);
  // Пер-гость бўлиш — тўловдан олдин ким қанча тўлашини кўрсин.
  if (o.total > 0) {
    parts.push(hr(), txt("На каждого (поровну):"), nl);
    for (let n = 2; n <= 6; n++) {
      parts.push(twoCol(`  ${n} человек`, `${money(Math.round(o.total / n))}uzs`));
    }
  }
  parts.push(
    hr(),
    ESC.alignC,
    ESC.boldOn,
    txt("*** ПРЕЧЕК — не оплата ***"), nl,
    ESC.boldOff,
    ESC.alignL,
    ESC.feedCut, // kick ЙЎҚ — пречек кассани очмайди
  );
  return Buffer.concat(parts);
}

export function printPrecheck(order: Omit<CheckData, "payments" | "isComp" | "compReason">, barIp: string | null): void {
  if (!barIp) return;
  sendToPrinter(barIp, buildPrecheck(order)).catch((e) =>
    console.error(`[print] precheck ip=${barIp}:`, e instanceof Error ? e.message : e),
  );
}
