import net from "node:net";
import { protectedProcedure, router } from "./trpc";
import { db } from "./db/client";
import { stations } from "./db/schema";

// POS «Статус» панели учун backend (CloPOS «Статус» ойнасининг эквиваленти).
// Принтер (станция) ҳолатини TCP-probe билан текширади — ЧОП ЭТМАЙДИ, фақат 9100
// портга уланиб кўради (handshake). online = принтер ёқилган ва тармоқда.
// ⚠️ Фақат зал-серверда (LAN) тўғри ишлайди; cloud (staging) 192.168.x.x'га
// етолмайди → доим offline. Бу — чоп этишнинг (sendToPrinter) ўша чекланиши.
function probePrinter(ip: string, timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(9100, ip, () => done(true));
  });
}

export const systemRouter = router({
  // Барча станцияларни + принтер онлайн ҳолатини қайтаради. Probe'лар параллел
  // (Promise.all) → энг ёмон ҳолатда ~timeout (1.2с), кетма-кет N×эмас.
  status: protectedProcedure.query(async () => {
    const rows = await db
      .select({ id: stations.id, name: stations.name, ip: stations.ip })
      .from(stations)
      .orderBy(stations.name);

    const printers = await Promise.all(
      rows.map(async (s) => ({
        id: s.id,
        name: s.name,
        ip: s.ip,
        online: s.ip ? await probePrinter(s.ip) : false,
      })),
    );

    return { serverTime: new Date().toISOString(), printers };
  }),
});
