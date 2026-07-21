import net from "node:net";
import { z } from "zod";
import { desc, eq, gte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { directorProcedure, protectedProcedure, router } from "./trpc";
import { clientIp } from "./rate-limit";
import { db } from "./db/client";
import { deviceHeartbeats, stations } from "./db/schema";
import { encodeCp866, sendToPrinter } from "./printing/escpos";

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

// Онлайн чегараси: heartbeat 30с интервалда → 90с кўрилмаса офлайн деймиз
// (2 та ўтказилган цикл + заҳира).
const ONLINE_MS = 90_000;
// Панелда фақат сўнгги 7 кун ичида кўринган қурилмалар (эски хлам йиғилмасин).
const KEEP_DAYS = 7;

export const systemRouter = router({
  // Барча станцияларни + принтер онлайн ҳолатини + қурилмаларни қайтаради.
  // Probe'лар параллел (Promise.all) → энг ёмон ҳолатда ~timeout (1.2с).
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

    const since = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000);
    const now = Date.now();
    const devRows = await db
      .select()
      .from(deviceHeartbeats)
      .where(gte(deviceHeartbeats.lastSeenAt, since))
      .orderBy(desc(deviceHeartbeats.lastSeenAt))
      .limit(50);
    const devices = devRows.map((d) => ({
      id: d.id,
      userName: d.userName,
      role: d.role,
      kind: d.kind,
      platform: d.platform,
      ip: d.ip,
      lastSeenAt: d.lastSeenAt,
      online: now - d.lastSeenAt.getTime() < ONLINE_MS,
    }));

    return { serverTime: new Date().toISOString(), printers, devices };
  }),

  // Клиент 30 сонияда битта юборади (логин бўлганда). Упсерт: қурилма id бўйича
  // охирги фойдаланувчи/вақт янгиланади. IP — сервер кўзи билан (алдаб бўлмайди).
  heartbeat: protectedProcedure
    .input(
      z.object({
        deviceId: z.string().min(8).max(64),
        kind: z.enum(["terminal", "pwa", "browser"]),
        platform: z.string().trim().max(80).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ip = clientIp(ctx.c);
      await db
        .insert(deviceHeartbeats)
        .values({
          id: input.deviceId,
          userId: ctx.user.id,
          userName: ctx.user.name,
          role: ctx.user.role,
          kind: input.kind,
          platform: input.platform ?? null,
          ip,
        })
        .onConflictDoUpdate({
          target: deviceHeartbeats.id,
          set: {
            userId: ctx.user.id,
            userName: ctx.user.name,
            role: ctx.user.role,
            kind: input.kind,
            platform: input.platform ?? null,
            ip,
            lastSeenAt: sql`now()`,
          },
        });
      return { ok: true };
    }),

  // Тест-чек — принтерни жойида текшириш (директор). Кичик CP866 ESC/POS чек:
  // init → матн → фид → кесиш. Хато бўлса фойдали хабар қайтади (timeout ва ҳ.к.).
  testPrint: directorProcedure
    .input(z.object({ stationId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const st = (
        await db
          .select({ name: stations.name, ip: stations.ip })
          .from(stations)
          .where(eq(stations.id, input.stationId))
          .limit(1)
      )[0];
      if (!st) throw new TRPCError({ code: "NOT_FOUND", message: "Станция топилмади" });
      if (!st.ip)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Станцияга IP созланмаган" });

      const now = new Date();
      const when = `${now.toLocaleDateString("ru-RU")} ${now.toLocaleTimeString("ru-RU")}`;
      const buf = Buffer.concat([
        Buffer.from([0x1b, 0x40]), // ESC @ init
        Buffer.from([0x1b, 0x61, 0x01]), // марказга
        Buffer.from([0x1d, 0x21, 0x11]), // 2x катта
        encodeCp866("LA LIMONARIYA\n"),
        Buffer.from([0x1d, 0x21, 0x00]), // одатий
        encodeCp866(`ТЕСТ-ЧЕК · ${st.name}\n`),
        encodeCp866(`${when}\n`),
        encodeCp866(`${st.ip}:9100 — алока ишлаяпти ✓\n`),
        encodeCp866(`Текширди: ${ctx.user.name}\n`),
        Buffer.from("\n\n\n\n"),
        Buffer.from([0x1d, 0x56, 0x42, 0x00]), // кесиш
      ]);
      try {
        await sendToPrinter(st.ip, buf);
        return { ok: true as const };
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Принтерга етиб бўлмади (${st.ip}): ${e instanceof Error ? e.message : "хато"}`,
        });
      }
    }),
});
