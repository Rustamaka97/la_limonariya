// ВАҚТИНЧА тест — реал принтерга ЯКУНИЙ чек (a3a4aa0). CloPOS/база/тармоққа тегмайди.
// Ишлатиш: pnpm --filter api exec tsx _test-chek.ts   ·   тестдан кейин ЎЧИРИЛАДИ.
import { buildCheck, sendToPrinter, type CheckData } from "./src/printing/escpos";

const PRINTER_IP = "192.168.1.137"; // касса/чек принтери

const now = new Date();
const opened = new Date(now.getTime() - 64 * 60 * 1000);

const data: CheckData = {
  brandName: "La Limonariya",
  brandCity: "Навоий",
  brandPhone: "",
  checkNo: "1042",
  hall: "Асосий зал",
  tableNo: "12",
  waiter: "Абрам",
  createdAt: opened,
  closedAt: now,
  isComp: false,
  compReason: null,
  items: [
    { name: "Лимонад узимизники", price: 15000, qty: 2 },
    { name: "Кусковой (мол гушти)", price: 60000, qty: 1 },
    { name: "ФАРШ (Порция 3)", price: 69000, qty: 1 },
    { name: "Мороженое 50гр", price: 10000, qty: 1 },
  ],
  subtotal: 169000,
  service: 16900,
  servicePct: 10,
  total: 185900,
  payments: [{ method: "cash", amount: 185900 }],
};

const buf = buildCheck(data);
console.log(`[test] чек тайёр: ${buf.length} байт → ${PRINTER_IP}:9100`);
sendToPrinter(PRINTER_IP, buf)
  .then(() => console.log("[test] ✅ юборилди — принтердан қоғозни ол"))
  .catch((e) => {
    console.error("[test] ❌ хато:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
