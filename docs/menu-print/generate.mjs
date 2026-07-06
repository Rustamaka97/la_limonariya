// Print menu (A4 booklet) HTML generator.
// Reads apps/api/src/db/menu-seed.json, emits docs/menu-print/menu.html.
// Re-run after menu-seed.json changes: `node docs/menu-print/generate.mjs`
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const menuPath = join(__dirname, "..", "..", "apps", "api", "src", "db", "menu-seed.json");
const menu = JSON.parse(readFileSync(menuPath, "utf8"));

// Print-specific brand DNA (approved 2026-07-03, docs/MENYU-YANGILASH-HOLAT-2026-07-03.md) —
// distinct from the live-app brand.ts palette; this preserves the old print menu's look.
const COLORS = {
  green: "#12352A",
  cream: "#F6F1E3",
  gold: "#CDAA6D",
  goldDeep: "#B8934F",
  ink: "#241C14",
};

const CONTACT = {
  address: "Навоий, Боғишамол кўчаси 109",
  phones: ["+998 95 832-99-99", "+998 95 429-36-34"],
  hours: "09:00–23:00",
  instagram: "@la_limonariya",
  service: { standard: "10%", premium: "15%" },
};

const categories = menu.categories.filter((c) => c.show_in_menu);
const itemsByCategory = new Map(categories.map((c) => [c.key, []]));
for (const item of menu.items) {
  if (!item.show_in_menu) continue;
  if (!itemsByCategory.has(item.category)) continue;
  itemsByCategory.get(item.category).push(item);
}

function fmtPrice(uzs) {
  return uzs.toLocaleString("ru-RU").replace(/,/g, " ");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Weight-based pagination so one category's items don't overflow a single A4 sheet.
function paginate(items, maxWeight = 46) {
  const pages = [];
  let current = [];
  let weight = 0;
  for (const item of items) {
    const w = 1 + (item.desc_ru || item.desc_uz ? 1.3 : 0) + 0.25;
    if (current.length && weight + w > maxWeight) {
      pages.push(current);
      current = [];
      weight = 0;
    }
    current.push(item);
    weight += w;
  }
  if (current.length) pages.push(current);
  return pages;
}

function itemHtml(item) {
  const isSignature = Boolean(item.image);
  const star = isSignature ? `<span class="star">&#9733;</span>` : "";
  const desc = item.desc_ru
    ? `<div class="item-desc">${escapeHtml(item.desc_ru)}</div>`
    : "";
  return `
    <div class="item">
      <div class="item-row">
        <span class="item-name-ru">${escapeHtml(item.name_ru)}${star}</span>
        <span class="dots"></span>
        <span class="item-price">${fmtPrice(item.price_uzs)}</span>
      </div>
      <div class="item-name-uz">${escapeHtml(item.name_uz)}</div>
      ${desc}
    </div>`;
}

const pages = [];

// Front cover
pages.push(`
  <section class="page page-cover">
    <div class="cover-inner">
      <img class="cover-logo" src="assets/logo-cover.jpg" alt="La Limonariya" />
      <div class="cover-tagline">миллий таомлар &middot; шашлик &middot; лимонадлар</div>
      <div class="cover-tagline-ru">национальная кухня &middot; шашлык &middot; лимонады</div>
    </div>
  </section>`);

// Category divider + item pages
for (const cat of categories) {
  const items = itemsByCategory.get(cat.key) || [];
  if (!items.length) continue;

  pages.push(`
    <section class="page page-divider">
      <div class="divider-inner">
        <div class="divider-rule"></div>
        <div class="divider-name-ru">${escapeHtml(cat.name_ru)}</div>
        <div class="divider-name-uz">${escapeHtml(cat.name_uz)}</div>
        <div class="divider-rule"></div>
      </div>
    </section>`);

  const chunks = paginate(items);
  chunks.forEach((chunk, i) => {
    const continued = i > 0 ? ` <span class="continued">(давоми / продолжение)</span>` : "";
    pages.push(`
      <section class="page page-items">
        <header class="items-header">
          <span class="items-header-ru">${escapeHtml(cat.name_ru)}</span>
          <span class="items-header-sep">/</span>
          <span class="items-header-uz">${escapeHtml(cat.name_uz)}</span>${continued}
        </header>
        <div class="items-columns">
          ${chunk.map(itemHtml).join("\n")}
        </div>
      </section>`);
  });
}

// Back cover
pages.push(`
  <section class="page page-cover page-back">
    <div class="cover-inner">
      <div class="back-title">La Limonariya</div>
      <div class="back-rule"></div>
      <div class="back-line">${escapeHtml(CONTACT.address)}</div>
      <div class="back-line">${CONTACT.phones.join(" &middot; ")}</div>
      <div class="back-line">${CONTACT.hours}</div>
      <div class="back-line">${CONTACT.instagram}</div>
      <div class="back-rule"></div>
      <div class="back-service">Хизмат ҳақи ${CONTACT.service.standard} &middot; Premium zal ${CONTACT.service.premium}</div>
      <div class="back-service-ru">Сервисный сбор ${CONTACT.service.standard} &middot; Premium-зал ${CONTACT.service.premium}</div>
    </div>
  </section>`);

const html = `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8" />
<title>La Limonariya — меню</title>
<style>
  @page { size: A4; margin: 0; }
  :root {
    --green: ${COLORS.green};
    --cream: ${COLORS.cream};
    --gold: ${COLORS.gold};
    --gold-deep: ${COLORS.goldDeep};
    --ink: ${COLORS.ink};
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #999; }
  body { font-family: Georgia, "Times New Roman", serif; color: var(--ink); }

  .page {
    position: relative;
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto 6mm auto;
    padding: 20mm 18mm;
    background-color: var(--cream);
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    break-after: page;
    overflow: hidden;
  }
  @media print { .page { margin: 0; box-shadow: none; } }

  /* Cover / back cover / divider — dark green engraved bg */
  .page-cover, .page-divider {
    background-image: url("assets/bg-divider-green.png");
    color: var(--cream);
  }
  .page-items {
    background-image: url("assets/bg-inner-cream.png");
  }

  .cover-inner {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 6mm;
    padding: 20mm;
    text-align: center;
  }
  .cover-logo { width: 62mm; height: 62mm; object-fit: cover; border-radius: 50%; box-shadow: 0 0 0 2px var(--gold); }
  .cover-tagline, .cover-tagline-ru {
    font-size: 11pt; letter-spacing: 0.12em; text-transform: uppercase; color: var(--gold);
  }
  .cover-tagline-ru { color: var(--cream); opacity: 0.85; font-size: 10pt; }

  .page-back .back-title {
    font-size: 26pt; letter-spacing: 0.08em; color: var(--gold); margin-bottom: 4mm;
  }
  .back-rule { width: 40mm; height: 1px; background: var(--gold); margin: 5mm auto; opacity: 0.7; }
  .back-line { font-size: 12pt; margin: 2mm 0; color: var(--cream); }
  .back-service, .back-service-ru { font-size: 10pt; color: var(--gold); margin-top: 2mm; }
  .back-service-ru { color: var(--cream); opacity: 0.8; }

  .divider-inner {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 6mm; padding: 20mm; text-align: center;
  }
  .divider-rule { width: 26mm; height: 1px; background: var(--gold); opacity: 0.8; }
  .divider-name-ru {
    font-size: 30pt; letter-spacing: 0.06em; color: var(--gold); text-transform: uppercase;
  }
  .divider-name-uz {
    font-size: 15pt; font-style: italic; color: var(--cream); opacity: 0.85;
  }

  .items-header {
    text-align: center;
    font-size: 13pt; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--gold-deep);
    border-bottom: 1px solid var(--gold);
    padding-bottom: 3mm;
    margin-bottom: 6mm;
  }
  .items-header-uz { font-style: italic; font-weight: normal; opacity: 0.8; }
  .items-header-sep { margin: 0 2mm; opacity: 0.5; }
  .continued { font-size: 9pt; opacity: 0.6; font-style: italic; text-transform: none; letter-spacing: 0; }

  .items-columns {
    column-count: 2;
    column-gap: 10mm;
  }
  .item {
    break-inside: avoid;
    margin-bottom: 4.5mm;
  }
  .item-row {
    display: flex;
    align-items: baseline;
    gap: 1.5mm;
  }
  .item-name-ru {
    font-weight: 600;
    font-size: 10.5pt;
  }
  .star { color: var(--gold-deep); font-size: 7.5pt; margin-left: 1mm; }
  .dots {
    flex: 1;
    border-bottom: 1px dotted rgba(36,28,20,0.4);
    margin: 0 1.5mm;
    transform: translateY(-2.5px);
  }
  .item-price {
    font-weight: 600;
    font-size: 10.5pt;
    white-space: nowrap;
  }
  .item-name-uz {
    font-style: italic;
    font-size: 8.5pt;
    color: var(--gold-deep);
    margin-top: 0.3mm;
  }
  .item-desc {
    font-size: 8pt;
    font-style: italic;
    color: #5b5346;
    margin-top: 1mm;
    line-height: 1.3;
  }
</style>
</head>
<body>
${pages.join("\n")}
</body>
</html>
`;

writeFileSync(join(__dirname, "menu.html"), html, "utf8");
console.log(`menu.html generated — ${pages.length} pages`);
