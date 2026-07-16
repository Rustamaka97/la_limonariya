# Claude Code "прошивка" — созлаш ишлари (2026-07-16)

> Мақсад: Claude Code'ни Рустам ака машинасига тўлиқ мослаш — ҳар сессияда нолдан
> ўрганишни тугатиш, тезлаштириш, интеграциялаш. "Мени фулл қил" сессияси.

## Иккита конфиг жойи

| Жой | Нима | Git |
|---|---|---|
| **`la_limonariya`** (POS код) | CLAUDE.md, settings.json, .mcp.json, skills | канон репо |
| **`lalimonariya`** (hub, иш майдони) | CLAUDE.md, settings.local.json, statusline, camera skill | git эмас (локал) |

Рустам асосан **hub**дан Claude Code очади (camera-ai, asme-hero, clopos-src, docs шу ерда);
`la_limonariya` — POS проекти, `la_limonariya-sherxon` — канон.

---

## 1. CLAUDE.md — доимий "мия"

- **POS репо** (`CLAUDE.md`): лойиҳа тавсифи, 3 constraint (offline-first · un-fakeable
  ledger · multi-branch), пул/вақт қоидалари (UZS бутун, UTC сақла/UTC+5 кўрсат, иш-куни
  06:00→06:00), монорепо картаси, буйруқлар, миграция баги огоҳлантириши, Карпати услуби,
  канон-репо эҳтиёткорлиги.
- **hub**: барча лойиҳалар картаси (camera-ai, asme-hero, clopos, print-agent).

## 2. settings — permissions + hooks

- **POS** (`.claude/settings.json`, gitignored):
  - permissions.allow: 17 хавфсиз буйруқ (typecheck/build/db:generate/git read).
  - **auto-typecheck** hook: `.ts/.tsx` ёзилса `pnpm typecheck` фонда (asyncRewake) —
    блок қилмайди, хато чиқса огоҳлантиради. PowerShell (jq йўқ).
  - **Stop** hook: beep + "ишни тугатди" сигнали.
- **hub** (`.claude/settings.local.json`):
  - permissions.allow: +12 read-only MCP (playwright/computer-use/higgsfield/docker read).
  - **spinnerVerbs**: 12 ўзбекча ҳазил сўз ("Лимон сиқяпман", "Ошни думлаяпман"...).
  - **statusLine**: `🍋 папка · бранч · модель` (statusline.ps1).
  - **SessionStart** hook: старт саломи.

## 3. MCP интеграциялар (POS репо)

- **Postgres MCP** (`.mcp.json`, gitignored): `@modelcontextprotocol/server-postgres`
  read-only, `postgres://limon:***@localhost:5432/limonariya`. Порт учун
  `docker-compose.override.yml` (gitignored) — фақат локал дев, prod'га тегмайди.
- **GitHub**: `gh` CLI (auth) — MCP шарт эмас.
- **Telegram**: `.env`да токен кутиляпти (камера AI/POS хабарлари).

## 4. Махсус skill'лар

- **`/prod-tekshir`** (POS) — прод рискларини жонли текшириш: Директор PIN дефолтми,
  ходим PIN, принтер IP (NON CHOY), тех-карта уланиши, дубликат маҳсулот. Postgres MCP орқали.
- **`/kun`** (POS) — бугунги савдо ҳисоботи: тушум/топ таом/аномалия, иш-куни 06:00→06:00.
- **`/camera`** (hub) — камера-AI ҳолати: 4 хизмат, 19 камера, config, Telegram бот.

---

## Ишга тушириш (эга қиладиган)

1. `/fast` — тезлик режими.
2. Telegram токен — BotFather → `.env` (`ALERT_TELEGRAM_BOT_TOKEN`).
3. `pnpm up` + POS репони оч → Postgres MCP тирилади → `/kun`, `/prod-tekshir` жонли.

## Эслатма

Барча секрет/credential (PIN, токен, DB парол) — **эга ўзи** қўяди. Claude киритмайди.
`.mcp.json`, `docker-compose.override.yml`, `settings.json` — gitignored (канон репога кетмайди).
