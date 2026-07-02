# La Limonariya

Ресторан бошқарув тизими (омбор · обвалка · таннарх · касса · молия · аналитика).
Спек: [`docs/SHERXON-SPEC.md`](docs/SHERXON-SPEC.md).

## Стек

- **web** — Vite + React 19 + TypeScript SPA, PWA, Tailwind v4 (`apps/web`)
- **api** — Hono + tRPC, Drizzle ORM (`apps/api`)
- **db** — PostgreSQL 17
- **deploy** — Docker Compose (caddy + api + postgres), OptiPlex `192.168.1.4`

## Ишга тушириш (Docker — тўлиқ изоляция)

Бутун стек контейнерларда: `caddy + api + postgres`. Project nomi `limonariya`,
postgres/api **host'га чиқарилмайди** (фақат ички тармоқ) — серверда бошқа нарсага тегмайди.

```bash
cp .env.example .env       # POSTGRES_PASSWORD, WEB_PORT
docker compose up -d --build
# → http://localhost:8080  (web) · /trpc, /api → ички api · postgres = ички, host'да йўқ
docker compose down        # to'xtatish (ma'lumot pgdata volume'da saqlanadi)
```

## Серверга (OptiPlex `192.168.1.4`)

```bash
# serverda, repo clone qilingach:
cp .env.example .env        # POSTGRES_PASSWORD=<kuchli>, agar 80 bo'sh bo'lsa WEB_PORT=80
docker compose up -d --build
# → http://192.168.1.4:8080  (yoki :80)
```
Изоляция: ўз Docker network + `pgdata` volume. Бошқа сервислар/портларга таъсир қилмайди.

**Backup:** `backup` сервиси ҳар куни `pg_dump` қилиб, `./backups/` папкага (хост
диски, Docker volume эмас) сақлайди, `BACKUP_KEEP_DAYS` (default 14) кундан
эскисини ўчиради. Тўлиқ ҳимоя учун `./backups/`ни вақти-вақти билан ташқи
диск/cloud'га кўчириб туринг (бу қадам ҳали Docker'дан ташқарида, қўлда).

**Restore (тик турганда тест қилиб кўринг, инцидентда эмас):**
```bash
docker compose run --rm --entrypoint /bin/sh backup /restore.sh limonariya_20260702_030000.sql.gz
# ёки энг сўнггисини қайтариш учун файл номисиз:
docker compose run --rm --entrypoint /bin/sh backup /restore.sh
```
Диққат: жорий базани dump ичидагиси билан алмаштиради (destructive).

## Локал dev (Docker'сиз)

```bash
pnpm install
# Postgres kerak (DATABASE_URL .env yoki muhitda)
pnpm db:generate           # schema → SQL migratsiya
pnpm db:migrate            # migratsiyalarni qo'llash
pnpm dev                   # web :5173 + api :3000 (parallel)
```

## Структура

```
apps/web    SPA (POS + офис)
apps/api    tRPC API + Drizzle schema/migrations
docker/     Dockerfile'lar
Caddyfile   статик SPA + reverse-proxy /trpc,/api
```
