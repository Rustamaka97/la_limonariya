# 🔍 PLAN ↔ KOD GAP-AUDIT — тўлиқ ҳисобот

**Сана:** 2026-07-02 · **Усул:** 17 та мустақил AI-агент (8 домен-аудитор + 8 скептик-верификатор + 1 тўлиқлик-критиги), 549 tool-чақириқ. Ҳар «йўқ/қисман» деган хулоса алоҳида скептик-агент томонидан кодда қайта текширилган — **биронтаси рад этилмади** (113/115 хулоса тасдиқланди).

**Натижа:** 179 талаб текширилди — ✅ 64 тайёр · 🟡 60 қисман · ❌ 55 йўқ. Критик яна 21 та қамралмаган пунктни топди.

> **Кейинги сессия учун (Sonnet 5):** бу файл — план ҳужжатлари (docs/QURISH-REJASI-1bosqich.md, docs/LIMONARIYA-SPEC-TOLIQ.md, PLAN.md, docs/teshiklar-nazorat.md, docs/qolgan-savollar-toliq.md) билан кодни солиштириш натижаси. Ҳар пунктда файл:қатор далил бор — ишни шу жойдан бошла. Код: `apps/api/src/router.ts` (асосий tRPC роутер), `apps/api/src/db/schema.ts` (Drizzle схема), `apps/web/src/Pos.tsx` (POS UI), `apps/web/src/Shell.tsx` (таблар). Dev: `pnpm dev` (API :3001 + web :5173, Postgres host :5433). Текшириш: `pnpm -r exec tsc --noEmit`. Далиллардаги қатор рақамлари 2026-07-02 ҳолатига — код ўзгарган бўлса grep билан қайта топ.

---

## 🎯 ТЕЗКОР ХАРИТА — нимадан бошлаш

| № | Иш пакети | Нима киради | Ҳажм |
|---|---|---|---|
| 1 | **Касса ҳимояси (патч)** | `pos.close` тўлов валидацияси (сумма=жами) · таом ўчириш → директор PIN + журнал | кичик, 1 кун |
| 2 | **Касса назорати пакети** | X/Z смена · возврат оқими · заказ бекор қилиш (йўқотиш ёзуви) · очиқ стол сигнали · инкассация | ўрта |
| 3 | **Milestone 3: Сих/Витрина** | хом→маринад→витрина 3 босқич · сих грамм назорати (энг катта миқдорий оқма: +30г ≈ 22–28 млн/ой) | катта |
| 4 | **Offline-first** | Dexie + sync queue (свет ўчса POS ишлайди) | катта |
| 5 | **Инфра** | pgBackRest бэкап · PIN brute-force ҳимояси · ESC/POS авто-чоп 5 станция | ўрта |
| 6 | **Маълумот** | ~19 ингредиент нархи · тарихий обвалка импорти · WAC/FIFO қарори | Рустам акадан |

---

## 🔴 БАРЧА ОЧИҚ КАМЧИЛИКЛАР приоритет бўйича

### P0 — пул йўқотиш/ўғирлик хавфи ёки асосий оқим ишламайди (15 та)

- 🟡 **[pos-zal]** ⛔ Чек тўлов турисиз ёпилмайди; сумма = чек жами бўлмагунча «Ёпиш» ўчиқ (МАЖБУРИЙ)
- 🟡 **[pos-zal]** №9 «Тикетсиз таом ЙЎҚ» — кухня фақат тизим тикети билан пиширади (энг катта тешик)
- ❌ **[pos-zal]** №11 Ўчирилган таом → директор рухсати + журнал; №22 заказ audit log (ким нима ўзгартирди/такрорлади)
- 🟡 **[moliya-kassa]** ⛔ Чек тўлов турисиз ёпилмайди; сумма = чек жами бўлмагунча «Ёпиш» ўчиқ (мажбурийлик)
- 🟡 **[analitika-moat]** P&L ажратиш: бозорлик→COGS (сотилгандагина) · иш ҳақи/коммунал→OPEX · эга олди→тақсимот → реал соф фойда
- ❌ **[analitika-moat]** «Ҳисобланган сих ↔ қўлда киритилган сих» солиштируви — сих грамм назорати (10кг÷грамм=кутилган сон, фарқ катта бўлса 🚩)
- 🟡 **[hisobot-telegram]** СМЕНА (X/Z ҳисобот): очиш — кассир PIN + бошланғич нақд (50к); ёпиш — нақд саноқ → Z-ҳисобот (нақд/карта/клик/хумо/қарз алоҳида · чиқим · нечта чек · ўртача чек · камомад) → директор тасдиқ; X-ҳисобот оралиқ кўриш; топшириш — смена ёпиб-янгисини очиш
- ❌ **[xodim-antitheft]** PIN кучли — Clopos'даги 1111/0000 каби заиф ТАКРОРЛАМАЙМИЗ (brute-force ҳимояси билан)
- 🟡 **[xodim-antitheft]** Тешик №9 (энг катта): тикетсиз таом ЙЎҚ — кухня/кўрача фақат тизим тикети билан пиширади (МАЖБУРИЙ)
- ❌ **[xodim-antitheft]** Тешик №11: Ўчирилган таом (чопдан кейин) → директор рухсати/PIN + ўзгармас журнал
- 🟡 **[xodim-antitheft]** 🔒 МАЖБУРИЙ: чек тўлов турисиз ёпилмайди (ёпиш = кассир иши)
- ❌ **[infra-offline]** Offline-first асос: локал кэш + синхрон механизми — интернет/свет ўчса POS ишлайди, официант заказ олади, улангач синхрон
- ❌ **[infra-offline]** Backup стратегияси: pgBackRest шифрланган кунлик full (03:00) + соатлик incr + WAL, backup-now.sh/restore.sh, deploy.sh healthcheck-fail'да rollback
- 🟡 **[infra-offline]** PIN хэшланган, КУЧЛИ (Clopos'даги 1111/0000 такрорланмайди) + рухсатсиз кириб бўлмайди
- 🟡 **[katalog-texkarta]** Рецепт ↔ каталог маҳсулот боғланиши (шусиз таннарх нархсиз, авто-списание ишламайди): «Taom sotilsa retsept bo'yicha mahsulot o'zi chiqim bo'ladi»

### P1 — план 1-босқичда ваъда қилинган (56 та)

- ❌ **[pos-zal]** СМЕНА X/Z ҳисобот: очиш (PIN+размен 50к) → X оралиқ → Z ёпиш (тур бўйича сотув, камомад) → топшириш
- ❌ **[pos-zal]** №13 Возврат = кассир+директор рухсати + журнал + возврат тренди
- ❌ **[pos-zal]** Бекор қилинган буюртма → омборга тегмайди; №6 пишган-лекин-бекор = йўқотиш сифатида ёзилади
- ❌ **[pos-zal]** №14 Очиқ стол / тўламай кетиш сигнали (узоқ ёпилмаган стол → огоҳ)
- 🟡 **[pos-zal]** Кўп-тўлов (multi-tender): бир неча тур аралаш (мас. 200к нақд + 100к қарз)
- 🟡 **[pos-zal]** Қарз танланса → мижоз бириктириш МАЖБУРИЙ (ism+telefon, running-баланс, SMS, рейтинг)
- ❌ **[pos-zal]** Offline-first: интернет/свет ўчса официант заказ бера олади, улангач синхрон
- 🟡 **[pos-zal]** Атрибуция: официант + кассир алоҳида (ким очди, ким ёпди)
- 🟡 **[pos-zal]** Кухня тикети станция бўйича (мангал/ошхона/салат/балиқ/бар) — 5 принтерга алоҳида чоп
- 🟡 **[ombor-obvalka]** Мариновка ўсиши (+13–30%) + йўқотиш % таннархда ҳисобга олинади
- 🟡 **[ombor-obvalka]** Ҳаракат турлари: Харид · Обвалка · Ишлаб чиқариш · Списание(сотув) · Инвентаризация тузатиш · Йўқотиш/бузилди · Локация кўчириш
- 🟡 **[ombor-obvalka]** Обвалка қисмлари омборга кирим (вағора/шапок/думба... ҳар қисм алоҳида)
- 🟡 **[ombor-obvalka]** 2 та омбор (Ошхона музлаткич / Катта музлаткич) — ҳар бирининг ЎЗ қолдиғи, ораларида кўчириш ҳаракат сифатида ёзилади
- ❌ **[ombor-obvalka]** Мажбурийлик: кун ЁПИЛМАЙДИ инвентаризациясиз (ҳар куни эрталаб мажбурий саноқ)
- 🟡 **[ombor-obvalka]** Бир амал икки ёзув: бозорчи харид → касса − ВА омбор + (программа ўзи)
- 🟡 **[ombor-obvalka]** Етказувчи (поставщик) қарзи: тўлов нақд/қарз, қарз ledger + қисман тўлаш
- 🟡 **[ombor-obvalka]** Туша нархини ошириб ёзиш назорати — нарх аномалияси (тарихдан медиана)
- ❌ **[ombor-obvalka]** Харид ↔ обвалка солиштируви (бозорчи 35кг олди, обвалкага 33кг келди → 🚩 кам келтириш)
- ❌ **[ombor-obvalka]** Списание брак/бузилди/йўқотиш ҳужжати (маҳсулот бузилса ҳисобдан чиқариш)
- ❌ **[ombor-obvalka]** Ишлаб чиқариш ҳужжати: партия тайёрланганда хом-ашё омбордан чиқади, ярим-тайёр кирим бўлади (алоҳида қолдиқ)
- 🟡 **[ombor-obvalka]** Омбор светофори 🟢🟡🔴 (нима тугаяпти — авто, тарихдан)
- ❌ **[moliya-kassa]** Қарз танланса мижоз бириктириш МАЖБУРИЙ; қарз дафтарида мижоз исми + телефон
- ❌ **[moliya-kassa]** Харид киритишда тўлов тури танланади: нақд ёки қарз (етказувчига)
- 🟡 **[moliya-kassa]** Кунлик касса журнали (Excel Вариант C): кун боши қолдиқ = авто (кечаги охирги + размен 50к) → КИРИМ авто (POS тур бўйича + қарз тўлови) → ЧИҚИМ категория → кун охири авто
- 🟡 **[moliya-kassa]** СМЕНА X/Z: очиш (кассир PIN + размен 50к), Z-ҳисобот (нақд/карта/клик/хумо/қарз алоҳида · чиқим · чек сони · ўртача чек · камомад) → директор тасдиқ; X-оралиқ; смена топшириш
- ❌ **[moliya-kassa]** Кассадан чиқим 3 тур: харид (пул ҳаракати) / харажат (P&L) / 👑 эга олди (тақсимот, фойдадан ТАШҚАРИ)
- 🟡 **[moliya-kassa]** Бир амал — икки ёзув: бозорчи харид → касса − ВА омбор + (программа ўзи)
- ❌ **[moliya-kassa]** Возврат (пул қайтариш): фақат кассир+директор рухсати + ўзгармас журнал + возврат тренди
- 🟡 **[moliya-kassa]** Чекни (тўловни) фақат КАССИР ёпади — роль назорати
- 🟡 **[analitika-moat]** Норма тарихдан ўрганилади — динамик (обвалка тарихидан ҳар қисм учун normal chiqim, sliding median)
- 🟡 **[analitika-moat]** Реал 1 кг гўшт таннархи — «охирги обвалкалардан ўртача»
- 🟡 **[analitika-moat]** Ҳар таомнинг реал таннархи (техкарта + гўшт нархи) — жонли
- ❌ **[analitika-moat]** Бозорчи кам келтириш → харид↔обвалка солиштируви 🚩 + барча харидга нарх аномалияси
- 🟡 **[analitika-moat]** Директор панели: кунлик 4 рақам — 💵Тушум · 📈Соф фойда · 🧾Қарз · 🏆Топ таом
- 🟡 **[analitika-moat]** Тешиклар движок (23 та) — барча 🚩 сигнал битта рўйхатда, директор эрталаб очади
- 🟡 **[hisobot-telegram]** Отчёты: Период → приход-расход, потери %, себестоимость, графики (davr bo'yicha hisobotlar to'plami)
- 🟡 **[hisobot-telegram]** Быстрые отчёты: за день, за месяц, по какому продукту убыток
- 🟡 **[hisobot-telegram]** A9 Директорга авто ҳисобот: кун охири push (тушум / фойда / тешик / штраф)
- 🟡 **[hisobot-telegram]** Тешиклар движок: критик 🔴 тешик → директорга ДАРРОВ push
- ❌ **[hisobot-telegram]** Ежедневная таблица (привычный вид «как Excel»): выбрал дату → приход / продажа / остаток по каждому продукту
- 🟡 **[xodim-antitheft]** Таннарх/фойда фақат директор кўради (кассир/официант кўрмайди)
- ❌ **[xodim-antitheft]** Тешик №13: Сохта возврат — возврат = кассир+директор + журнал + возврат тренди
- 🟡 **[xodim-antitheft]** Тешик №20: «Текин/ходим» категорияси (сабаб мажбурий) + ҳажм назорати — кунлик лимит/тренд, ошса 🚩
- 🟡 **[xodim-antitheft]** Барча муҳим ҳаракат audit log — «ким нима қилгани ёзилади» (тешик №22 дубликат/қайта чоп ҳам)
- ❌ **[xodim-antitheft]** Вазифа назорати + штраф модули: 3 тур (дедлайн/даврий/воқеа-триггер), чек-лист, жонли камера расм + timestamp, зинапоясимон штраф (30к/50к/100к, ой бошида нолланади), админ тасдиғи, ходим штраф/интизом журнали
- ❌ **[xodim-antitheft]** Бекор қилинган буюртма → омборга тегмайди + йўқотиш сифатида ёзилади, директор кўради (тешик №6); таом ўзгартириш чопдан кейин → директор рухсати
- 🟡 **[infra-offline]** Принтерлар: заказ қоғозда станция бўйича чоп (мангал·ошхона·салат·балиқ·нон-чой + касса, 5+1 принтер), ESC/POS, авто-чоп
- 🟡 **[infra-offline]** Secrets бошқаруви: .env репога кирмайди, Clopos harvest (токен/PII) commit қилинмайди, production'да кучли pepper/parol
- 🟡 **[infra-offline]** Барча муҳим ҳаракат audit log (ким нима ўзгартирди — заказ ўзгариши, ўчириш, дубликат чоп №22)
- 🟡 **[katalog-texkarta]** Рецепт импорт: texkarta.json → «Состав» (ингредиент + грамм + stock_hint), 26 иссиқ + 12 салат + Фарш
- 🟡 **[katalog-texkarta]** Техкарта муҳаррири: таомга ингредиент + грамм киритиш (директор), recipeUpsert
- 🟡 **[katalog-texkarta]** Ҳар таомнинг реал таннархи (техкарта + гўшт нархи) жонли + «юпқа маржали таомлар» огоҳи
- 🟡 **[katalog-texkarta]** Харид киритилса → ингредиент нархи янгиланади ва таннарх шундан тўғрилашади
- ❌ **[katalog-texkarta]** ~19 асосий ингредиент нархи (гуруч, гўшт, пиёз, масло, зира...) — киритилиши керак
- 🟡 **[katalog-texkarta]** Таннарх фақат директорга кўринади (кассир/официант сотув таннархини кўрмайди)
- ❌ **[katalog-texkarta]** SEMI/ярим-тайёр маҳсулотлар рецепт билан + ишлаб чиқариш (Фарш ad-hoc истисно, Шапок→Фарш полуфабрикат)

### P2 — муҳим, лекин кейинроқ мумкин (36 та)

- 🟡 **[pos-zal]** Чек рақами ГИБРИД: ички кетма-кет ID + кўрсатиладиган кунлик рақам («Стол 5, #042»)
- ❌ **[pos-zal]** Тўлов турлари СОЗЛАНАДИГАН жадвал (эга ўзи қўшади; Хумо алоҳида; «бўлиш мумкин»/«мижоз мажбурий» флаглар)
- ❌ **[pos-zal]** №12 Чегирма — фақат директор рухсати + журнал
- ❌ **[pos-zal]** Ичимлик сотиш = маркировка СКАН мажбурий (DataMatrix), қўлда қўшиш БЛОК
- ❌ **[pos-zal]** Стол кўчириш / бирлаштириш (заказни бошқа столга ўтказиш)
- ❌ **[ombor-obvalka]** Нормы самообучаемые: ҳар тасдиқланган обвалка выборкага қўшилиб медиана/полосалар қайта ҳисобланади (n ўсади → полоса торайади)
- 🟡 **[ombor-obvalka]** Манфий қолдиқ фақат сабаб + директор тасдиғи билан ўтади
- ❌ **[ombor-obvalka]** Таннарх усули: WAC (ўртача) ёки FIFO — партия нархлари бўйича баҳолаш
- ❌ **[ombor-obvalka]** Бозорчи: GPS + вақт АВТО, расм ихтиёрий (харид киритганда)
- ❌ **[ombor-obvalka]** Бозорчи қолган назоратлари: авто харид рўйхати (омбордан) · кунлик бюджет лимити · қассоб рейтинги
- 🟡 **[ombor-obvalka]** Обвалка вазнини МЕНЕЖЕР ёзади (рол чекловi)
- 🟡 **[ombor-obvalka]** Ичимлик/спиртли омбори — шиша саноғи (Кола −10,432 тешиги)
- ❌ **[ombor-obvalka]** Посуда/жиҳоз инвентаризацияси (~2180 дона): рўйхат + топшириқ-қабул + синган/йўқолган назорати
- 🟡 **[moliya-kassa]** Кўп-тўлов (multi-tender): бир чекда бир неча тур аралаш (мас. 200к нақд + 100к қарз)
- ❌ **[moliya-kassa]** Тўлов турлари СОЗЛАНАДИГАН жадвал: эга ўзи тур қўшади (Хумо/Payme...), ҳар турга ҳисоб/«бўлиш мумкин»/«мижоз мажбурий» флаглари
- ❌ **[moliya-kassa]** Excel'дан бошланғич қарздорлар импорти
- 🟡 **[moliya-kassa]** Камомад оқими: кассир санайди → директор ТАСДИҚлайди (икки босқич)
- 🟡 **[moliya-kassa]** 💵 Кунлик иш ҳақи — АЛОҲИДА экран: ходимни белгила → сумма (салатчи/повар/шашликчи ҳар куни)
- 🟡 **[moliya-kassa]** Инкассация: кун ичи кассадан пул олиш = изоҳ билан ёзиладиган ҳаракат
- 🟡 **[analitika-moat]** Мариновка ўсиши (+13–30%) + йўқотиш % ҳисоби
- ❌ **[analitika-moat]** Бозорчи кунлик бюджет лимити огоҳи
- ❌ **[analitika-moat]** Критик тешик → директорга дарров push (Telegram bot: 🔴 огоҳ + кечки хулоса)
- 🟡 **[analitika-moat]** Омбор светофори 🟢🟡🔴 (авто, тарихдан) — остаток директор панелида доим кўриниб
- 🟡 **[analitika-moat]** Пул vs Ҳақиқий фойда (касса + қарз + омбор қиймати)
- ❌ **[analitika-moat]** Қассоб/етказувчи таққослаш ва рейтинги (суяк % ва чиқим бўйича)
- ❌ **[hisobot-telegram]** Telegram bot: критик тешик + кун охири ҳисобот → Telegram (egaga signal)
- ❌ **[hisobot-telegram]** Отчёты: ... выгрузка (hisobotni Excel/PDF eksport qilish)
- ❌ **[hisobot-telegram]** Сменада нақд олиш изсиз (инкассация): кун ичи кассадан пул олиш = ёзиладиган ҳаракат (изоҳ билан) — smena hisobotida ko'rinishi kerak
- ❌ **[xodim-antitheft]** Тешик №12: Чегирма фақат директор рухсати + журнал
- 🟡 **[xodim-antitheft]** Кунлик иш ҳақи — алоҳида экран: ходим белгила → сумма (салатчи/повар/шашликчи ҳар куни тўланади)
- ❌ **[infra-offline]** HTTPS security headers (HSTS, CSP, COOP) Caddy snippets орқали
- ❌ **[infra-offline]** Партия этикеткаси чоп: тур + сана/муддат + партия ID + ким тайёрлади + QR (FIFO ва муддат назоратининг физик уланиши)
- ❌ **[infra-offline]** Критик 🔴 тешик → директорга дарров push (Telegram bot: огоҳлантириш + кечки хулоса)
- ❌ **[katalog-texkarta]** Мариновка ўсиши (+13–30%: кусковой мол +13%, қўй +15%, Вағури +30%) таннарх ҳисобига киради
- ❌ **[katalog-texkarta]** Товуқ гўшти таннархи 1-босқичда ҳисобланади (Цезар 60г товуқ, Гурман 50г товуқ...)
- 🟡 **[katalog-texkarta]** Рецептни Рецептлар табдан таҳрирлаш (✎)

### P3 — nice-to-have (8 та)

- ❌ **[ombor-obvalka]** Электрон тарози интеграцияси — вазн дастурга автоматик тушади
- 🟡 **[moliya-kassa]** Ҳар қарз: 🧾 чек + 💬 изоҳ + 📲 SMS эслатма + 🚦 рейтинг (🟢🟡🔴)
- 🟡 **[moliya-kassa]** Сигнал пороглари скользящая медиана асосида (хардкод эмас)
- ❌ **[moliya-kassa]** Кун охири нақд пул → сейфга ўтказиш ёзуви
- ❌ **[moliya-kassa]** Банкет: аванс (олдиндан тўлов) ихтиёрий ёзилади ва ҳисобдан айирилади
- ❌ **[analitika-moat]** Башорат + АҚЛ даражаси: таом фойда таҳлили (⭐юлдуз/🐴от/❓жумбоқ/🐕ит), «директор мияси» AI брифинг, what-if симулятор
- ❌ **[xodim-antitheft]** Официант KPI/мотивация (танланган O2 тез заказ, O5 мижоз баҳоси, O7 кунлик ўз якуни, O9 заказ аниқлиги, O10 кеч келиш)
- ❌ **[katalog-texkarta]** QR/AR e-menu (la-limonariya.uz, AR QR электрон меню ғояси)

---

## 📂 ДОМЕНЛАР БЎЙИЧА ТЎЛИҚ ТАФСИЛОТ

Ҳар пункт: статус · приоритет · талаб · манба (қайси план ҳужжати) · далил (файл:қатор) · скептик-верификатор хулосаси.

## 💳 POS / Зал / Сотув

_25 талаб: ✅ 8 · 🟡 7 · ❌ 10_

### ❌ [P0] №11 Ўчирилган таом → директор рухсати + журнал; №22 заказ audit log (ким нима ўзгартирди/такрорлади)

- **Манба:** teshiklar-nazorat.md №11, №22 + SPEC §5.3 «таом ўзгартириш → директор рухсати»
- **Далил:** pos.addItem delta<0 бўлса қаторни жимгина DELETE қилади (apps/api/src/router.ts:1644-1652) — рухсат ҳам, журнал ҳам йўқ; ҳар қандай официант кухняга юборилган таомни чекдан олиб ташлай олади (пишган, лекин ҳисобдан йўқ). Тикет ledger далил сақлайди, лекин ҳеч қаерда солиштирилмайди/кўрсатилмайди.
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — apps/api/src/router.ts:1644-1652 — addItem protectedProcedure, delta билан qty<=0 бўлса `tx.delete(orderItems)` жимгина; рол текшируви йўқ (comp'дан фарқли, :1760-1762). grep 'audit|journal|журнал|action_log|event_log' = 0 domain-ҳит; schema.ts'даги барча pgTable рўйхатида (13-445) audit/log жадвали йўқ. Тикет ledger далил сақлайди (kitchenTicketItems), лекин ҳеч қаерда orderItems билан солиштирилмайди.

### ❌ [P1] СМЕНА X/Z ҳисобот: очиш (PIN+размен 50к) → X оралиқ → Z ёпиш (тур бўйича сотув, камомад) → топшириш

- **Манба:** LIMONARIYA-SPEC-TOLIQ §8.8 + pos-qurish-savollar №3
- **Далил:** Shift жадвали/endpoint йўқ (grep 'shift|smena' — фақат изоҳлар). Бор нарса: кунлик tillCount (apps/api/src/router.ts:2285-...) ва TILL_FLOAT=50k константа (232) — булар кун ёпилиши, X/Z смена эмас. RUSTAM-AKA hujjati ҳам буни «кейинги» деб тан олади.
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — grep 'shift|smena|смена' apps/**/src = фақат изоҳлар (router.ts:232 `TILL_FLOAT = 50_000 // start-of-shift float`, :489) ва UI shiftDay() date-helper (Moliya.tsx:31, Hisobot.tsx:11 — сана суриш, смена эмас). Бор нарса: tillCount get/set (router.ts:2285-2344) — кунлик директор санаши, dayKey бўйича, очиш/ёпиш/X/Z йўқ. Schema'да shift жадвали йўқ.

### ❌ [P1] №13 Возврат = кассир+директор рухсати + журнал + возврат тренди

- **Манба:** teshiklar-nazorat.md №13 + PLAN-uz «Kassa nazorati»
- **Далил:** grep 'vozvrat|возврат|refund' — кодда умуман йўқ. Ёпилган чекни қайтариш/тузатиш йўли йўқ (orders status фақат open|closed, apps/api/src/db/schema.ts:182).
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — grep 'refund|vozvrat|возврат|qaytar|қайтар' apps/api/src apps/web/src = 0 ҳит. orderStatus pgEnum фақат ['open','closed'] (apps/api/src/db/schema.ts:182). Ёпилган чекни қайтариш/сторно endpoint'и умуман йўқ.

### ❌ [P1] Бекор қилинган буюртма → омборга тегмайди; №6 пишган-лекин-бекор = йўқотиш сифатида ёзилади

- **Манба:** LIMONARIYA-SPEC-TOLIQ §5.3 + teshiklar-nazorat №6
- **Далил:** Очиқ заказни бекор қилиш endpoint’и йўқ — фақат итемларни 0 га тушириш мумкин (router.ts:1646-1647), бўш очиқ заказ абадий осилиб қолади ёки 0 сўм чек ёпилади. Кухняга юборилган-кейин-бекор таом «йўқотиш» (loss movement) сифатида ҳеч ёзилмайди.
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — grep 'cancel|bekor|void|annul' = фақат UI modal «Бекор» тугмалари (Shell/Catalog), order-cancel endpoint йўқ. Итемни фақат 0 га тушириш мумкин (router.ts:1646-1647). movementType enum'да 'loss' қиймати БОР (schema.ts:312), лекин grep '"loss"' router.ts+web = 0 — ҳеч қаерда ёзилмайди; пишган-бекор таом йўқотиш сифатида қайд этилмайди.

### ❌ [P1] №14 Очиқ стол / тўламай кетиш сигнали (узоқ ёпилмаган стол → огоҳ)

- **Манба:** teshiklar-nazorat.md №14
- **Далил:** computeSignals (apps/api/src/router.ts:409-594) обвалка/нарх/камомад/текин сигналларини қамрайди, лекин eskirgan очиқ order сигнали йўқ. UI да фақат minsAgo кўрсаткич (Pos.tsx:83-87, 289-292) — сигнал/огоҳ эмас.
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — computeSignals (apps/api/src/router.ts:409-594) return қилади: obvalkaFlags, thinDishes, cashVariance, breakEvenFlag, priceSpikes, shortagePattern, compFlag — eskirgan очиқ order сигнали йўқ. UI'да фақат пассив minsAgo кўрсаткич (apps/web/src/Pos.tsx:83-87 функция, :289-292 стол картасида) — threshold/огоҳлантириш йўқ.

### ❌ [P1] Offline-first: интернет/свет ўчса официант заказ бера олади, улангач синхрон

- **Манба:** QURISH-REJASI M0/M4 + SPEC §2
- **Далил:** VitePWA фақат app-shell precache (apps/web/vite.config.ts:10-31); Dexie/offline queue йўқ (grep dexie — 0 натижа), ҳар tRPC чақириқ тармоқни талаб қилади. remaining-work-roadmap ҳам буни P0-P1 қолдиқ деб белгилаган.
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — apps/web/vite.config.ts:10-31 — VitePWA фақат manifest+autoUpdate (app-shell precache), runtime caching/queue конфиг йўқ. grep 'dexie|offline|indexeddb|localforage' apps/web/src = 0. apps/web/src/trpc.ts — оддий httpBatchLink, ҳар мутация тармоқ талаб қилади.

### ❌ [P2] Тўлов турлари СОЗЛАНАДИГАН жадвал (эга ўзи қўшади; Хумо алоҳида; «бўлиш мумкин»/«мижоз мажбурий» флаглар)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §5.3 тўлов турлари жадвали
- **Далил:** paymentMethod — қотирилган enum: cash/card/click/payme/debt (apps/api/src/db/schema.ts:259-265); Хумо йўқ, созлаш UI/жадвали йўқ, флаглар йўқ.
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — paymentMethod — қотирилган pgEnum ['cash','card','click','payme','debt'] (apps/api/src/db/schema.ts:259-265); grep 'humo|хумо|xumo' = 0; schema pgTable рўйхатида payment-settings жадвали йўқ; UI'да ҳам ҳардкод рўйхат (Pos.tsx:825).

### ❌ [P2] №12 Чегирма — фақат директор рухсати + журнал

- **Манба:** teshiklar-nazorat.md №12
- **Далил:** grep 'discount|chegirma|чегирма' — кодда чегирма функцияси умуман йўқ (на схема, на роут, на UI).
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — grep -riE 'discount|chegirma|чегирма|skidka|скидка' apps/api/src apps/web/src = 0 ҳит. Схема, роут, UI — ҳеч қаерда чегирма йўқ.

### ❌ [P2] Ичимлик сотиш = маркировка СКАН мажбурий (DataMatrix), қўлда қўшиш БЛОК

- **Манба:** LIMONARIYA-SPEC-TOLIQ §8.7 + pos-qurish-savollar №1 (раунд 17 жавоби)
- **Далил:** Скан/маркировка интеграцияси йўқ; goods ҳам оддий menu итем сифатида қўлда қўшилади (router.ts:1474-1486 menu, 1838-1850 goods writeoff). Ичимлик омбори ўзи 1.5-босқич деб режаланган.
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — grep -riE 'datamatrix|markirov|маркиров|scan|skan|скан|barcode' apps/api/src apps/web/src = 0 ҳит. goods оддий menu-итем сифатида addItem орқали қўлда қўшилади (router.ts:1653-1668), close'да dona-writeoff (:1838-1850).

### ❌ [P2] Стол кўчириш / бирлаштириш (заказни бошқа столга ўтказиш)

- **Манба:** POS домен аудити (Clopos parity; асосий ҳужжатларда аниқ банд топилмади)
- **Далил:** updateMeta фақат guests/note ни ўзгартиради (apps/api/src/router.ts:1595-1615) — hallId/tableNo ни ўзгартириш ёки икки заказни қўшиш endpoint’и йўқ; UI да ҳам йўқ (Pos.tsx). Официант адашса — фақат нолдан очиш.
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — updateMeta фақат guests/note патчлайди (apps/api/src/router.ts:1595-1615), hallId/tableNo ўзгармайди; merge/move endpoint йўқ (grep 'moveTable|mergeOrder|кўчир|бирлаштир' = 0; schema.ts:313 'transfer' — бу stock movement тури, омборлараро). Pos.tsx'да ҳам UI йўқ.

### 🟡 [P0] ⛔ Чек тўлов турисиз ёпилмайди; сумма = чек жами бўлмагунча «Ёпиш» ўчиқ (МАЖБУРИЙ)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §5.3 Сотув
- **Далил:** UI ҳар доим тўлиқ суммани юборади (apps/web/src/Pos.tsx:478), лекин API pos.close (apps/api/src/router.ts:1743-1793) тўловсиз ҳам ёпади: `if (pays.length && !input.comp)` (1790) — payments бўш бўлса ҳам order closed бўлади, sum(payments)==total текшируви умуман йўқ. Бузуқ/ёмон ниятли клиент 0 сўм билан чек ёпа олади → тушум яширилади.
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — apps/api/src/router.ts:1747-1754 — payments input `.optional()`; :1759 pays filtered; :1790 `if (pays.length && !input.comp)` — order flips to closed (:1771-1780) даже если payments бўш, ва бутун close блокида (1743-1912) sum(payments)==total текшируви йўқ. UI ҳимояси фақат клиентда: apps/web/src/Pos.tsx:478 ҳар доим [{method, amount: order.total}] юборади, Ёпиш тугмаси фақат items бўш бўлса disabled (Pos.tsx:760 disabled={empty}). Da'vo REFUTE бўлмади.

### 🟡 [P0] №9 «Тикетсиз таом ЙЎҚ» — кухня фақат тизим тикети билан пиширади (энг катта тешик)

- **Манба:** teshiklar-nazorat.md №9 + SPEC §1.5/§10
- **Далил:** Механизм бор: append-only kitchen_tickets/kitchen_ticket_items (apps/api/src/db/schema.ts:227-257), advisory-lock’ли flushKitchenTicket (apps/api/src/router.ts:741-777), close’да авто-flush (1786), UI «Кухняга юбориш» (apps/web/src/Pos.tsx:712-721). ЛЕКИН 5 станция принтерига авто чоп йўқ — фақат қўлда window.print (Pos.tsx:1003); кухня тикетни ўзи кўрмайди, гейт ҳали ташкилий.
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Механизм бор: append-only kitchen_tickets/kitchen_ticket_items (apps/api/src/db/schema.ts:227-257), flushKitchenTicket advisory-lock билан (apps/api/src/router.ts:741-777), close'да авто-flush (:1786 «safety net»), UI «Кухняга юбориш» (apps/web/src/Pos.tsx:712-721, 782-790). ЛЕКИН grep 'escpos|thermal|printer' = 0 (фақат IPrinter иконка); чоп фақат қўлда window.print (Pos.tsx:1003) битта варақда. Авто-чоп/станция принтери йўқ — гейт ташкилий.

### 🟡 [P1] Кўп-тўлов (multi-tender): бир неча тур аралаш (мас. 200к нақд + 100к қарз)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §5.3
- **Далил:** API payments массив қабул қилади (apps/api/src/router.ts:1747-1754), лекин UI фақат битта усулга тўлиқ суммани юборади (apps/web/src/Pos.tsx:473-486) — аралаш тўлов экрани йўқ.
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — API payments массивни қабул қилади (apps/api/src/router.ts:1747-1754 z.array). ЛЕКИН UI pay() ҳар доим битта элементли массив юборади (apps/web/src/Pos.tsx:478 `payments: [{ method, amount: order.total }]`), PAY MODAL — бита усул танлайдиган grid (Pos.tsx:824-838), сумма бўлиш экрани йўқ.

### 🟡 [P1] Қарз танланса → мижоз бириктириш МАЖБУРИЙ (ism+telefon, running-баланс, SMS, рейтинг)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §5.3-5.4 + PLAN-uz «Qarz daftari»
- **Далил:** debt тўлов тури, ledger ва қисман тўлаш ишлайди (apps/api/src/router.ts:2183-2282, over-pay блок 2270-2274), лекин мижоз entity умуман йўқ — қарз фақат orderId+tableNo га боғланади (2202-2213), мижозсиз ҳам ёпилади; SMS/рейтинг йўқ.
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — debt тўлов тури enum'да (schema.ts:264), debts рўйхати orderId+tableNo+hall'га боғланган (router.ts:2202-2213), payGuestDebt қисман тўлаш + over-pay блок (:2232-2283, блок :2270-2274). ЛЕКИН schema'да customer/mijoz жадвали йўқ (pgTable рўйхати 13-445), close debt method учун ҳеч қандай қўшимча input талаб қилмайди (:1743-1757); grep 'customer|mijoz|мижоз' = 0 domain-ҳит; SMS/рейтинг йўқ.

### 🟡 [P1] Атрибуция: официант + кассир алоҳида (ким очди, ким ёпди)

- **Манба:** QURISH-REJASI M4 + PLAN.md «Технологии»
- **Далил:** orders.waiterId create’да (router.ts:1586), closedById close’да (1776) — атрибуция бор. ЛЕКИН close protectedProcedure — рол текшируви йўқ, официант ўзи тўлов қабул қилиб ёпа олади (спецда «КАССИР ёпади»).
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Атрибуция БОР: create'да waiterId=ctx.user.id (apps/api/src/router.ts:1586), close'да closedById=ctx.user.id (:1776), schema'да иккала колонка (schema.ts:192, 200). ЛЕКИН close protectedProcedure — рол текшируви фақат comp тармоғида (:1760-1762 director/manager/cashier); оддий тўловли close'ни waiter ҳам бажаради, «фақат КАССИР ёпади» enforcement йўқ.

### 🟡 [P1] Кухня тикети станция бўйича (мангал/ошхона/салат/балиқ/бар) — 5 принтерга алоҳида чоп

- **Манба:** SPEC §8.8 Принтерлар + RUSTAM-AKA §5
- **Далил:** Станция snapshot ва группировка бор (schema.ts:254, router.ts:690-694, Pos.tsx:958-999 byStation), лекин ҳаммаси БИТТА варақда чиқади — ҳар станцияга ўз принтерига бўлиб юбориш/ESC-POS йўқ, чоп фақат қўлда window.print (Pos.tsx:1003).
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Станция snapshot (schema.ts:254 kitchenTicketItems.station), station default 'Бошқа' flush'да (router.ts:769,776), UI byStation группировка (apps/web/src/Pos.tsx:958-999). ЛЕКИН ҳаммаси битта тикет-варақда render бўлади, чоп = битта қўлда window.print (Pos.tsx:1003); grep 'escpos|thermal' = 0 — станцияларга алоҳида юбориш йўқ.

### 🟡 [P2] Чек рақами ГИБРИД: ички кетма-кет ID + кўрсатиладиган кунлик рақам («Стол 5, #042»)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §8.8 + pos-qurish-savollar №6
- **Далил:** checkNo = UUID нинг биринчи 5 белгиси (apps/api/src/router.ts:1555 `input.id.slice(0,5)`) — кетма-кет ҳам эмас, кунлик ҳам эмас; кассир/ошхона учун кузатиб бўлмайдиган тасодифий код.
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — apps/api/src/router.ts:1555 `checkNo: input.id.slice(0, 5).toUpperCase()` — UUID'нинг биринчи 5 белгиси. grep 'checkNo|sequence|daily' = бошқа ҳит йўқ; кетма-кет ҳам, кунлик ҳам эмас. Кўрсатиладиган рақам мавжудлиги учун partial.

### ✅ [P1] Официант мобил POS: PIN → стол(зал) → меню → заказ; телефонда ишлайди (PWA)

- **Манба:** QURISH-REJASI M4 + SPEC §8.8
- **Далил:** FloorView→NewOrderSheet→OrderView оқими (apps/web/src/Pos.tsx:139-262, 298-412, 415-893), mobile sticky bar (770-802), PWA manifest (apps/web/vite.config.ts:10-31), PIN auth (apps/api/src/auth.ts).

### ✅ [P1] Чек ёпиш = авто списание (тех-карта бўйича омбордан, бекорга тегмайди; текинда ҳам ечилади)

- **Манба:** QURISH-REJASI M4 + SPEC §5.3 + PLAN-uz «Tex-kartalar»
- **Далил:** pos.close транзакцияда idempotent flip (apps/api/src/router.ts:1771-1782) + sale_writeoff ҳаракатлари: рецепт грамм × qty, гўшт carcass даражасида (Мол/Қўй лаҳм) (1795-1905); текин заказда ҳам stock ечилади, фақат тўлов ёзилмайди (1788-1793). Рецептсиз/kg-goods итемлар skippedNames деб қайтарилади.

### ✅ [P1] Хизмат ҳақи ҲАР ЗАЛ: Асосий 10 · Катта 10 · Терраса 15 · Собой 0 (авто, кассир адашмайди)

- **Манба:** SPEC §5.3 + HOLAT «асосий қарорлар»
- **Далил:** import-halls.ts:6-24 (owner-confirmed фоизлар), create’да hall.servicePct order’га кўчади (apps/api/src/router.ts:1587), service = round(subtotal*pct/100) (1552), UI да кўринади (Pos.tsx:206-208, 702).

### ✅ [P1] Зал/стол харитаси: 46 реал стол, 4 зал, банд(яшил)/бўш кўринади

- **Манба:** RUSTAM-AKA-BAJARILGAN-ISHLAR §5 (даъво) + Clopos import
- **Далил:** seed-tables.ts:7-41 — 4 зал × реал стол номлари (22+8+8+8=46), FloorView grid банд/бўш + сумма + вақт (apps/web/src/Pos.tsx:139-296), «Бошқа очиқ» stray-заказлар ҳам кўринади (234-248). Даъво тасдиқланди.

### ✅ [P1] Текин/ходим (comp): сабаб МАЖБУРИЙ + кунлик ҳажм назорати №20 (лимитдан ошса 🚩)

- **Манба:** teshiklar-nazorat №20 + RUSTAM-AKA §5
- **Далил:** comp reason zod min(1) (apps/api/src/router.ts:1755), рол чеклови director/manager/cashier (1760-1762), тўлов билан аралаштириш блок (1763-1767); COMP_DAILY_CAP сигнали computeSignals’да (563-580); UI сабабсиз тугма disabled (apps/web/src/Pos.tsx:872), чекда «ТЕКИН (ходим/гость)» + сабаб (1047-1051).

### ✅ [P2] Меҳмонлар сони + изоҳ («аччиқ эмас»)

- **Манба:** RUSTAM-AKA §5 + pos-v2 талаби
- **Далил:** orders.guests/note (schema.ts:205-206), updateMeta фақат очиқ заказда (router.ts:1595-1615), UI: guests stepper + пресетлар (Pos.tsx:365-392), заказда +/- ва изоҳ inline input (544-587), чекда «Меҳмонлар» қатори (1055).

### ✅ [P2] Брендли чек (лого+телефон) + 2 хил чоп (кухня тикети / мижоз чеки) + принтер эни 58/80мм созланади

- **Манба:** SPEC §8.8 + RUSTAM-AKA §5
- **Далил:** Chek: лого/ном/шаҳар/телефон (apps/web/src/Pos.tsx:1040-1044), итемлар/хизмат/ИТОГО/тўловлар (1060-1078); алоҳида KitchenTicketView (949-1019); useReceiptWidth 58/80 localStorage + @page print CSS (896-927).

### ✅ [P3] Категория ранглари (шашлик қизил, салат яшил...) — таомни кўз билан тез топиш

- **Манба:** RUSTAM-AKA-BAJARILGAN-ISHLAR §5 (даъво)
- **Далил:** CAT_COLORS regex-палитра + hash fallback (apps/web/src/Pos.tsx:62-81), категория чиплари ва меню карталарида border-left ранг (610-626, 634-654). Даъво тасдиқланди.

---

## 🥩 Омбор / Обвалка / Инвентаризация

_32 талаб: ✅ 11 · 🟡 11 · ❌ 10_

### ❌ [P1] Мажбурийлик: кун ЁПИЛМАЙДИ инвентаризациясиз (ҳар куни эрталаб мажбурий саноқ)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §1.5 «Кун ёпилмайди инвентаризациясиз»
- **Далил:** finance.dayClose (router.ts:2150-2160) — oddiy hisobot query, approved count talab qilmaydi; tillCount saqlashda ham inventarizatsiya sharti yo'q; kunlik saноq majburiyati hech qayerda enforce qilinmagan
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — finance.dayClose (router.ts:2150-2160) — оддий report query, ҳеч нарса талаб қилмайди; tillCount.set (2316-2343) да инвентаризация шарти йўқ. grep 'мажбур' фақат Inventarizatsiya.tsx:338 placeholder'ига тушади (фарқ сабаби учун). Кунлик саноқ мажбурияти на API, на web'да enforce қилинмаган.

### ❌ [P1] Харид ↔ обвалка солиштируви (бозорчи 35кг олди, обвалкага 33кг келди → 🚩 кам келтириш)

- **Манба:** teshiklar-nazorat.md #17; LIMONARIYA-SPEC §12 назорат ③
- **Далил:** Obvalka kirimi xariddan butunlay uzilgan — obvalka.create o'z weightG/pricePerKg ni mustaqil oladi (router.ts:1282-1298), purchases bilan bog'lanish/solishtirish kodi yo'q (grep: purchase↔obvalka join 0 ta)
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — obvalka.create ўз weightG/pricePerKg/supplier'ини мустақил олади (router.ts:1282-1315) — purchaseId reference йўқ, purchases билан join/солиштириш коди grep бўйича 0 та. Обвалка кирими хариддан бутунлай узилган.

### ❌ [P1] Списание брак/бузилди/йўқотиш ҳужжати (маҳсулот бузилса ҳисобдан чиқариш)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §4.3 «Йўқотиш/бузилди»; teshiklar #6-7
- **Далил:** movementType 'loss' enumda bor (schema.ts:312) lekin hech bir protsedura yozmaydi, UI yo'q — buzilgan mahsulotni faqat inventarizatsiya farqi orqali bilvosita yozish mumkin
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — movementType 'loss' фақат enum'да (schema.ts:312); grep бўйича router'да ҳам, web'да ҳам ишлатилмайди; списание UI йўқ. Бузилган маҳсулотни фақат инвентаризация фарқи (inventory_adjust) орқали билвосита ёзиш мумкин.

### ❌ [P1] Ишлаб чиқариш ҳужжати: партия тайёрланганда хом-ашё омбордан чиқади, ярим-тайёр кирим бўлади (алоҳида қолдиқ)

- **Манба:** PLAN-uz.md «Ishlab chiqarish — partiya bilan»; LIMONARIYA-SPEC §5.2
- **Далил:** movementType 'production' hech qayerda ishlatilmaydi; semi-mahsulotlar uchun kirim/chiqim protsedurasi yo'q (stockableOnHand ham semi ni sanamaydi — router.ts:392 faqat ingredient/part/goods)
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — movementType 'production' фақат enum'да (schema.ts:309), ҳеч қаерда ёзилмайди. stockableOnHand semi'ни санамайди (router.ts:392: faqat ingredient/part/goods); pos.close semi компонентларни атайлаб skip қилади (1886: type !== 'semi'). Ярим-тайёр учун кирим/чиқим протседураси йўқ.

### ❌ [P2] Нормы самообучаемые: ҳар тасдиқланган обвалка выборкага қўшилиб медиана/полосалар қайта ҳисобланади (n ўсади → полоса торайади)

- **Манба:** obvalka-normalar.md §7.5; PLAN-uz «normalar yanada aniqlashadi»
- **Далил:** part_types.normMinPct/MaxPct — statik seed qiymatlar (schema.ts:133-134); kodda hech qayerda yangi obvalkalardan median/band qayta hisoblanmaydi, «tasdiqlangan obvalka» tushunchasi ham yo'q (grep: recompute yo'q)
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — partTypes.normMinPct/MaxPct — статик seed (apps/api/src/db/schema.ts:133-134, import-parttypes.ts:41-63). router.ts:402 изоҳи очиқ айтади: 'Owner-stated constants (phase-1: hardcoded, not a sliding median)'. Кодда partTypes'ни update қиладиган ягона жой — import-parttypes.ts seed upsert; обвалкалардан median/band қайта ҳисоблаш йўқ. Ягона median — priceSpikes (router.ts:508-515), у нарх аномалияси, қисм нормалари эмас. 'Тасдиқланган обвалка' тушунчаси йўқ (obvalka жадвалида status устуни йўқ).

### ❌ [P2] Таннарх усули: WAC (ўртача) ёки FIFO — партия нархлари бўйича баҳолаш

- **Манба:** RUSTAM-AKA «Сиздан керак: WAC ёки FIFO»; remaining-work roadmap
- **Далил:** Hech biri yo'q: go'sht = faqat ENG OXIRGI karkas narxi (router.ts:55-64 limit 1), ingredient = oxirgi xarid narxi ustidan yozish (2026-2032), COGS harakatlarni tarixiy emas JORIY narxda baholaydi (cogsForWindow 188-229) — partiya/batch baholash umuman yo'q
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — Ҳеч бири йўқ: гўшт = ЭНГ ОХИРГИ каркас нархи (latestMeatCost, router.ts:56-64, limit 1); ingredient costPrice = охирги харид нархи overwrite (2027-2032); cogsForWindow ҳаракатларни ЖОРИЙ нархда баҳолайди (188-229). grep WAC/FIFO/weighted — 0 та ('batch' топилгани — қозон-рецепт meatPct>100 exclusion, партия баҳолашга алоқасиз).

### ❌ [P2] Бозорчи: GPS + вақт АВТО, расм ихтиёрий (харид киритганда)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §5.1, §12
- **Далил:** purchases jadvalida lat/lng/photo ustunlari yo'q (schema.ts:276-287 faqat supplier/note/total/paidTotal); router va webda geolocation/rasm kodi 0 ta (grep)
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — purchases жадвалида lat/lng/photo устунлари йўқ (schema.ts:276-287 — фақат supplier/note/total/paidTotal); grep geolocation/navigator.geo/latitude/photo/расм — apps/api/src ва apps/web/src да 0 та. Вақт фақат createdAt defaultNow (бу оддий timestamp, GPS назорати эмас).

### ❌ [P2] Бозорчи қолган назоратлари: авто харид рўйхати (омбордан) · кунлик бюджет лимити · қассоб рейтинги

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §12 назорат ②④⑤
- **Далил:** Kodda byudjet limiti, avto ro'yxat generatsiyasi yoki supplier reytingi yo'q (grep: budget/rating 0 ta)
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — grep budget/бюджет/rating/рейтинг — код бўйича 0 та (ягона hit 'SALAT' catalog-seed'да, false positive). COMP_DAILY_CAP (router.ts:407) — текин/ходим лимити, бозорчи бюджети эмас. Омбордан авто-рўйхат генерацияси ҳам йўқ.

### ❌ [P2] Посуда/жиҳоз инвентаризацияси (~2180 дона): рўйхат + топшириқ-қабул + синган/йўқолган назорати

- **Манба:** QURISH-REJASI Milestone 7; LIMONARIYA-SPEC §8.6
- **Далил:** Idish-tovoq uchun jadval/UI umuman yo'q (schema.ts da faqat oziq-ovqat stock); reja bo'yicha 1.5-bosqich
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — Идиш-товоқ учун жадвал/UI умуман йўқ — schema.ts да фақат озиқ-овқат stock (productType: ingredient/part/semi/dish/goods). 'jihoz' фақат expenseCategory (schema.ts:347) — харажат категорияси, инвентар рўйхати/топшириқ-қабул/синган назорати эмас.

### ❌ [P3] Электрон тарози интеграцияси — вазн дастурга автоматик тушади

- **Манба:** PLAN-uz.md «Elektron tarozi»; LIMONARIYA-SPEC §2 (1-босқич қўлда, кейин интеграция)
- **Далил:** Faqat qo'lda kiritish (Obvalka.tsx input maydonlari) — bu 1-bosqich rejasiga mos; tarozi API/serial kodi yo'q, model ham hali tanlanmagan (RUSTAM ❓ ro'yxatida)
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — Obvalka.tsx — фақат қўлда киритиладиган input майдонлари; grep тарози/scale/serial/bluetooth/usb/весы — apps/api/src ва apps/web/src да релевант hit 0 та (фақат 'serialize' изоҳлари ва Moliya.tsx'даги 'тарозили' матн false positive).

### 🟡 [P1] Мариновка ўсиши (+13–30%) + йўқотиш % таннархда ҳисобга олинади

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §6, §8; QURISH-REJASI M2
- **Далил:** Yo'qotish % hisoblanadi (obvalka-calc.ts:19-20 lossPct), lekin marinovka o'sishi hech qayerda hisobga olinmaydi — recipes.marinade faqat text ustun (schema.ts:110), router.ts da 'marinade' ishlatilmaydi (grep: 0 ta)
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Yo'qotish % бор: obvalka-calc.ts:19-20 (lossPct), :50 balanceFlag >±5%. Мариновка: маълумот seed'да бор (texkarta-seed.json: '13% купаяди изза мариновки', '30% купаяди...') ва БАЗАГА импорт қилинади (import-recipes.ts:72 → recipes.marinade, schema.ts:110), ЛЕКИН ҳеч қаерда ўқилмайди — router.ts да 'marinade' 0 та, таннарх ҳисобида (computeDishTaannarx router.ts:93-167, cogsForWindow 188-229) ишлатилмайди.

### 🟡 [P1] Ҳаракат турлари: Харид · Обвалка · Ишлаб чиқариш · Списание(сотув) · Инвентаризация тузатиш · Йўқотиш/бузилди · Локация кўчириш

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §4.3
- **Далил:** Enum 7 turni ham biladi (schema.ts:306-314), lekin faqat 4 tasi yoziladi: purchase (router.ts:2062), obvalka (1349), sale_writeoff (1843,1893), inventory_adjust (2644). production/loss/transfer — hech bir protsedura yozmaydi, UI ham yo'q
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Enum 7 турни билади (schema.ts:306-314). Ёзиладиганлари 4 та: purchase (router.ts:2062-2072), obvalka (1349-1357), sale_writeoff (1841,1891-1905), inventory_adjust (2644-2652). grep бўйича 'production'/'loss'/'transfer' фақат enum деклaрациясида (schema.ts:309,312,313) — ҳеч бир протседура ёзмайди, UI ҳам йўқ.

### 🟡 [P1] Обвалка қисмлари омборга кирим (вағора/шапок/думба... ҳар қисм алоҳида)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §5.1 «қисмлар ... ОМБОРГА КИРИМ»
- **Далил:** Kirim faqat KARKAS darajasida: sotiladigan yig'indi bitta «Мол лаҳм»/«Қўй лаҳм» mahsulotiga yoziladi (router.ts:1333-1357, seed-stock.ts:6-8). Qismlar obvalka_parts da saqlanadi, lekin alohida sklad qoldig'i sifatida yuritilmaydi
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — obvalka.create да кирим фақат КАРКАС даражасида: сотиладиган (non-waste) йиғинди битта 'Мол лаҳм'/'Қўй лаҳм' маҳсулотига ёзилади (router.ts:1333-1357; seed-stock.ts CARCASS=['Мол лаҳм','Қўй лаҳм'], изоҳ: 'meat stock is tracked here — obvalka credits, sales debit'). Қисмлар obvalka_parts да сақланади (1323-1331) лекин stock_movements га алоҳида кирмайди; pos.close ҳам гўштни каркас даражасида чиқаради (1795-1802).

### 🟡 [P1] 2 та омбор (Ошхона музлаткич / Катта музлаткич) — ҳар бирининг ЎЗ қолдиғи, ораларида кўчириш ҳаракат сифатида ёзилади

- **Манба:** PLAN-uz.md §Ombor («ombor ikkita — har biri alohida hisoblanadi»)
- **Далил:** STORAGES const bor (router.ts:400) va inventarizatsiya har sklad uchun alohida ochiladi (2430-2472), LEKIN stock_movements da storage/location ustuni YO'Q — qoldiq yagona umumiy pool; startCount snapshot ikkala sklad uchun ham GLOBAL onHand oladi (2459-2469, stockableOnHand storage bo'yicha filtrlamaydi); transfer turi ishlatilmaydi, ko'chirish UI yo'q
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — STORAGES const бор (router.ts:400, Inventarizatsiya.tsx:5), инвентаризация ҳар склад учун алоҳида очилади (startCount 2430-2472). ЛЕКИН stock_movements да storage устуни ЙЎҚ (schema.ts:318-340) — қолдиқ ягона pool; startCount snapshot иккала склад учун ҳам ГЛОБАЛ stockableOnHand(tx) олади (2459, функция 379-397 storage бўйича фильтрламайди); 'transfer' тури ишлатилмайди, кўчириш UI grep'да 0 та.

### 🟡 [P1] Бир амал икки ёзув: бозорчи харид → касса − ВА омбор + (программа ўзи)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §8.5
- **Далил:** Ombor + bor (router.ts:2062-2072); kassa − YO'Q: purchase/paySupplier expenses jadvaliga yozmaydi, expectedCashForWindow (234-281) faqat expenses ni ayiradi — naqd xarid kutilgan kassada ko'rinmaydi → kamomad hisobi buziladi
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Омбор + бор: purchase.create stockMovements ёзади (router.ts:2062-2072). Касса − ЙЎҚ: purchase.create ҳам, paySupplier (2346-2390, фақат paidTotal bump) ҳам expenses'га ёзмайди; expectedCashForWindow (234-281) фақат expenses жадвалини айиради — нақд харид кутилган кассада кўринмайди, камомад ҳисоби бузилади.

### 🟡 [P1] Етказувчи (поставщик) қарзи: тўлов нақд/қарз, қарз ledger + қисман тўлаш

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §5.1 «тўлов(нақд/қарз)»; RUSTAM-AKA §9 «поставщик қарзи»
- **Далил:** Ledger ishlaydi: purchases.paidTotal (schema.ts:281), paySupplier guarded/atomic (router.ts:2346-2390), finance.debts ro'yxati (2183-2199), Moliya.tsx:547-567 UI. LEKIN purchase.create da «hozir to'landi» inputi yo'q — HAR BIR xarid 100% qarz bo'lib boshlanadi (paidTotal=0), naqd xaridni kirim paytida belgilab bo'lmaydi
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Ledger ишлайди: purchases.paidTotal (schema.ts:281), paySupplier guarded/atomic қисман тўлаш (router.ts:2346-2390), finance.debts (2183-2199), Moliya.tsx UI. ЛЕКИН purchase.create input (1980-1993) да 'ҳозир тўланди' майдони йўқ — head paidTotal'сиз insert қилинади (2040-2050) → default 0, ҲАР харид 100% қарз бўлиб бошланади; Purchases.tsx да ҳам paid/нақд input йўқ (grep 0 та).

### 🟡 [P1] Туша нархини ошириб ёзиш назорати — нарх аномалияси (тарихдан медиана)

- **Манба:** teshiklar-nazorat.md #3, #18; LIMONARIYA-SPEC §12 назорат ①
- **Далил:** Karkas uchun bor: priceSpikes — oxirgi narx > oxirgi 10 ta median ×1.15 → signal (router.ts:495-523). Boshqa xarid mahsulotlari uchun anomaliya YO'Q — costPrice tekshiruvsiz ustidan yoziladi (2026-2032)
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Каркас учун бор: priceSpikes — сўнгги нарх > охирги 10 та медиана ×1.15 (MEAT_PRICE_SPIKE_PCT=1.15, router.ts:495-523), Analitika.tsx:141 да кўрсатилади. Бошқа харид маҳсулотлари учун аномалия ЙЎҚ: purchase.create costPrice'ни текширувсиз устидан ёзади (2027-2032).

### 🟡 [P1] Омбор светофори 🟢🟡🔴 (нима тугаяпти — авто, тарихдан)

- **Манба:** QURISH-REJASI M3; LIMONARIYA-SPEC §11 «ОСТАТОК доим кўриниб (светофор)»
- **Далил:** Faqat manfiy=qizil: Ombor.tsx:63 (onHand<0 → text-red-500), digest.lowStock = onHand<0 soni (router.ts:2667). Min-zaxira chegarasi yoki tarixiy sarf asosidagi sariq/yashil daraja YO'Q
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Фақат манфий=қизил: Ombor.tsx:61-64 (onHand<0 → text-red-500, акс ҳолда оддий zinc); digest.lowStock = onHand<0 сони (router.ts:2667). Min-заxира чегараси (schema'да minStock устуни йўқ) ёки тарихий сарф тезлигидан сариқ/яшил даража ҲЕЧ ҚАЕРДА йўқ.

### 🟡 [P2] Манфий қолдиқ фақат сабаб + директор тасдиғи билан ўтади

- **Манба:** PLAN-uz.md «Manfiy qoldiq ... sabab + direktor tasdig'i bo'lmasa, o'tmaydi»
- **Далил:** Sotuv/spisaniye qoldiqni jimgina minusga tushira oladi — gate yo'q; faqat ko'rsatkich: Ombor.tsx:63 qizil rang, digest lowStock=onHand<0 (router.ts:2667), shortagePattern signali. Sabab+tasdiq faqat inventarizatsiya tuzatishida bor
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — pos.close sale_writeoff'ни onHand текширувисиз ёзади (router.ts:1830-1905) — қолдиқ жимгина минусга тушади. Индикаторлар: Ombor.tsx:63 (onHand<0 → text-red-500), digest.lowStock=onHand<0 (router.ts:2667), shortagePattern (531-559). Сабаб+тасдиқ фақат инвентаризацияда: submitCount reason талаб қилади (2601-2612), approveCount directorProcedure (2623).

### 🟡 [P2] Обвалка вазнини МЕНЕЖЕР ёзади (рол чекловi)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §3, §5.1 «МЕНЕЖЕР тарози вазнини ёзади»
- **Далил:** obvalka.create protectedProcedure (router.ts:1282) — HAR QANDAY rol (ofitsiant ham) obvalka kirita oladi; managerProcedure mavjud (trpc.ts:19-23) lekin bu yerda ishlatilmagan — tannarx manbasini istalgan xodim buzishi mumkin
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Сервер: obvalka.create = protectedProcedure (router.ts:1282) — API даражасида ҲАР ҚАНДАЙ рол (официант ҳам) ёза олади; managerProcedure мавжуд (trpc.ts:19-23) лекин ишлатилмаган. Web: Shell.tsx:49 табни director/manager/buyer'га чеклайди (canObvalka) — лекин бу client-side ва buyer'ни ҳам киритади, manager-only эмас; API очиқ қолгани учун чеклов тўлиқ эмас.

### 🟡 [P2] Ичимлик/спиртли омбори — шиша саноғи (Кола −10,432 тешиги)

- **Манба:** QURISH-REJASI «1.5-БОСҚИЧ»; teshiklar-nazorat #21
- **Далил:** Umumiy goods-oqim ishlaydi: goods sotib olinadi (router.ts:1954) va dona bo'yicha sale_writeoff yoziladi (1838-1851), inventarizatsiyada sanaladi (392). Lekin maxsus ichimlik ombori/shisha nazorati/markirovka-skan yo'q — reja bo'yicha 1.5-bosqich
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Умумий goods-оқим ишлайди: goods сотиб олинади (router.ts:1954), дона бўйича sale_writeoff (1838-1851), инвентаризацияда саналади (stockableOnHand 392 goods'ни ўз ичига олади). Лекин махсус ичимлик омбори, шиша саноғи ёки маркировка-скан йўқ: grep шиша/scan/barcode/штрих — 0 та.

### ✅ [P0] Обвалка: туша → қисмлар, 1-босқич қўлда вазн киритиш (кейин тарози)

- **Манба:** QURISH-REJASI-1bosqich.md — Milestone 2
- **Далил:** apps/api/src/router.ts:1282-1361 obvalka.create (carcassType/weightG/pricePerKg/parts, transaction); apps/web/src/Obvalka.tsx — kirish formasi + jonli natija (ResultView 215-282)

### ✅ [P0] ±5% вазн баланси: |туша − Σ қисмлар| > 5% → флаг «баланс не сходится»

- **Манба:** obvalka-normalar.md §7.3; QURISH-REJASI M2; teshiklar-nazorat #1
- **Далил:** apps/api/src/obvalka-calc.ts:50 balanceFlag = Math.abs(lossPct)>5; router.ts:409-458 computeSignals obvalkaFlags (oxirgi 20 obvalka); Obvalka.tsx:230-233 «🔴 текшир / 🟢 жойида»

### ✅ [P0] Таннарх движок: туша нархи фақат сотиладиган қисмларга тарқалади (суяк/чарви/брак cost=0) → реал 1кг таннарх

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §6; PLAN-uz «Suyak bepul — narxi go'shtga o'tadi»
- **Далил:** apps/api/src/obvalka-calc.ts:21-26 sellableG (non-waste) bo'yicha costPerKg, :42 waste cost=0; router.ts:56-89 latestMeatCost. Eslatma: RUSTAM-AKA hujjatida «охирги обвалкалардан ўртача» deyilgan, kodda esa faqat ENG OXIRGI bitta tusha (limit 1) — o'rtacha emas

### ✅ [P0] Қолдиқ «сақланмайди» — append-only ҳаракатлардан ўзи ҳисобланади, қўлда ўзгартириб/сохталаштириб бўлмайди

- **Манба:** PLAN.md «Главная идея»; LIMONARIYA-SPEC-TOLIQ.md §4.2, §13
- **Далил:** apps/api/src/db/schema.ts:316-340 stockMovements (signed qty, append-only); router.ts:1917-1936 stock.onHand = SUM(qty); movement uchun update/delete endpoint yo'q

### ✅ [P0] Чек ёпиш = авто списание техкарта бўйича (гўшт stock_hint орқали, идемпотент)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §5.3; QURISH-REJASI M4; PLAN-uz «Tex-kartalar — sotuv o'zi chiqim qiladi»
- **Далил:** apps/api/src/router.ts:1769-1912 pos.close — idempotent flip open→closed (1770-1782), retsept bo'yicha sale_writeoff (1857-1905), go'sht stock_hint→karkas mahsulotiga (1876-1882), goods dona (1838-1851); skipped ro'yxati qaytariladi

### ✅ [P0] Кунлик инвентаризация: дастур ҳисоблаган қолдиқ ↔ реал сон, фарқ → сабаб МАЖБУРИЙ + директор тасдиғи, фақат тасдиқда ledger тузатилади

- **Манба:** PLAN-uz.md «Har kungi inventarizatsiya»; QURISH-REJASI M6
- **Далил:** apps/api/src/router.ts:2430-2655 — startCount (theoretical snapshot, advisory lock), saveCount, submitCount farq bo'lsa sababsiz o'tkazmaydi (2601-2612), approveCount faqat director va shunda inventory_adjust yoziladi (2623-2654); farq >5% flag + pul qiymati valueGap (2502-2531); apps/web/src/Inventarizatsiya.tsx (387 qator)

### ✅ [P0] Харид (кирим): тур + кг/дона + нарх + етказувчи(ихт.) + изоҳ → авто омборга кирим

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §5.1; QURISH-REJASI «Бозорчи модули»
- **Далил:** apps/api/src/router.ts:1979-2075 purchase.create — supplier/note/items, tranzaksiyada purchase_items + stock_movements(type=purchase) yoziladi, birlik konversiyasi (kg→g, l→ml); apps/web/src/Purchases.tsx (263 qator)

### ✅ [P1] Норма «рабочая полоса %» ҳар қисм учун (qўй 10 / mol 10 та) тарихдан — полосадан чиқса сариқ флаг + кутилган диапазон кўрсатилади

- **Манба:** obvalka-normalar.md §2-3, §7.2
- **Далил:** apps/api/src/db/import-parttypes.ts:7-30 — normMinPct/normMaxPct aynan hujjatdagi polosalardan seed (Ваггора 28-42 va h.k.); obvalka-calc.ts:30-33 outOfNorm; Obvalka.tsx:267-270 ⚠️ + norma diapazon ustuni

### ✅ [P1] Харид киритилса ингредиент нархи янгиланади (таннарх шундан тўғрилашади)

- **Манба:** RUSTAM-AKA-BAJARILGAN-ISHLAR.md §6 «Харид → Омбор»
- **Далил:** apps/api/src/router.ts:2026-2032 — costPrice = oxirgi xarid narxi (price/qty, display-unit bo'yicha); cogsForWindow/valuePortion shu narxdan foydalanadi (173-229)

### ✅ [P1] Такрорий камомад паттерни: кетма-кет инвентаризацияларда бир хил маҳсулот кам чиқса → сигнал (дастур ўзи тешик топади)

- **Манба:** PLAN-uz.md «Dastur o'zi tahlil qiladi»; teshiklar-nazorat (умумий движок)
- **Далил:** apps/api/src/router.ts:525-560 shortagePattern — oxirgi 5 approved count ichida ≥2 marta manfiy inventory_adjust bo'lgan mahsulotlar; historyPending flag; analytics.signals orqali direktor paneliga chiqadi (2657)

### ✅ [P2] Мусор (чиқинди) қўйда >3% → флаг

- **Манба:** obvalka-normalar.md §4, §7.4
- **Далил:** apps/api/src/db/import-parttypes.ts:17 ["Мусор",1,3,true] — umumiy band-tekshiruv orqali pct>3 outOfNorm bo'ladi (obvalka-calc.ts:30-33)

---

## 💰 Молия / Касса / Қарз

_33 талаб: ✅ 14 · 🟡 11 · ❌ 8_

### ❌ [P1] Қарз танланса мижоз бириктириш МАЖБУРИЙ; қарз дафтарида мижоз исми + телефон

- **Манба:** LIMONARIYA-SPEC-TOLIQ §5.3-5.4 + PLAN-uz «Qarz daftari»
- **Далил:** customers/mijoz жадвали умуман йўқ (grep бўш); қарз заказ/столга боғланади: apps/api/src/router.ts:2202-2213 (tableNo/hall орқали кўрсатилади) — ким қарздорлиги сақланмайди
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — /usr/bin/grep -ria 'customer|mijoz|мижоз|debtor|qarzdor' — жадвал/устун йўқ (фақат UI ёрлиқлари Moliya.tsx:546,584). Қарз рўйхати столга боғланади: apps/api/src/router.ts:2202-2213 (tableNo/hall танланади), apps/web/src/Moliya.tsx:592-594 ҳам фақат зал·стол кўрсатади. 'phone' грепи фақат brand.ts:5 (ресторан телефони). pos.close'да debt учун мижоз талаби йўқ (router.ts:1747-1768).

### ❌ [P1] Харид киритишда тўлов тури танланади: нақд ёки қарз (етказувчига)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §5.1 «тўлов(нақд/қарз)»
- **Далил:** apps/api/src/router.ts:1979-2050 purchases.create тўлов параметри олмайди — ҳар харид paidTotal=0 (100% қарз) бўлиб тушади; нақд тўланган харид ҳам «қарз» кўринади
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — apps/api/src/router.ts:1979-1994 purchase.create input = {supplier?, note?, items} — тўлов параметри йўқ; 2040-2050 insert paidTotal'сиз → default 0 (schema.ts:281) = ҳар харид 100% қарз. UI ҳам фақат supplier+items юборади: apps/web/src/Purchases.tsx:102-105. Тўлов фақат кейин алоҳида paySupplier (router.ts:2346) орқали.

### ❌ [P1] Кассадан чиқим 3 тур: харид (пул ҳаракати) / харажат (P&L) / 👑 эга олди (тақсимот, фойдадан ТАШҚАРИ)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §8.5 + HOLAT-davom-ettirish «қарорлар»
- **Далил:** apps/api/src/db/schema.ts:342-349 — «эга олди» категорияси йўқ; apps/api/src/router.ts:642-649 ҳамма expenses OPEX сифатида соф фойдадан айирилади → эга олди ёзилса P&L нотўғри бузилади
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — apps/api/src/db/schema.ts:342-349 expenseCategory = [ijara,gaz,elektr,ish_haqi,jihoz,boshqa] — «эга олди» йўқ; /usr/bin/grep -ria 'ega_oldi|эга олди|owner_draw|dividend|тақсимот' — бўш. router.ts:642-649 ҳамма expenses OPEX сифатида sofFoyda'дан айирилади (649: revenue−cogs−opex−cardTax) → эга олди киритилса P&L бузилади.

### ❌ [P1] Возврат (пул қайтариш): фақат кассир+директор рухсати + ўзгармас журнал + возврат тренди

- **Манба:** PLAN-uz «Kassa nazorati» + teshiklar-nazorat №13
- **Далил:** refund/vozvrat/возврат тушунчаси кодда умуман йўқ (apps/ бўйича grep бўш); кутилган нақд формуласида ҳам возврат ажратилмаган (router.ts:279)
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — /usr/bin/grep -ria 'refund|vozvrat|возврат|қайтар|qaytar' apps/api/src apps/web/src — бўш (бинар-скип муаммоси ҳисобга олиниб -a билан қайта текширилди). orders статуслари фақат open/closed (schema.ts:182), негатив orderPayments/сторно механизми йўқ; expectedCash формуласида (router.ts:279) возврат термини йўқ.

### ❌ [P2] Тўлов турлари СОЗЛАНАДИГАН жадвал: эга ўзи тур қўшади (Хумо/Payme...), ҳар турга ҳисоб/«бўлиш мумкин»/«мижоз мажбурий» флаглари

- **Манба:** LIMONARIYA-SPEC-TOLIQ §5.3 «Тўлов турлари жадвали»
- **Далил:** apps/api/src/db/schema.ts:259-265 — pgEnum қотириб ёзилган (cash/card/click/payme/debt), Хумо йўқ; тўлов-тури жадвали ва флаглар мавжуд эмас
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — apps/api/src/db/schema.ts:259-265 paymentMethod = pgEnum("payment_method",[cash,card,click,payme,debt]) — қотириб ёзилган. /usr/bin/grep -ria 'humo|xumo|хумо|payment_type' бўйича ягона натижа шу enum; тўлов-тури жадвали, CRUD ёки флаглар (бўлиш мумкин/мижоз мажбурий) мавжуд эмас.

### ❌ [P2] Excel'дан бошланғич қарздорлар импорти

- **Манба:** QURISH-REJASI Milestone 5
- **Далил:** apps/api/src/db/ да фақат import-catalog/halls/parttypes/recipes/seed-* скриптлари — қарз импорти йўқ
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — apps/api/src/db/ таркиби: import-catalog/halls/parttypes/recipes + seed-stock/tables/seed — қарз импорти йўқ. /usr/bin/grep -ria 'xlsx|excel|csv' apps/api/src apps/web/src — бўш.

### ❌ [P3] Кун охири нақд пул → сейфга ўтказиш ёзуви

- **Манба:** PLAN-uz «Kassa nazorati» (kun oxiri naqd → seyf)
- **Далил:** Сейф тушунчаси кодда йўқ (grep бўш); tillCounts фақат саноқни сақлайди (schema.ts:392-400)
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — /usr/bin/grep -ria 'seyf|сейф|safe' — сейф тушунчаси йўқ (auth.ts:6 timingSafeEqual холос). tillCounts фақат саноқ+камомадни сақлайди (schema.ts:392-400, router.ts:2316-2343) — пул кўчириш ҳаракати ёзилмайди.

### ❌ [P3] Банкет: аванс (олдиндан тўлов) ихтиёрий ёзилади ва ҳисобдан айирилади

- **Манба:** PLAN-uz «Banket» (SPEC §15: ҳозирча қўлда, тизимга кейин)
- **Далил:** Банкет/аванс тушунчаси кодда йўқ (grep бўш); SPEC §15 буни очиқ/кейинга деб белгилаган
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — /usr/bin/grep -ria 'banket|банкет|avans|аванс|advance|predoplat' — ягона топилма зал номлари seed-tables.ts:13-14 («3-Банкет зал», «4-Банкет зал»). Аванс жадвали/майдони, олдиндан тўлов оқими йўқ; orderPayments фақат ёпилишда ёзилади (router.ts:1790-1793).

### 🟡 [P0] ⛔ Чек тўлов турисиз ёпилмайди; сумма = чек жами бўлмагунча «Ёпиш» ўчиқ (мажбурийлик)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §5.3
- **Далил:** UI мажбурлайди: apps/web/src/Pos.tsx:473-478 pay() фақат amount=order.total билан юборади. ЛЕКИН сервер текширмайди: apps/api/src/router.ts:1747-1754 payments optional, 1759+1790-1793 — бўш payments билан ҳам заказ closed бўлади ва sum==total валидацияси йўқ → API орқали тўловсиз чек ёпиш мумкин (пул йўқотиш тешиги)
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — UI мажбурлайди: apps/web/src/Pos.tsx:478 pay() ҳар доим payments:[{method, amount:order.total}] юборади. Сервер текширмайди: apps/api/src/router.ts:1747-1754 payments z.array(...).optional(); 1759 pays=(input.payments??[]) ; 1771-1782 flip open→closed ҳеч қандай сумма/тўлов шартисиз ўтади; 1743-1913 оралиғида sum==order.total валидацияси умуман йўқ (заказ total ҳисобланмайди ҳам) → бўш payments билан API орқали чек ёпилади. REFUTE қилинмади.

### 🟡 [P1] Кунлик касса журнали (Excel Вариант C): кун боши қолдиқ = авто (кечаги охирги + размен 50к) → КИРИМ авто (POS тур бўйича + қарз тўлови) → ЧИҚИМ категория → кун охири авто

- **Манба:** LIMONARIYA-SPEC-TOLIQ §8.5 + QURISH-REJASI Milestone 5
- **Далил:** Кирим авто byMethod: apps/api/src/router.ts:596-618; кутилган нақд = 50к размен + нақд тушум + қарз қайтган − нақд чиқим: router.ts:232-280; чиқим категория: Moliya.tsx:321-452. ЛЕКИН кун боши қолдиқ кечагидан КЎЧМАЙДИ (TILL_FLOAT=50к фикс, router.ts:232), «кунни ёпиш» акти/қулфи йўқ (dayClose фақат query: router.ts:2150-2160), чиқимни фақат директор киритади (2109 directorProcedure)
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Бор: КИРИМ авто byMethod (router.ts:596-618), кутилган нақд формула (232-280), чиқим категориялари UI (Moliya.tsx:321-451). Йўқ: кун боши қолдиқ кечагидан кўчмайди — TILL_FLOAT=50_000 конста (router.ts:232,279; 'kecha/carry' грепи фақат break-even таққослови учун 488, касса қолдиғи эмас); «кунни ёпиш» акти/қулфи йўқ — dayClose оддий query (2150-2160); чиқим фақат директор (expenses.create=directorProcedure 2109; trpc.ts:14-15 role!=='director'→FORBIDDEN).

### 🟡 [P1] СМЕНА X/Z: очиш (кассир PIN + размен 50к), Z-ҳисобот (нақд/карта/клик/хумо/қарз алоҳида · чиқим · чек сони · ўртача чек · камомад) → директор тасдиқ; X-оралиқ; смена топшириш

- **Манба:** LIMONARIYA-SPEC-TOLIQ §8.8 + RUSTAM-AKA «Кейинги ишлар» №2
- **Далил:** Смена/shift жадвали ва X/Z тушунчаси кодда умуман йўқ (grep бўш); Z маълумот мазмунининг аналоги finance.dayClose да бор (apps/api/src/router.ts:2150-2160: byMethod, checks, avgCheck) + tillCount камомад — лекин смена очиш/ёпиш/топшириш ва тасдиқ йўқ. RUSTAM-AKA ҳужжати ҳам «кейинги» деб тан олади

### 🟡 [P1] Бир амал — икки ёзув: бозорчи харид → касса − ВА омбор + (программа ўзи)

- **Манба:** QURISH-REJASI Milestone 5 + LIMONARIYA-SPEC-TOLIQ §8.5
- **Далил:** Омбор + авто: apps/api/src/router.ts:2062-2072. Касса − ёзилмайди: expectedCashForWindow (router.ts:265-279) фақат expenses'ни айиради — нақд тўланган харид ҳам, paySupplier тўлови ҳам (2346-2390) кассага таъсир қилмайди → камомад ҳисоби харид пулини кўрмайди
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Омбор + авто: apps/api/src/router.ts:2062-2072 (stockMovements type='purchase'). Касса − йўқ: expectedCashForWindow (265-279) фақат expenses'ни айиради — purchase.create ҳеч қандай касса ёзуви қилмайди (1995-2073), paySupplier ҳам фақат paidTotal'ни оширади (2373-2382), касса/expense ёзуви йўқ → нақд харид камомад ҳисобида кўринмайди.

### 🟡 [P1] Чекни (тўловни) фақат КАССИР ёпади — роль назорати

- **Манба:** LIMONARIYA-SPEC-TOLIQ §5.3 «КАССИР Ёпиш босади» + PLAN-uz Rollar
- **Далил:** apps/api/src/router.ts:1743-1768 pos.close = protectedProcedure, роль текширилмайди (официант ҳам тўлов билан ёпа олади); фақат comp (текин) учун director/manager/cashier чеклови бор (1760-1762)
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — apps/api/src/router.ts:1743 pos.close = protectedProcedure — тўловли ёпишда роль текшируви йўқ (waiter ҳам ёпа олади); роль фақат comp учун: 1760-1762 director/manager/cashier. UI ҳам фақат comp'ни чеклайди: apps/web/src/Pos.tsx:416 canComp; pay тугмалари ҳамма роллга очиқ (473-486).

### 🟡 [P2] Кўп-тўлов (multi-tender): бир чекда бир неча тур аралаш (мас. 200к нақд + 100к қарз)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §5.3 + Milestone 4 (QURISH-REJASI)
- **Далил:** Сервер массив қабул қилади: apps/api/src/router.ts:1747-1754; лекин UI фақат битта усул юборади: apps/web/src/Pos.tsx:478 payments:[{method, amount:order.total}] — аралаш тўлов экрани йўқ
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Сервер массив қабул қилади: apps/api/src/router.ts:1747-1754 (z.array of {method,amount}) ва 1790-1793 ҳаммасини orderPayments'га ёзади. Лекин UI'да ягона close.mutate чақириқлари: apps/web/src/Pos.tsx:478 (битта method, amount=order.total) ва :493 (comp) — аралаш-тўлов экрани/сплит йўқ (грепда бошқа close.mutate жойи йўқ).

### 🟡 [P2] Камомад оқими: кассир санайди → директор ТАСДИҚлайди (икки босқич)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §5.5, §8.8
- **Далил:** apps/api/src/router.ts:2286,2316 — tillCount get/set иккиси ҳам directorProcedure: кассир санай олмайди, тасдиқ босқичи йўқ (директор ўзи киритади-ўзи кўради)
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Саноқ+камомад бор: tillCounts (schema.ts:392-400), variance (router.ts:2311). Лекин tillCount.get (router.ts:2286) ва set (2316) иккиси ҳам directorProcedure (trpc.ts:14-15 — фақат director) → кассир сана олмайди, submit/approve икки босқичи йўқ (солиштиринг: инвентаризацияда бор — inventoryCountStatus schema.ts:402-406, кассада йўқ).

### 🟡 [P2] 💵 Кунлик иш ҳақи — АЛОҲИДА экран: ходимни белгила → сумма (салатчи/повар/шашликчи ҳар куни)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §8.5 + QURISH-REJASI Milestone 5
- **Далил:** ish_haqi категорияси бор (schema.ts:346), лекин ходим танлаш экрани йўқ — фақат умумий сумма + изоҳ (Moliya.tsx:410-451); ходимга боғлаш мавжуд эмас
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — ish_haqi категорияси бор: apps/api/src/db/schema.ts:346. Лекин expenses жадвалида employeeId йўқ (schema.ts:352-369, фақат createdById); форма фақат категория+сумма+изоҳ (apps/web/src/Moliya.tsx:382-451, ходим танлаш элементи йўқ); expenses.create input'ида ҳам ходим параметри йўқ (router.ts:2110-2118).

### 🟡 [P2] Инкассация: кун ичи кассадан пул олиш = изоҳ билан ёзиладиган ҳаракат

- **Манба:** teshiklar-nazorat №15 + RUSTAM-AKA «Кейинги ишлар» №9
- **Далил:** Махсус инкассация тури йўқ; воситачи сифатида expenses (method=cash + note) ишлайди ва expectedCash'ни тўғри камайтиради (apps/api/src/router.ts:265-279), лекин фақат директор киритади ва «инкассация» деб ажратилмайди
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — /usr/bin/grep -ria 'inkass|инкасс' — бўш, махсус тур йўқ. Воситачи: expenses (method='cash'+note, schema.ts:352-369) expectedCash'ни тўғри камайтиради (router.ts:265-279), лекин фақат directorProcedure киритади (2109) ва «инкассация» деб категорияланмайди (schema.ts:342-349 да бундай категория йўқ).

### 🟡 [P3] Ҳар қарз: 🧾 чек + 💬 изоҳ + 📲 SMS эслатма + 🚦 рейтинг (🟢🟡🔴)

- **Манба:** QURISH-REJASI Milestone 5 + LIMONARIYA-SPEC-TOLIQ §5.4
- **Далил:** Чек боғи (orderId) ва изоҳ бор: apps/api/src/db/schema.ts:377-383; SMS эслатма ва мижоз рейтинги кодда йўқ (grep бўш)
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Чек боғи бор: debtPayments.orderId + note устуни apps/api/src/db/schema.ts:373-389. ЛЕКИН note ҳатто тўлдирилмайди — payGuestDebt input'ида note йўқ (router.ts:2232-2238) ва UI ҳам юбормайди (Moliya.tsx:605-609); SMS/эслатма/рейтинг: /usr/bin/grep -ria 'sms|eslatma|эслатма|reyting|рейтинг' — бўш.

### 🟡 [P3] Сигнал пороглари скользящая медиана асосида (хардкод эмас)

- **Манба:** moliyaviy-tahlil §7 «Пороги — на скользящей медиане»
- **Далил:** apps/api/src/router.ts:402-407 — BREAK_EVEN_HINT/BLENDED_COGS/COMP_CAP қотириб ёзилган (коммент: «phase-1: hardcoded, not a sliding median»); фақат гўшт нархи сигнали медианадан (router.ts:501-523)
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — apps/api/src/router.ts:402-407 BREAK_EVEN_HINT=8_900_000, BLENDED_COGS_PCT, THIN_MARGIN_PCT, MEAT_PRICE_SPIKE_PCT, COMP_DAILY_CAP — қотирилган, комментнинг ўзи тан олади: «phase-1: hardcoded, not a sliding median» (402). Медиана фақат гўшт нархи спайкида: router.ts:501-523 (охирги 10 обвалка медианаси).

### ✅ [P0] Тўлов турлари: Нақд / Пластик(карта) / Клик / Payme / Қарз — чек ёпишда танланади, касса журналида ҳар тур алоҳида ажралади

- **Манба:** LIMONARIYA-SPEC-TOLIQ §5.3 + PLAN-uz «To'lov turlari»
- **Далил:** apps/api/src/db/schema.ts:259-274 paymentMethod enum + orderPayments; apps/api/src/router.ts:596-618 byMethod ажратиш; apps/web/src/Moliya.tsx:158-168 «Тўлов турлари» блоки; apps/web/src/Pos.tsx:825-835 тўлов модали. Хумо тури йўқ (алоҳида қаторда)

### ✅ [P0] Касса камомади назорати: реал саналган ↔ кутилган нақд → камомад директорга кўринади (сигнал №3)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §5.5 + teshiklar-nazorat №10 + moliyaviy-tahlil §7 сигнал 3
- **Далил:** apps/api/src/db/schema.ts:392-400 tillCounts (кунига битта саноқ); apps/api/src/router.ts:2285-2343 tillCount.get/set + variance; 474-486 computeSignals.cashVariance; apps/web/src/Moliya.tsx:252-308 «Касса санаш (камомад)»; apps/web/src/Analitika.tsx:115-127 «💰 Касса камомади» сигнал блоки

### ✅ [P0] ⭐ P&L ажратиш: бозорлик→COGS (фақат сотилгандагина), иш ҳақи/коммунал→OPEX → СОФ ФОЙДА (реал)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §8.5 + QURISH-REJASI Milestone 5
- **Далил:** apps/api/src/router.ts:596-668 financeForWindow: COGS sale_writeoff ҳаракатларидан, OPEX expenses'дан, sofFoyda = тушум − COGS − OPEX − 4% солиқ; харид харажат эмас (router.ts:2062-2072 фақат омбор+нарх); apps/web/src/Moliya.tsx:461-511 P&L таб + cogsPartial ⚠️ огоҳи

### ✅ [P0] Молия/фойда фақат директорга (кассир-официант таннарх ва фойдани кўрмайди)

- **Манба:** PLAN-uz «Rollar va PIN» + LIMONARIYA-SPEC-TOLIQ §13
- **Далил:** apps/api/src/router.ts:2080,2109,2150,2162,2183,2286 — expenses/dayClose/pnl/debts/tillCount ҳаммаси directorProcedure; payGuestDebt/paySupplier роль рўйхати билан (2241,2354); apps/web/src/Shell.tsx:76 «Молия» таб фақат isDirector

### ✅ [P1] Қарз running-баланси ўзи ҳисобланади, қисман тўлаш мумкин, лимит йўқ, ўзгармас журнал; кассир очади/ёпади, директор ҳаммасини кўради; қарз бўлса ҳам гўшт списание бўлади

- **Манба:** PLAN-uz «Qarz daftari» + LIMONARIYA-SPEC-TOLIQ §5.4
- **Далил:** apps/api/src/db/schema.ts:373-389 debtPayments append-only; apps/api/src/router.ts:2201-2227 outstanding = debt − Σтўловлар; 2243-2282 payGuestDebt (row-lock + over-pay ҳимояси, роль: director/manager/cashier); 1788-1905 списание тўлов туридан қатъи назар; apps/web/src/Moliya.tsx:582-628 директор рўйхати

### ✅ [P1] Етказиб берувчи (supplier) қарзи: харид қарзга олинади, қолдиқ ledger, кейин тўлаш

- **Манба:** LIMONARIYA-SPEC-TOLIQ §5.1 (тўлов нақд/қарз) + RUSTAM-AKA «Молия кенгайтириш»
- **Далил:** apps/api/src/db/schema.ts:281 paidTotal (қарз = total − paidTotal); apps/api/src/router.ts:2183-2199 finance.debts supplier рўйхати; 2346-2390 paySupplier (атомик, over-pay ҳимояси); apps/web/src/Moliya.tsx:544-580 «Биз қарздормиз» UI

### ✅ [P1] Кунлик OPEX/харажат киритиш категориялар билан (газ / свет / ойлик / ижара / коммунал ...)

- **Манба:** QURISH-REJASI Milestone 5 + PLAN-uz «kunlik xarajatlar» + moliyaviy-tahlil §1
- **Далил:** apps/api/src/db/schema.ts:342-369 expenseCategory (ijara/gaz/elektr/ish_haqi/jihoz/boshqa) + expenses (method, recurring, spentAt 06:00 ойнасида); apps/api/src/router.ts:2079-2148 list/create/delete; apps/web/src/Moliya.tsx:321-452 категория тугмалари. Сув/кўмир алоҳида категория йўқ («бошқа» орқали)

### ✅ [P1] Кун чегараси 06:00 (Asia/Tashkent) — тушум/чиқим/қарз/камомад 06:00дан 06:00гача ҳисобланади

- **Манба:** PLAN.md «День закрывается в 06:00» + LIMONARIYA-SPEC-TOLIQ §1
- **Далил:** apps/api/src/time.ts:1-31 businessDayBounds (06:00 Tashkent = 01:00 UTC); барча молия агрегатлари шу ойнада (router.ts:2087-2101, 2157); клиент ҳам мос: apps/web/src/Moliya.tsx:24-30 todayBiz()

### ✅ [P1] Зарарсизлик нуқтаси: break-even ҳисоби + «кунлик тушум < ~9 млн = қизил» сигнали (сигнал №4)

- **Манба:** moliyaviy-tahlil §6-7 + LIMONARIYA-SPEC-TOLIQ §11
- **Далил:** apps/api/src/router.ts:403 BREAK_EVEN_HINT=8 900 000; 488-493 breakEvenFlag (кечаги ёпиқ кун); 2169-2180 pnl.breakEvenPerDay динамик (OPEX/кун ÷ (1−COGS улуши)); apps/web/src/Analitika.tsx:129-138 сигнал; apps/web/src/Hisobot.tsx:127,136 тренд ранги

### ✅ [P1] Меҳмон қарзи реализация қилинмаган тушум ЭМАС — фойда/тушумдан четда, алоҳида кўрсатилади («Пул vs Ҳақиқий фойда» асоси)

- **Манба:** PLAN-uz «Pul ham, haqiqiy foyda ham» + LIMONARIYA-SPEC-TOLIQ §11
- **Далил:** apps/api/src/router.ts:612-618 debt тушумга қўшилмайди, guestDebt алоҳида; 2681-2690 digest supplierDebt/guestDebt; apps/web/src/Moliya.tsx:166 «Меҳмон қарзи (олинмаган)»; apps/web/src/Analitika.tsx:62 «Қарз» карточкаси. Омбор қийматини қўшган тўлиқ «пул vs реал фойда» экрани эса йўқ

### ✅ [P1] Хизмат ҳақи ҳар зал авто: Асосий 10% · Катта 10% · Терраса 15% · Собой 0% — чекка ўзи қўшилади

- **Манба:** LIMONARIYA-SPEC-TOLIQ §5.3 + HOLAT-davom-ettirish «қарорлар»
- **Далил:** apps/api/src/db/import-halls.ts:6-11 (эга тасдиқлаган фоизлар); apps/api/src/db/schema.ts:168-169,194 halls.servicePct → orders.servicePct snapshot; apps/api/src/router.ts:1551-1560 total = subtotal + service; apps/web/src/Pos.tsx:701-706 чекда кўрсатилади

### ✅ [P1] Текин/ходим овқати назорати: сабаб мажбурий + кунлик ҳажм лимити ошса 🚩 (тешик №20)

- **Манба:** teshiklar-nazorat №20 + RUSTAM-AKA §5
- **Далил:** apps/api/src/db/schema.ts:203-204 isComp+compReason; apps/api/src/router.ts:1755 reason min(1) мажбурий, 1760-1767 роль чеклови + тўлов тақиқи; 407 COMP_DAILY_CAP=500к, 562-580 compToday/compFlag сигнали (меню нархида баҳоланади)

### ✅ [P2] Валюта: фақат UZS, бутун сон (тийинсиз), Math.round

- **Манба:** LIMONARIYA-SPEC-TOLIQ §2
- **Далил:** Барча пул устунлари integer: apps/api/src/db/schema.ts:93 (price), 273 (amount), 357 (amount); яхлитлаш: apps/api/src/router.ts:617, 2027; ҳеч қаерда каср/бошқа валюта йўқ

### ✅ [P2] 4% солиқ фақат электрон тўловлардан (карта/Click/Payme) — переменный расход

- **Манба:** moliyaviy-tahlil §3 «4% налог — только с карт/Click»
- **Далил:** apps/api/src/router.ts:615-617 cardTax = (card+click+payme) × 4%; sofFoyda'дан айирилади (649); apps/web/src/Moliya.tsx:165 «Солиқ (4% карта)» қатори

---

## 📊 Аналитика / Аномалия движок (MOAT)

_25 талаб: ✅ 10 · 🟡 9 · ❌ 6_

### ❌ [P0] «Ҳисобланган сих ↔ қўлда киритилган сих» солиштируви — сих грамм назорати (10кг÷грамм=кутилган сон, фарқ катта бўлса 🚩)

- **Манба:** QURISH-REJASI M3; LIMONARIYA-SPEC-TOLIQ §7; teshiklar-nazorat №4 (энг катта миқдорий оқма +30г≈22–28 млн/ой)
- **Далил:** Sikh/vitrina moduli kodda umuman yo'q (grep сих/vitrina/витрина apps/api+apps/web: faqat texkarta-seed matni); 3 bosqichli qoldiq ham yo'q — RUSTAM doc ham buni «keyingi ishlar №1» deb tan oladi
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — REFUTE bo'lmadi. Grep сих/sikh/витрин/vitrin/шампур (apps/api/src + apps/web/src): yagona topilma texkarta-seed.json:1133 dagi "unit": "сих" (seed matni). Kutilgan-sikh-soni hisobi, qo'lda kiritish formasi, farq flagi, vitrina 3-bosqichli qoldiq — hech biri kodda yo'q.

### ❌ [P1] Бозорчи кам келтириш → харид↔обвалка солиштируви 🚩 + барча харидга нарх аномалияси

- **Манба:** teshiklar-nazorat.md №17,№18; LIMONARIYA-SPEC-TOLIQ §12 ①③
- **Далил:** purchase.create (router.ts:1939-2078) faqat kirim+costPrice yangilaydi — xarid og'irligi↔obvalka taqqoslash yo'q, ingredient narx anomaliyasi yo'q, geolokatsiya yo'q (grep: 0 natija). RUSTAM doc «✅ bor» deb da'vo qiladi — kodda tasdiqlanmadi
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — MISSING emas — ikkita real qism bor: (1) balanceFlag (obvalka-calc.ts:19-20,50): kiritilgan tusha og'irligi vs qismlar yig'indisi ±5% dan farq qilsa 🔴 — bu «kam keltirish»ni ushlaydigan mexanizm, computeSignals obvalkaFlags orqali Analitika'da (router.ts:424-458, Analitika.tsx:72-95); (2) go'sht narx anomaliyasi: oxirgi narx vs 10-obvalka mediani +15% → priceSpikes (router.ts:495-523, MEAT_PRICE_SPIKE_PCT:406). LEKIN purchase.create (router.ts:1979-2075) oddiy ingredient xaridiga hech qanday narx-anomaliya tekshiruvi qo'ymaydi (costPrice shunchaki yangilanadi:2027-2032), xarid modulida obvalka bilan solishtirish yo'q (1940: «meat comes via obvalka»), geolokatsiya yo'q. «Barcha xaridga» qismi bajarilmagan.

### ❌ [P2] Бозорчи кунлик бюджет лимити огоҳи

- **Манба:** teshiklar-nazorat.md №19; LIMONARIYA-SPEC-TOLIQ §12 ④
- **Далил:** Kod bazasida budget/бюджет/лимит so'zlari bo'yicha hech narsa yo'q (grep apps/api+apps/web: 0)
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — REFUTE bo'lmadi. Grep budget/бюджет/лимит/dailyLimit (apps/api/src + apps/web/src): yagona topilma COMP_DAILY_CAP=500_000 (router.ts:407,580) va Analitika.tsx:182 — bu текин/ходим OVQAT limiti, xarid byudjeti emas. purchase.create (router.ts:1979-2075) da hech qanday summa cheklovi/ogohlantirish yo'q.

### ❌ [P2] Критик тешик → директорга дарров push (Telegram bot: 🔴 огоҳ + кечки хулоса)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §10 №9, §17.4; QURISH-REJASI M6
- **Далил:** telegram/push/notification bo'yicha kodda hech narsa yo'q (grep apps/api+apps/web: 0); roadmap'da «keyingi ishlar» deb turibdi
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — REFUTE bo'lmadi. Grep telegram/notif/bot/push (apps/api/src + apps/web/src): nol tegishli natija (faqat Array.push va h.k.). Hech qanday tashqi xabar yuborish integratsiyasi yo'q; signallar faqat direktor sahifani ochganda pull qilinadi (Analitika.tsx:42).

### ❌ [P2] Қассоб/етказувчи таққослаш ва рейтинги (суяк % ва чиқим бўйича)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §12 ⑤ (қассоб рейтинги); teshiklar-nazorat №18
- **Далил:** obvalka.supplier saqlanadi (router.ts:1288,1309) va ro'yxatda ko'rinadi, lekin per-supplier suyak%/chiqim taqqoslash, reyting yoki hisobot HECH QAYERDA yo'q — maydon faqat yozilib qo'yiladi
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — REFUTE bo'lmadi. obvalka.supplier saqlanadi va ro'yxatda qaytariladi (router.ts:1234, 1276, 1288, 1309, 1424), lekin supplier bo'yicha groupBy faqat QARZ hisobida bor (finance.debts:2184-2199 — moliyaviy, sifat emas). Suyak%/chiqim bo'yicha per-supplier taqqoslash, reyting yoki hisobot endpointi/UI umuman yo'q — maydon yozilib qo'yiladi xolos.

### ❌ [P3] Башорат + АҚЛ даражаси: таом фойда таҳлили (⭐юлдуз/🐴от/❓жумбоқ/🐕ит), «директор мияси» AI брифинг, what-if симулятор

- **Манба:** LIMONARIYA-SPEC-TOLIQ §17 (2-3 босқич)
- **Далил:** Kodda hech qanday bashorat/AI-brifing/what-if yo'q; spec'da ham 2-3 bosqichga rejalangan
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — REFUTE bo'lmadi. Grep forecast/башорат/bashorat/what-if/simul/юлдуз/жумбоқ/briefing (apps/api/src + apps/web/src): nol tegishli natija (faqat 'start' so'zidagi false-positive'lar). BCG-matritsa klassifikatsiyasi, AI brifing yoki simulyator kodda mavjud emas.

### 🟡 [P0] P&L ажратиш: бозорлик→COGS (сотилгандагина) · иш ҳақи/коммунал→OPEX · эга олди→тақсимот → реал соф фойда

- **Манба:** QURISH-REJASI M5 ⭐; LIMONARIYA-SPEC-TOLIQ §8.5
- **Далил:** financeForWindow: revenue−COGS−OPEX−cardTax=sofFoyda (router.ts:596-668); COGS sale_writeoff harakatlaridan baholanadi (cogsForWindow:188-229, qisman-COGS flagi:658-663); finance.pnl:2162-2181 + Moliya.tsx P&L tab. LEKIN «эга олди» kategoriyasi umuman YO'Q (expense enum: ijara/gaz/elektr/ish_haqi/jihoz/boshqa — router.ts:2112, schema.ts:342) — egan olgan pul tushirilsa «boshqa»ga tushib foydani buzadi
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — P&L skeleti bor: financeForWindow revenue−COGS−OPEX−cardTax=sofFoyda (apps/api/src/router.ts:596-668), COGS sale_writeoff'dan (cogsForWindow:188-229) + cogsPartial flagi (660-661), finance.pnl (2162-2181) + Moliya.tsx P&L. LEKIN expense enum = ijara/gaz/elektr/ish_haqi/jihoz/boshqa (router.ts:2112, schema.ts) — «эга олди»/owner-draw/тақсимот kategoriyasi yo'q (grep эга/taqsim/dividend: faqat Moliya.tsx:505 dagi izoh matni). Ega pul olsa «boshqa»ga tushib OPEX/foydani buzadi. REFUTE bo'lmadi.

### 🟡 [P1] Норма тарихдан ўрганилади — динамик (обвалка тарихидан ҳар қисм учун normal chiqim, sliding median)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §6; PLAN-uz.md «Dastur normani O'ZI o'rganadi»; QURISH M2 (obvalka-history.json dan norma)
- **Далил:** Statik diapazonlar bor: partTypes.normMinPct/normMaxPct docs/obvalka-normalar.md dan import (apps/api/src/db/import-parttypes.ts:6-63), outOfNorm flag ishlaydi (obvalka-calc.ts:30-33, UI Obvalka.tsx:256-270). LEKIN router.ts:402 izoh: «phase-1: hardcoded, not a sliding median» — tarixdan o'z-o'zini o'rganish YO'Q
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Statik normalar ishlaydi: partTypes normMinPct/normMaxPct docs/obvalka-normalar.md dan qattiq kodlangan (apps/api/src/db/import-parttypes.ts:6-63), outOfNorm flag (apps/api/src/obvalka-calc.ts:28-43). apps/api/src/router.ts:402 izohi ochiq tan oladi: «phase-1: hardcoded, not a sliding median». Sliding median KOD DA bor, lekin faqat go'sht NARXI uchun (router.ts:508-514, oxirgi 10 obvalka narxi mediani) — qism-og'irlik normalari tarixdan hech qachon qayta hisoblanmaydi. REFUTE bo'lmadi.

### 🟡 [P1] Реал 1 кг гўшт таннархи — «охирги обвалкалардан ўртача»

- **Манба:** RUSTAM-AKA-BAJARILGAN-ISHLAR.md §3
- **Далил:** latestMeatCost faqat ENG OXIRGI bitta obvalkadan oladi (router.ts:56-64 .limit(1)) — o'rtacha emas; doc da'vosi noto'g'ri, bitta g'ayrioddiy obvalka butun taom marjasini buzadi
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — latestMeatCost (apps/api/src/router.ts:56-64) .orderBy(desc(createdAt)).limit(1) — faqat ENG OXIRGI bitta obvalka; 55-qator izohi ham «cost of the latest recorded carcass» deydi. Hech qayerda bir nechta obvalka bo'yicha o'rtacha yo'q (avg/median faqat priceSpikes signalida, tannarxda emas). Per-kg real cost mavjud (sellable qismlarga taqsimlash obvalka-calc.ts:24-26 to'g'ri), lekin «o'rtacha» qismi yo'q. REFUTE bo'lmadi.

### 🟡 [P1] Ҳар таомнинг реал таннархи (техкарта + гўшт нархи) — жонли

- **Манба:** RUSTAM-AKA-BAJARILGAN-ISHLAR §4; LIMONARIYA-SPEC-TOLIQ §8
- **Далил:** computeDishTaannarx (router.ts:93-167) FAQAT go'sht ingredientlarini narxlaydi (carcassOf regex 127-136); go'shtsiz ingredientlar (guruch, sabzavot — products.costPrice xariddan yangilanadi) taom tannarxiga KIRMAYDI → «real tannarx» aslida «go'sht tannarxi»
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — computeDishTaannarx (apps/api/src/router.ts:93-167) faqat carcassOf regex (127-136: /обвалка|лаҳм|гўшт/) o'tgan ingredientlarni narxlaydi; qaytariladigan maydonlar ham meatCostTotal/meatPct (154-165). products.costPrice (xariddan yangilanadi, router.ts:2027-2032) taom tannarxiga qo'shilmaydi — barcha chaqiruvchilar (router.ts:1370, 2802, 461) shu bitta funksiyani ishlatadi. Go'shtsiz ingredient narxlash hech qayerda yo'q. REFUTE bo'lmadi.

### 🟡 [P1] Директор панели: кунлик 4 рақам — 💵Тушум · 📈Соф фойда · 🧾Қарз · 🏆Топ таом

- **Манба:** LIMONARIYA-SPEC-TOLIQ §11; PLAN-uz.md «Kunlik 4 raqam»
- **Далил:** analytics.digest (router.ts:2659-2689): Тушум ✓, соф фойда faqat TAXMINIY (blended 52.6% COGS, BLENDED_COGS_PCT:404 — real COGS emas), Қарз ✓; 4-karta «Аномалия» (Analitika.tsx:54-62) — «Топ таом» digest kartasida YO'Q (alohida Ҳисобот tabida bor)
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — analytics.digest (apps/api/src/router.ts:2659-2689): revenueToday ✓, debtToday ✓ (supplier+guest), lekin estProfit = revenue×52.6% blended taxmin (2662-2663, BLENDED_COGS_PCT:404) — real COGS emas, UI ham «COGS тахминий» deb yozadi (Analitika.tsx:58). 4-karta «Аномалия» (Analitika.tsx:61) — «Топ таом» digest'da YO'Q; report.topDishes mavjud lekin alohida Ҳисобот tabida (router.ts:2764, Hisobot.tsx:181-188). REFUTE bo'lmadi.

### 🟡 [P1] Тешиклар движок (23 та) — барча 🚩 сигнал битта рўйхатда, директор эрталаб очади

- **Манба:** LIMONARIYA-SPEC-TOLIQ §10; teshiklar-nazorat.md (23 teshik xaritasi)
- **Далил:** computeSignals (router.ts:409-594) bitta Analitika sahifasida 7-8 signal: obvalka balans/norma, yupqa marja, kassa kamomad, break-even, narx sakrash, takroriy kamomad, tekin limit + anomalyCount:2670-2677. 23 dan ~8 tasi ishlaydi; vozvrat trendi, ochiq stol, inkassatsiya, dublikat chop, sikh gramm, ichimlik — kodda yo'q
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — computeSignals (apps/api/src/router.ts:409-594) bitta Analitika sahifasida 7 signal guruhi: obvalka balans+norma, yupqa marja, kassa kamomad, break-even, go'sht narx sakrashi, takroriy kamomad, tekin/xodim limiti + anomalyCount (2670-2677). Grep vozvrat/возврат/void/инкасс/дубликат/reprint/сих: 0 tegishli natija — vozvrat trendi, ochiq stol, inkassatsiya, dublikat chop, sikh gramm signallari kodda yo'q. ~7-8/23. REFUTE bo'lmadi.

### 🟡 [P2] Мариновка ўсиши (+13–30%) + йўқотиш % ҳисоби

- **Манба:** QURISH-REJASI M2; LIMONARIYA-SPEC-TOLIQ §6,§8
- **Далил:** lossPct/lossG hisoblanadi va ko'rsatiladi (obvalka-calc.ts:19-20); marinade faqat matn ustuni sifatida saqlanadi (schema.ts:110, texkarta-seed.json «13% купаяди») — hech qayerda tannarx/chiqim hisobida ISHLATILMAYDI
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — lossG/lossPct hisoblanadi va flag qilinadi (apps/api/src/obvalka-calc.ts:18-20, balanceFlag:50). marinade — faqat text ustun (apps/api/src/db/schema.ts:110) + seed matni (texkarta-seed.json «13% купаяди»); grep bo'yicha router.ts va apps/web da marinade ni O'QIYDIGAN kod nol. recipes.yieldG mavjud (router.ts:1084-1159), lekin computeDishTaannarx uni ishlatmaydi (Taannarx.tsx:29 izohi: «batch >100% → needs yield»). Marinovka o'sishi hech qanday hisobda qo'llanmaydi. REFUTE bo'lmadi.

### 🟡 [P2] Омбор светофори 🟢🟡🔴 (авто, тарихдан) — остаток директор панелида доим кўриниб

- **Манба:** QURISH-REJASI M3; LIMONARIYA-SPEC-TOLIQ §11 📦
- **Далил:** Faqat manfiy qoldiq qizil: Ombor.tsx:62-64, digest.lowStock=onHand<0 soni (router.ts:2667) + Analitika ogohi:65-69. Tarixiy iste'moldan 3 darajali (tugayapti/kam/yetarli) svetofor YO'Q
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Faqat 1 daraja: onHand<0 → qizil matn (apps/web/src/Ombor.tsx:61-64); digest.lowStock = onHand<0 soni (router.ts:2666-2667) + Analitika amber banner (Analitika.tsx:65-69). Tarixiy iste'mol tezligidan 3 darajali (yashil/sariq/qizil) thresholdlar hech qayerda hisoblanmaydi. REFUTE bo'lmadi.

### 🟡 [P2] Пул vs Ҳақиқий фойда (касса + қарз + омбор қиймати)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §11 💰; PLAN-uz «Pul ham, haqiqiy foyda ham»
- **Далил:** Pul rasmi bor: byMethod (financeForWindow:608-618, qarz revenue'dan chiqarilgan:613), qarzlar alohida (finance.debts:2183-2229). LEKIN omborda qolgan mahsulot QIYMATI hech qayerda hisoblanmaydi — «haqiqiy foyda» formulasining ombor komponenti yo'q
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Pul rasmi bor: byMethod (router.ts:608-618, debt revenue'dan chiqarilgan:612-613), finance.debts supplier+guest (2183-2229). LEKIN ombor QIYMATI hech qayerda yig'ilmaydi: grep қиймат/stockValue/valuation: 0; valuePortion (router.ts:173-183) faqat COGS (215) va inventarizatsiya farqi (2514) uchun ishlatiladi — on-hand qoldiqni pulda baholab ko'rsatish yo'q. REFUTE bo'lmadi.

### ✅ [P0] ±5% вазн баланси обвалкада — ошса 🚩 (гўштни кам тортиш/яшириш назорати)

- **Манба:** QURISH-REJASI-1bosqich.md M2; teshiklar-nazorat.md №1
- **Далил:** apps/api/src/obvalka-calc.ts:50 balanceFlag=|lossPct|>5; jonli farq ko'rsatkichi apps/web/src/Obvalka.tsx:171-184 (qizil >5%); natijada 🔴 текшир Obvalka.tsx:229-233; signalga chiqadi router.ts:447-457 (computeSignals obvalkaFlags)

### ✅ [P0] Таннарх движок: туша нархи сотиладиган қисмларга тарқалади, суяк/чарви/брак cost=0 → реал 1кг гўшт таннархи

- **Манба:** QURISH-REJASI M2 (ЯДРО); LIMONARIYA-SPEC-TOLIQ §6; PLAN.md misol
- **Далил:** apps/api/src/obvalka-calc.ts:11-26 (totalCost faqat sellableG ga bo'linadi, isWaste costPerKg=0 qator 42); UI «РЕАЛ ТАННАРХ» Obvalka.tsx:235-240; omborga faqat sellable kirim router.ts:1333-1357

### ✅ [P0] Туша нархини ошириб ёзиш → нарх аномалияси (тарихдан медиана)

- **Манба:** teshiklar-nazorat.md №3; LIMONARIYA-SPEC-TOLIQ §12 ①
- **Далил:** priceSpikes: oxirgi narx vs avvalgi 10 tasining mediani, +15% chegara (router.ts:495-523, MEAT_PRICE_SPIKE_PCT=1.15:406); UI «Гўшт нархи сакраши» Analitika.tsx:141-157. Faqat qo'y/mol tushasi uchun

### ✅ [P0] Касса камомади сигнали: кутилган нақд ↔ саналган → директорга

- **Манба:** teshiklar-nazorat.md №10; LIMONARIYA-SPEC-TOLIQ 5.5
- **Далил:** expectedCashForWindow router.ts:234+, tillCounts + cashVariance computeSignals:474-486, finance.tillCount.get/set:2285-2345; UI «💰 Касса камомади» Analitika.tsx:115-127, Moliya kassa sanash

### ✅ [P1] «Юпқа маржали таомлар» огоҳи (гўшт нархи катта улуш эгаллаган таомлар)

- **Манба:** RUSTAM-AKA-BAJARILGAN-ISHLAR §4
- **Далил:** THIN_MARGIN_PCT=60 router.ts:405; thinDishes computeSignals:462-472 va dashboard.summary:1434-1443; UI Taannarx.tsx:64,97 (⚠️ ≥60%), Dashboard.tsx:65-84, Analitika.tsx:97-113

### ✅ [P1] Зарарсизлик нуқтаси: «бугун ~8.9 млн чизиқдан ўтдими» + break-even ҳисоби

- **Манба:** LIMONARIYA-SPEC-TOLIQ §11 📉; PLAN.md «Аналитика (директор)»; PLAN-uz «Zararsizlik nuqtasi»
- **Далил:** BREAK_EVEN_HINT=8_900_000 router.ts:403; breakEvenFlag kechagi yopiq kun bo'yicha:488-493; dinamik pnl.breakEvenPerDay=opex/(1−COGS ulushi):2179; trend ustunlari rangi Hisobot.tsx:127,136; Moliya.tsx:501. Eslatma: signal chegarasi hardcoded, OPEXdan avtomatik emas

### ✅ [P1] Топ таомлар — энг кўп сотилган ва энг фойдали (фойда бўйича saralash)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §11 🏆; RUSTAM-AKA §10
- **Далил:** report.topDishes qty/profit bo'yicha (router.ts:2764-2827; profit=revenue−go'sht tannarxi, batch>100% va narxsiz go'sht chiqarib tashlangan:2803-2815); UI Hisobot.tsx:181-242 «Фойда бўйича / Сотув бўйича». Foyda taxminiy (joriy go'sht narxi, faqat go'sht cost)

### ✅ [P1] Сотув тренди + категория улуши + официантлар кесими

- **Манба:** RUSTAM-AKA-BAJARILGAN-ISHLAR §10
- **Далил:** report.salesDaily (14 kun, router.ts:2693-2710), byCategory (%ulush:2712-2762), byWaiter:2829-2877; UI Hisobot.tsx 4 tab (Тренд/Категория/Топ таомлар/Официантлар)

### ✅ [P1] Ходим овқати (текин) ҳажм назорати — кунлик лимит/тренд, ошса 🚩

- **Манба:** teshiklar-nazorat.md №20; RUSTAM-AKA «Ходим овқати → текин категорияси»
- **Далил:** COMP_DAILY_CAP=500_000 router.ts:407; compToday (menyu narxida) + compFlag:562-580; UI «🎁 Текин/ходим овқати» Analitika.tsx:174-184; comp cheklar checks hisobidan chiqarilgan:628

### ✅ [P1] Такрорий камомад детектори — инвентаризация тарихидан такрор кам чиқаётган маҳсулот 🚩

- **Манба:** PLAN-uz «Ortiqcha spisaniye»; RUSTAM-AKA §10 «тизим ўзи тешик қидиради»
- **Далил:** shortagePattern: oxirgi 5 tasdiqlangan sanashda ≥2 marta manfiy tuzatish olgan mahsulotlar (router.ts:525-560, historyPending holati bilan); UI «📦 Такрорий камомад» Analitika.tsx:159-172

---

## 📈 Ҳисобот / Telegram

_14 талаб: ✅ 5 · 🟡 5 · ❌ 4_

### ❌ [P1] Ежедневная таблица (привычный вид «как Excel»): выбрал дату → приход / продажа / остаток по каждому продукту

- **Манба:** PLAN.md §Основные экраны (51-qator) + §Этапы модуль 3 (103-qator, «Полная замена Excel»)
- **Далил:** apps/web/src/Ombor.tsx (80 qator) faqat JORIY qoldiqni ko'rsatadi (trpc.stock.onHand), stock routeri ham faqat onHand: apps/api/src/router.ts:1916-1937. Sana tanlab kunlik prixod/prodaja/qoldiq jadvali — API'da ham, UI'da ham yo'q
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — REFUTE ATTEMPT FAILED: stock router has exactly one procedure — stock.onHand apps/api/src/router.ts:1916-1937 (sum of all stockMovements, current snapshot only, no date param); apps/web/src/Ombor.tsx:31 calls only trpc.stock.onHand. report router (router.ts:2692-2877) has no product-movement procedure. Closest thing checked: Inventarizatsiya.tsx (analytics.startCount/saveCount/approveCount) is a count-session expected-vs-counted sheet, not a date-selectable prixod/prodaja/qoldiq table. The stockMovements ledger holds the raw data, but no API or UI aggregates it per date+product. Missing confirmed.

### ❌ [P2] Telegram bot: критик тешик + кун охири ҳисобот → Telegram (egaga signal)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §17 «КЕЙИНГИ ДАРАЖА» 4-band (401-qator); RUSTAM-AKA-BAJARILGAN-ISHLAR.md «Кейинги ишлар» #4 (o'zi ham qilinmagan deydi)
- **Далил:** Kodda telegram izi umuman yo'q: grep -ri telegram apps/ docker/ docker-compose.yml — 0 natija; package.json'larda grammy/telegraf/node-telegram-bot-api yo'q (apps/api/package.json deps: hono/trpc/drizzle/postgres/zod xolos)
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — REFUTE ATTEMPT FAILED: grep -rniE 'telegram|grammy|telegraf|bot_token' across /Users/wer/projects/la_limonariya/apps, /src, /docker, docker-compose.yml, package.json → 0 hits (root src/ contains only img/). apps/api/package.json deps: hono, @hono/node-server, @hono/trpc-server, @trpc/server, drizzle-orm, postgres, zod — no bot library. apps/ contains only api and web, no bot service. Missing confirmed.

### ❌ [P2] Отчёты: ... выгрузка (hisobotni Excel/PDF eksport qilish)

- **Манба:** PLAN.md §Основные экраны «Отчёты» qatori (53-qator)
- **Далил:** Eksport kutubxonasi yo'q (xlsx/exceljs/pdfkit/csv — package.json'larda yo'q), frontendda download/Blob/createObjectURL/CSV tugmasi yo'q (grep apps/web/src — 0 natija). Hech bir hisobot ekranida yuklab olish yo'q
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — REFUTE ATTEMPT FAILED: grep -rniE 'xlsx|exceljs|pdfkit|jspdf|\.csv|download|Blob\(|createObjectURL' apps/web/src → exit 1 (zero hits); no export library in apps/web/package.json (react, trpc, tailwind, vite-plugin-pwa only) or apps/api/package.json. No download control on any report screen (Hisobot.tsx, Moliya.tsx). Missing confirmed.

### ❌ [P2] Сменада нақд олиш изсиз (инкассация): кун ичи кассадан пул олиш = ёзиладиган ҳаракат (изоҳ билан) — smena hisobotida ko'rinishi kerak

- **Манба:** teshiklar-nazorat.md №15 (39-qator); LIMONARIYA-SPEC-TOLIQ.md §10 teshiklar ro'yxatida «инкассация»
- **Далил:** Inkassatsiya tushunchasi kodda yo'q (grep инкассац/incass — 0). expectedCashForWindow (router.ts:234-281) faqat expenses jadvalini ayiradi — kun ichida direktor pul olsa, alohida iz qoldiradigan harakat turi yo'q (faqat oddiy xarajat sifatida yozish mumkin)
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — REFUTE ATTEMPT FAILED: grep инкасса/incass/withdraw/'pul olish' across api+web src → 0 hits. expenseCategory enum apps/api/src/db/schema.ts:342-349 = ijara/gaz/elektr/ish_haqi/jihoz/boshqa — no cash-collection/incassation type. expectedCashForWindow apps/api/src/router.ts:234-281 subtracts only the expenses table (router.ts:279: TILL_FLOAT + cashRevenue + cashDebtRepaid − cashExpenses); a mid-day owner cash pull can only be entered as a generic 'boshqa' expense with note — no dedicated traced movement type, and no shift report to surface it in. Missing confirmed.

### 🟡 [P0] СМЕНА (X/Z ҳисобот): очиш — кассир PIN + бошланғич нақд (50к); ёпиш — нақд саноқ → Z-ҳисобот (нақд/карта/клик/хумо/қарз алоҳида · чиқим · нечта чек · ўртача чек · камомад) → директор тасдиқ; X-ҳисобот оралиқ кўриш; топшириш — смена ёпиб-янгисини очиш

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §8 «СМЕНА (X/Z ҳисобот)» (291-294-қатор); RUSTAM-AKA-BAJARILGAN-ISHLAR.md «Кейинги ишлар» ҳам буни ҚИЛИНМАГАН деб тан олади
- **Далил:** Smena obyekti/ochish-yopish oqimi kodda YO'Q (grep shift/smena — faqat kommentlar). Kun darajasidagi ekvivalent bor: finance.dayClose apps/api/src/router.ts:2150-2160 + financeForWindow router.ts:596-668 (byMethod naqd/karta/click/payme/qarz alohida, checks, avgCheck), kassa sanash+kamomad finance.tillCount router.ts:2285-2343 (TILL_FLOAT=50_000 router.ts:232, expectedCashForWindow router.ts:234-281), UI apps/web/src/Moliya.tsx:211-245 (DayClose+TillCount). Lekin: kassir smena ochmaydi (tillCount.set/get — directorProcedure, router.ts:2286,2316), X oraliq hisobot yo'q, Z→direktor tasdiq workflow yo'q, smena topshirish yo'q
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — REFUTE ATTEMPT FAILED: grep shift/smena/смен across apps/api/src+apps/web/src → only a comment (router.ts:232 'start-of-shift register float') and UI date helpers named shiftDay (Moliya.tsx:31, Hisobot.tsx:11). No shift/smena table in db/schema.ts, no open/close lifecycle, no director-approval mutation. Day-level equivalent CONFIRMED present: finance.dayClose apps/api/src/router.ts:2150-2160 (query only, no confirm step), financeForWindow router.ts:596-668 (byMethod cash/card/click/payme/debt, checks, avgCheck), tillCount.get/set router.ts:2285-2344 — BOTH directorProcedure so a kassir cannot open/count, TILL_FLOAT=50_000 router.ts:232, expectedCashForWindow router.ts:234-281; UI DayClose+TillCount apps/web/src/Moliya.tsx:211-250. No X interim per-shift view (dayClose is per-business-day, director-only), no smena handover. Claim stands as partial.

### 🟡 [P1] Отчёты: Период → приход-расход, потери %, себестоимость, графики (davr bo'yicha hisobotlar to'plami)

- **Манба:** PLAN.md §Что мы предлагаем, «Основные экраны» jadvali (53-qator)
- **Далил:** Davr tanlash (from/to + 7/30 kun tez tugmalar) apps/web/src/Hisobot.tsx:56-63; grafik-trend Hisobot.tsx:120-137; report routeri apps/api/src/router.ts:2692-2877 (salesDaily/byCategory/topDishes/byWaiter). LEKIN davr bo'yicha prixod-rasxod (mahsulot kirdi-chiqdi) hisoboti yo'q, davr bo'yicha poteri % hisoboti yo'q (yo'qotish faqat bitta obvalka ichida — obvalka-calc.ts lossPct), eksport yo'q
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Period picker + 7/30-day quick buttons apps/web/src/Hisobot.tsx:56-64; bar-chart trend Hisobot.tsx:120-137; report router apps/api/src/router.ts:2692-2877 (salesDaily/byCategory/topDishes/byWaiter). PARTIAL-REFUTE: money-level приход-расход + себестоимость over an arbitrary period DOES exist — finance.pnl router.ts:2162-2181 (revenue/cogs/opex/sofFoyda over from..to) rendered with an explicit 'Себестоимость' card in apps/web/src/Moliya.tsx:461-513 (Pnl component with from/to + Бугун/7/30 buttons). Still missing: product-level kirdi-chiqdi report; потери % over period — lossPct exists only per single obvalka (apps/api/src/obvalka-calc.ts:20,49; shown Obvalka.tsx:231, Dashboard.tsx:100, Analitika.tsx:87), never aggregated by period; no export. Partial stands, but evidence should credit finance.pnl for money-level prixod-rasxod+sebestoimost.

### 🟡 [P1] Быстрые отчёты: за день, за месяц, по какому продукту убыток

- **Манба:** PLAN.md §Проблема (15-qator)
- **Далил:** Kunlik: finance.dayClose router.ts:2150-2160 + Moliya.tsx:211-240 (kun tanlash bilan); oylik/ixtiyoriy davr: finance.pnl router.ts:2162-2181 (dailyAvg, marginPct, breakEvenPerDay) va Hisobot 30-kun tugmasi Hisobot.tsx:59. «Qaysi mahsulot zarar» — report.topDishes profit (router.ts:2764-2827) manfiy foyda qizil ko'rsatiladi (Hisobot.tsx:231), LEKIN foyda faqat go'sht tannarxi asosida taxminiy (Hisobot.tsx:202 «жорий гўшт нархи асосида тахминланади») — to'liq mahsulot zarari emas
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Day: finance.dayClose router.ts:2150-2160 + DayClose with DayPicker apps/web/src/Moliya.tsx:211-237. Month/period: finance.pnl router.ts:2162-2181 (dailyAvg, marginPct, breakEvenPerDay) + 30-кун quick buttons Moliya.tsx:483-485 and Hisobot.tsx:59. Product loss: report.topDishes router.ts:2764-2827 computes profit = revenue − meatCostTotal only (latestMeatCost + computeDishTaannarx, router.ts:2801-2815); negative profit shown red at Hisobot.tsx:231 with explicit disclaimer Hisobot.tsx:202 'Фойда жорий гўшт нархи асосида тахминланади (тарихий эмас)'. Non-meat ingredients excluded → not a true per-product loss report. Partial confirmed.

### 🟡 [P1] A9 Директорга авто ҳисобот: кун охири push (тушум / фойда / тешик / штраф)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §9 «АДМИНИСТРАТОР/МЕНЕЖЕР назорати» (328-qator)
- **Далил:** Kun xulosasi hisoblanadi: analytics.digest apps/api/src/router.ts:2659-2689 (revenueToday, estProfit, anomalyCount, qarzlar) va Analitika.tsx:36-60 da ko'rsatiladi — lekin bu PULL (direktor o'zi ochishi kerak). PUSH mexanizmi yo'q: cron/scheduler yo'q (grep cron/setInterval — 0), web-push/Notification kodi yo'q, «shtraf» komponenti umuman yo'q (shtraf moduli qurilmagan)
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Digest computed: analytics.digest apps/api/src/router.ts:2659-2689 (revenueToday, estProfit, anomalyCount, supplierDebt/guestDebt, lowStock) consumed in apps/web/src/Analitika.tsx:42-61 — pull-only (directorProcedure.query, loads when tab opens). REFUTE ATTEMPT FAILED for push: grep cron/setInterval/scheduler/web-push/Notification/pushManager/EventSource/websocket/SSE across api+web src → 0 real hits (only Array.push); vite-plugin-pwa used only for app shell, no push in vite.config.ts. Штраф: only a POS menu item 'Лайм узган штраф' in apps/api/src/db/catalog-seed.json:1719 (guest fine sold as dish, counted inside revenue) — no staff-penalty/shtraf module or digest line. Partial confirmed.

### 🟡 [P1] Тешиклар движок: критик 🔴 тешик → директорга ДАРРОВ push

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §10 (337-qator) + QURISH-REJASI-1bosqich.md Milestone 6 «Тешиклар движок (23 та) + критик → push»
- **Далил:** Signal dvijoki bor: computeSignals apps/api/src/router.ts:409-593 (obvalka anomaliya, yupqa marja, kassa kamomadi, break-even, narx spike, takroriy kamomad, tekin-limit — 7 signal), analytics.signals router.ts:2657, UI apps/web/src/Analitika.tsx. LEKIN hech qanday push/darrov yetkazish kanali yo'q — signal faqat Analitika tabi ochilganda ko'rinadi; 23 teshikdan ~7 tasi qamrab olingan
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Engine exists: computeSignals apps/api/src/router.ts:409-594 returning 7 signal families (obvalkaFlags, thinDishes, cashVariance, breakEvenFlag, priceSpikes, shortagePattern, compToday/compFlag), exposed via analytics.signals router.ts:2657 (directorProcedure query). Delivery: consumed ONLY in apps/web/src/Analitika.tsx:42 (Promise.all on tab mount) — no push channel, no polling/refetchInterval, no nav badge (grep Notification/badge/setInterval in Shell.tsx/App.tsx/main.tsx → 0), no severity levels / 🔴-critical routing in computeSignals return. Partial confirmed.

### ✅ [P0] Kassa kamomadi: kun oxiri hisob-kitobda pul kam chiqsa — dastur summasini va qaysi smenada bo'lganini ko'rsatadi

- **Манба:** PLAN-uz.md §Nazorat (263-qator); RUSTAM-AKA-BAJARILGAN-ISHLAR.md §9 «касса санаш (камомад)» (da'vo tasdiqlandi)
- **Далил:** apps/api/src/router.ts:2303-2313 (variance = countedCash − expectedCash, kun kaliti bilan), router.ts:234-281 expectedCash = float+naqd tushum+qarz to'lovi−naqd chiqim; UI: apps/web/src/Moliya.tsx:284-303 (kamomad badge) va apps/web/src/Analitika.tsx:115-124 («Касса камомади» seksiyasi). Hozircha 1 smena = 1 kun (spec ham shunday), shuning uchun dayKey = smena identifikatori

### ✅ [P1] Hisobot + Direktor analitikasi: Tushum, sof foyda, qarzlar, top taom, zararsizlik nuqtasi (4-bosqich)

- **Манба:** PLAN-uz.md §Bosqichlar jadvali (297-qator)
- **Далил:** Tushum: report.salesDaily router.ts:2693-2710; sof foyda: financeForWindow sofFoyda router.ts:649-668 + pnl 2162-2181; qarzlar: finance.debts router.ts:2183-2230; top taom: report.topDishes 2764-2827; zararsizlik: BREAK_EVEN_HINT router.ts:403,2709 + breakEvenPerDay 2179, UI Hisobot.tsx:127-136 (yashil/sariq break-even chizig'i)

### ✅ [P1] Сотув тренди, категория улуши, топ таомлар (фойда бўйича), официантлар, break-even (da'vo: «Аналитика · Ҳисобот» bo'limi qilingan)

- **Манба:** RUSTAM-AKA-BAJARILGAN-ISHLAR.md §10 «Аналитика · Ҳисобот · Дашборд»
- **Далил:** Da'vo tekshirildi — bor: report.salesDaily (14-kun trend) router.ts:2693-2710, report.byCategory (% ulush) 2712-2762, report.topDishes (foyda/soni bo'yicha saralash) 2764-2827, report.byWaiter (qarz chiqarilgan realized tushum) 2829-2877; UI 4 ta ichki tab apps/web/src/Hisobot.tsx:28-69, Trend 87-140, Category 144-177, TopDishes 181-242, Waiters 246-278

### ✅ [P1] День закрывается в 06:00 — смена, выручка, сервис и долги считаются с 06:00 до 06:00 (hisobotlar to'g'ri kunga tushishi)

- **Манба:** PLAN.md §Важные решения (93-qator)
- **Далил:** apps/api/src/time.ts:1-31 (06:00 Asia/Tashkent cutoff, businessDayBounds/businessRangeBounds) — barcha hisobot agregatlar shu orqali (router.ts:2157,2170,2660,2697,2705,2720); frontendda ham todayBiz() 06:00 qoidasi apps/web/src/Hisobot.tsx:6-10, Moliya.tsx

### ✅ [P2] Direktor hammasini ko'radi: sotuv, foyda, tannarx, qarzlar, ogohlantirishlar, hamma hisobot (rol bo'yicha hisobot ruxsati)

- **Манба:** PLAN-uz.md §Rollar jadvali (276-qator)
- **Далил:** apps/web/src/Shell.tsx:74-89 — Бошқарув/Аналитика/Молия/Таннарх tablar faqat direktorga, Ҳисобот manager+director'ga; server tomonda apps/api/src/trpc.ts:14-19 directorProcedure/managerProcedure, report.* managerProcedure (router.ts:2693,2712,2764,2829), analytics.signals/digest directorProcedure (router.ts:2657,2659)

---

## 🛡️ Ходимлар / Анти-ўғирлик

_17 талаб: ✅ 4 · 🟡 6 · ❌ 7_

### ❌ [P0] PIN кучли — Clopos'даги 1111/0000 каби заиф ТАКРОРЛАМАЙМИЗ (brute-force ҳимояси билан)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §14 «PIN хэшланган, кучли»; §13 «заиф PIN → кучли PIN»
- **Далил:** apps/api/src/db/seed.ts:41 bootstrap direktor PIN default '1234' — va bu jonli URL bilan birga RUSTAM-AKA-BAJARILGAN-ISHLAR.md:121 da e'lon qilingan (pos77.lalimonariya.uz · PIN 1234); router.ts:53 PIN = faqat 4 raqam (10 000 variant); apps/api/src/index.ts:1-16 va login mutation (router.ts:786-814) da hech qanday rate-limit/lockout yo'q — PIN'ni brute-force qilib istalgan rol sessiyasini olish mumkin; auth.ts:9 pepper default 'dev-pepper-change-me'
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — Refute urinishi muvaffaqiyatsiz. apps/api/src/router.ts:53 pinSchema = /^\d{4}$/ (faqat 4 raqam, zaif-PIN blacklist yo'q); router.ts:786-814 auth.login publicProcedure — hech qanday rate-limit/lockout/attempt-count yo'q (grep 'rate|lockout|attempt|throttle|delay' apps/api/src → 0 kod natija); apps/api/src/index.ts:1-18 middleware yo'q; users.setPin (router.ts:842-857) ham faqat uniqueness tekshiradi, 1111/0000 ni qabul qiladi; apps/api/src/db/seed.ts:41 default '1234', va docs/RUSTAM-AKA-BAJARILGAN-ISHLAR.md:121 da jonli URL bilan e'lon qilingan ('https://pos77.lalimonariya.uz · PIN: 1234'); auth.ts:9 pepper default 'dev-pepper-change-me'. Login.tsx da ham client-side throttle yo'q.

### ❌ [P0] Тешик №11: Ўчирилган таом (чопдан кейин) → директор рухсати/PIN + ўзгармас журнал

- **Манба:** teshiklar-nazorat.md №11; RUSTAM-AKA-BAJARILGAN-ISHLAR.md §Кейинги «Возврат/ўчириш/чегирма → директор PIN + журнал»
- **Далил:** apps/api/src/router.ts:1617-1672 pos.addItem HAR QANDAY protected rol uchun manfiy delta qabul qiladi; qty<=0 bo'lsa orderItems qatori BUTUNLAY o'chiriladi (1646-1647) — direktor PIN yo'q, jurnal yo'q, oshxonaga yuborilganidan KEYIN ham cheklovsiz. kitchen_ticket_items dalil sifatida qoladi, lekin 'tiketlangan ↔ hisob' farqini ko'rsatadigan report/signal yo'q (computeSignals router.ts:409-594 da bunday tekshiruv yo'q). Ofitsiant taomni yuborib, keyin chekdan o'chirib, pulni cho'ntakka urishi mumkin — iz direktorga chiqmaydi
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — Refute bo'lmadi. router.ts:1617-1672 pos.addItem protectedProcedure, delta: z.number().int() — istalgan manfiy qiymat; qty<=0 da qator jismonan o'chiriladi (1646-1647 tx.delete(orderItems)), rol/PIN tekshiruvi yo'q, o'chirish jurnali yo'q, oshxonaga yuborilgan-yuborilmaganligi tekshirilmaydi. audit/void jadvali yo'q (grep 'void|audit' → 0; drizzle migratsiyalarda trigger yo'q). kitchen_ticket_items xom dalil sifatida qoladi, lekin hech qanday report/signal 'tiketlangan ≠ hisob' farqini ko'rsatmaydi. docs/RUSTAM-AKA-BAJARILGAN-ISHLAR.md:88 buni o'zi 'keyingi ish' deb yozgan.

### ❌ [P1] Тешик №13: Сохта возврат — возврат = кассир+директор + журнал + возврат тренди

- **Манба:** teshiklar-nazorat.md №13; LIMONARIYA-SPEC-TOLIQ.md §11 (тасдиқлар: возврат)
- **Далил:** Kodda vozvrat/refund tushunchasi umuman yo'q: grep 'возврат|refund|vozvrat' apps/ bo'yicha 0 natija (faqat catalog-seed.json'dagi taom nomi); yopilgan chekni qaytarish/reopen mutation yo'q, vozvrat trendi report yo'q
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — Refute bo'lmadi: grep -i 'refund|возврат|vozvrat|qaytar|reopen|storno' apps/api/src + apps/web/src → 0 natija. orderStatus enum = ['open','closed'] xolos (schema.ts:182), yopilgan chekni qaytarish/reopen mutation yo'q, vozvrat trend reporti yo'q. RUSTAM doc:88,99 ham buni kelajak ishi deb sanaydi.

### ❌ [P1] Вазифа назорати + штраф модули: 3 тур (дедлайн/даврий/воқеа-триггер), чек-лист, жонли камера расм + timestamp, зинапоясимон штраф (30к/50к/100к, ой бошида нолланади), админ тасдиғи, ходим штраф/интизом журнали

- **Манба:** xodimlar-vazifa.md (бутун ҳужжат); LIMONARIYA-SPEC-TOLIQ.md §9; QURISH-REJASI M6
- **Далил:** Kodda hech narsa yo'q: schema.ts'da task/checklist/fine/shtraf jadvallari yo'q, grep 'shtraf|штраф|penalty|task' apps/api,apps/web → 0 kod natija; kamera/rasm yuklash infratuzilmasi ham yo'q. RUSTAM doc ham buni to'g'ri 'Кейинги ишлар 7' deb ko'rsatgan

### ❌ [P1] Бекор қилинган буюртма → омборга тегмайди + йўқотиш сифатида ёзилади, директор кўради (тешик №6); таом ўзгартириш чопдан кейин → директор рухсати

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §5.3; teshiklar-nazorat.md №6
- **Далил:** Zakazni 'bekor qilish' mutation umuman yo'q (grep 'cancel|bekor' router.ts → faqat komment; Pos.tsx'dagi 'Бекор' — to'lov modalini yopish xolos, Pos.tsx:516,887). Bekor qilishning yagona yo'li — itemlarni manfiy delta bilan nolga tushirish (iz yo'q); pishgan-lekin-bekor taom 'yo'qotish' sifatida yozilmaydi, direktor ko'rmaydi
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — Refute bo'lmadi: orderStatus enum = ['open','closed'] (schema.ts:182) — 'cancelled' holati yo'q; cancel/bekor mutation router'da yo'q; Pos.tsx'dagi 'Бекор' (:399) — modal yopish tugmasi, 'Бекор қилиш' (:887) — cancelPay, to'lov modalini yopadi (:516-520). Zakazni yo'q qilishning yagona yo'li — addItem manfiy delta bilan itemlarni o'chirish (router.ts:1646-1647, iz yo'q); pishgan-lekin-bekor taom yo'qotish sifatida yozilmaydi (stockMovements'da bunday type yo'q), direktor signali yo'q; chopdan-keyin o'zgartirishga direktor ruxsati yo'q (addItem protectedProcedure, ticket-holati tekshirilmaydi).

### ❌ [P2] Тешик №12: Чегирма фақат директор рухсати + журнал

- **Манба:** teshiklar-nazorat.md №12
- **Далил:** Chegirma funksiyasi kodda yo'q (grep 'discount|chegirma|скидк' apps/api,apps/web → 0); order narxlari products.price snapshot'idan (router.ts:1662-1668), narxni o'zgartirish faqat directorProcedure catalog.products.update orqali — ya'ni chegirma-suiste'mol yo'li hozircha yopiq, lekin va'da qilingan nazoratli chegirma oqimi qurilmagan
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — Refute bo'lmadi: grep -i 'discount|chegirma|скидк|promo' apps/api/src + apps/web/src → 0. Order narxi products.price snapshot'idan (router.ts:1662-1667), narx o'zgartirish faqat directorProcedure catalog.products.update; updateMeta faqat guests/note (router.ts:1595-1614), servicePct hall'dan olinadi va o'zgartirilmaydi (1587) — suiste'mol yo'li yopiq, lekin nazoratli chegirma oqimi qurilmagan.

### ❌ [P3] Официант KPI/мотивация (танланган O2 тез заказ, O5 мижоз баҳоси, O7 кунлик ўз якуни, O9 заказ аниқлиги, O10 кеч келиш)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §9 «ОФИЦИАНТ назорати + мотивацияси»
- **Далил:** Hech biri kodda yo'q: mijoz bahosi/QR, javob vaqti o'lchash, ofitsiantning o'z kunlik yakuni ekrani, kech kelish qaydlari — yo'q. Faqat manager-facing byWaiter report bor (router.ts:2829) — bu O7 ('ofitsiant o'zi ko'radi') emas
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — Refute bo'lmadi: grep -i 'kpi|rating|baho|оценк|feedback|late|кеч келиш' apps → 0 tegishli natija (faqat latestMeatCost false-positive'lar). Mijoz bahosi/QR yo'q, zakaz-tezlik o'lchovi yo'q, kech kelish qaydlari yo'q, ofitsiantning o'z kunlik yakuni ekrani yo'q. Yagona yaqin narsa report.byWaiter (router.ts:2829) — managerProcedure, revenue-by-waiter, ofitsiantning o'ziga ko'rinmaydi va KPI emas.

### 🟡 [P0] Тешик №9 (энг катта): тикетсиз таом ЙЎҚ — кухня/кўрача фақат тизим тикети билан пиширади (МАЖБУРИЙ)

- **Манба:** teshiklar-nazorat.md №9 + §Энг катта тешик; QURISH-REJASI M4 «Мажбурий»
- **Далил:** Ledger bor: apps/api/src/db/schema.ts:223-257 kitchen_tickets/items (append-only, snapshot); router.ts:670-777 computeUnsentItems+flushKitchenTicket (advisory lock, faqat yuborilmagan qoldiq); router.ts:1786 close'da avto-flush ('тикетсиз таом ЙЎҚ' hatto yubormasdan yopilganda ham); Pos.tsx KitchenTicketView chop ko'rinishi. LEKIN gate operatsion emas: stansiya printerlariga ESC/POS chop yo'q (RUSTAM doc §Кейинги 5), oshxona ekrani yo'q — 'tiket yo'q = taom yo'q' qoidasini dastur hali majburlay olmaydi; tiketlangan-lekin-hisobdan-o'chirilgan taom signali ham yo'q
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Ledger + oqim BOR: apps/api/src/db/schema.ts:227-257 kitchen_tickets/kitchen_ticket_items (append-only, name/station snapshot); router.ts:670-777 computeUnsentItems+flushKitchenTicket (advisory lock, faqat yuborilmagan qoldiq, createdAt-scoped re-add himoyasi); router.ts:1786 close ichida avto-flush; router.ts:1674-1688 sendToKitchen/unsentCount; UI bor: apps/web/src/Pos.tsx:462-466 sendToKitchen, :504+949 KitchenTicketView, :1003 window.print (58/80mm printCss, Pos.tsx:896). LEKIN gate texnik jihatdan majburiy emas: ESC/POS/tarmoq printer infra yo'q (grep 'escpos|9100|printer' → faqat SVG ikonka va stations.printable ustuni schema.ts:82, ishlatilmaydi), oshxona ekrani (KDS) yo'q — chop ofitsiant qurilmasida ixtiyoriy window.print; tiketlangan-vs-hisob farq signali computeSignals'da yo'q (router.ts:409-594 faqat obvalka/kassa/kamomad/comp).

### 🟡 [P0] 🔒 МАЖБУРИЙ: чек тўлов турисиз ёпилмайди (ёпиш = кассир иши)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §5.3 Сотув
- **Далил:** UI to'g'ri: Pos.tsx:478 pay() doim to'liq summa bilan yopadi, comp'da sabab majburiy (Pos.tsx:488-502). LEKIN server tekshirmaydi: router.ts:1743-1793 close'da payments optional — comp bo'lmagan zakazni 0 to'lov bilan (yoki 1 so'm bilan) yopish mumkin, to'lov yig'indisi ↔ order.total solishtiruvi umuman yo'q; close protectedProcedure — OFITSIANT ham yopa oladi (spec bo'yicha kassir yopadi, comp'dagina rol tekshiriladi 1761). Sklad baribir yechiladi, tushum yozilmaydi, hech qanday signal yo'q
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — UI to'g'ri: Pos.tsx:473-486 pay() doim to'liq order.total bilan yopadi, payComp sabab majburiy (:488-502). Server tasdiqlandi zaif: router.ts:1743-1758 close'da payments optional va faqat amount>0 filtrlanadi; 1769-1793 tranzaksiyada to'lov yig'indisi vs order.total solishtiruvi YO'Q — comp bo'lmagan zakazni 0 yoki 1 so'm bilan yopish mumkin; close protectedProcedure (1743) — ofitsiant ham yopadi, rol faqat comp'da tekshiriladi (1761-1762); sklad baribir yechiladi (1817+), signal yo'q.

### 🟡 [P1] Таннарх/фойда фақат директор кўради (кассир/официант кўрмайди)

- **Манба:** PLAN-uz.md §Rollar va PIN; LIMONARIYA-SPEC-TOLIQ.md §3, §11
- **Далил:** taannarx.list/summary, moliya.pnl/dayClose, anomaly.signals hammasi directorProcedure (router.ts:1365,1375,2150,2162,2657) — UI ham yashiradi. LEKIN catalog.products.list va stock.products protectedProcedure bo'lib costPrice'ni HAR QANDAY rolga qaytaradi (router.ts:951-978 costPrice:959; 1941-1948) — ofitsiant/kassir API orqali tannarxni o'qiy oladi
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Asosiy ekranlar himoyalangan: taannarx.list (router.ts:1365), dashboard.summary (1375), moliya.dayClose/pnl (2150,2162), anomaly.signals/digest (2657,2659) — hammasi directorProcedure. LEKIN leak tasdiqlandi: catalog.products.list protectedProcedure bo'lib costPrice qaytaradi (router.ts:941 protectedProcedure, :959 costPrice: products.costPrice) va purchase.products ham (router.ts:1941 protectedProcedure, :1948 costPrice) — ofitsiant/kassir sessiyasi bilan API'dan tannarx o'qiladi. Refute bo'lmadi: hech qayerda role-ga qarab costPrice redaktsiyasi yo'q.

### 🟡 [P1] Тешик №20: «Текин/ходим» категорияси (сабаб мажбурий) + ҳажм назорати — кунлик лимит/тренд, ошса 🚩

- **Манба:** teshiklar-nazorat.md №20; RUSTAM-AKA-BAJARILGAN-ISHLAR.md §5
- **Далил:** Ishlaydi: schema.ts:201-206 orders.isComp+compReason; router.ts:1755-1768 comp sabab majburiy (min 1), faqat director/manager/cashier, to'lov qo'shib bo'lmaydi, sklad baribir yechiladi (1788-1790); router.ts:407 COMP_DAILY_CAP=500_000, 562-580 compToday (menyu narxida) + compFlag; Analitika.tsx:174-182 '🎁 Текин/ходим овқати' + '🔴 кунлик лимитдан ошди'; chekda 'ТЕКИН (ходим/гость)' (Pos.tsx:1047). Yetishmaydi: TREND yo'q (kunlar kesimida/kim comp qilgani bo'yicha tahlil yo'q — faqat bugungi jami)
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Ishlaydi: schema.ts:202-204 orders.isComp+compReason; router.ts:1758-1768 comp faqat director/manager/cashier, sabab min(1), to'lov bilan birga taqiqlanadi; sklad baribir yechiladi (1788-1790 comment + writeoff); router.ts:407 COMP_DAILY_CAP=500_000, :562-580 compToday menyu narxida + compFlag; Analitika.tsx:174-182 '🎁 Текин/ходим овқати' + '🔴 кунлик лимитдан ошди'; chek belgisi Pos.tsx:1047 'ТЕКИН (ходим/гость)'. TREND yo'q — tasdiqlandi: comp faqat bugungi jami (computeSignals), report routerda (2692+) comp bo'yicha kunlar kesimi/kim-comp-qildi tahlili yo'q, nonRevenueOrderIds faqat revenue'dan chiqarish uchun (router.ts:323-349).

### 🟡 [P1] Барча муҳим ҳаракат audit log — «ким нима қилгани ёзилади» (тешик №22 дубликат/қайта чоп ҳам)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §14; PLAN-uz.md §Rollar va PIN; teshiklar-nazorat.md №22
- **Далил:** audit_log jadvali YO'Q (schema.ts'da yo'q, grep 'audit' apps → 0 kod natija). Bor: attributsiya ustunlari — orders.waiterId/closedById (schema.ts:192,200), stockMovements/expenses/obvalka/purchases/kitchenTickets.createdById; kitchen_tickets append-only (yuborilganlar izi, dublikat-tiketni computeUnsentItems o'zi bloklaydi router.ts:680-739). Yo'q: order item o'zgartirish/o'chirish izi (delete iz qoldirmaydi router.ts:1647), chek qayta chop logi, 'kim nima qildi' ko'rish UI, users jadvalida o'zgarishlar tarixi
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — audit_log jadvali YO'Q — schema.ts'dagi 28 ta pgTable ro'yxatida yo'q, grep -i 'audit' apps → 0 kod natija, drizzle/ migratsiyalarda trigger yo'q. Bor (partial asosi): attributsiya — orders.waiterId/closedById (schema.ts:192,200), expenses.createdById (schema.ts:363), kitchenTickets.createdById (schema.ts:234), stockMovements.createdById; kitchen_tickets append-only + computeUnsentItems dublikat-yuborishni bloklaydi (router.ts:680-739). Yo'q: item o'zgartirish/o'chirish izi (router.ts:1647 delete iz qoldirmaydi), chek qayta-chop logi (chop = window.print, Pos.tsx:1003,1089 — hech qayerda log yozilmaydi), 'kim nima qildi' UI.

### 🟡 [P2] Кунлик иш ҳақи — алоҳида экран: ходим белгила → сумма (салатчи/повар/шашликчи ҳар куни тўланади)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §8.5 Харажат категориялари
- **Далил:** expenses.category enum'da 'ish_haqi' bor (schema.ts:342-349), Moliya UI'da 'Ойлик' kategoriyasi (Moliya.tsx:11), moliya.expenses.create directorProcedure (router.ts:2109-2140). LEKIN xodimga bog'lash yo'q — expenses'da userId/xodim maydoni yo'q, 'ходим белгила → сумма' ekrani qurilmagan; kim qancha olgani ko'rinmaydi
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Bor: expense_category enum'da 'ish_haqi // ойлик (зарплата)' (schema.ts:342-346), Moliya.tsx:11 'Ойлик' label, moliya.expenses.create directorProcedure (router.ts:2109-2140). Yo'q — tasdiqlandi: expenses jadvalida xodim maydoni yo'q (schema.ts:352-370 — faqat createdById=kim kiritgani, free-text note), create inputida userId yo'q (router.ts:2111-2118), 'ходим белгила → сумма' ekrani yo'q (grep 'salatchi|povar|shashlik|dailyPay|staffPay' → 0); kim qancha olgani strukturaviy ko'rinmaydi.

### ✅ [P1] Auth: PIN-логин (хэшланган, кучли) — 13 фойдаланувчи, сессия

- **Манба:** QURISH-REJASI-1bosqich.md §Milestone 0; LIMONARIYA-SPEC-TOLIQ.md §14
- **Далил:** apps/api/src/auth.ts:12-37 (scrypt+salt hashPin/verifyPin, HMAC pinLookup, sha256 session token); apps/api/src/router.ts:786-826 (login/me/logout, httpOnly cookie, 7 kun sessiya); apps/api/src/db/seed.ts:25-34 (13 user: direktor+menejer+bozorchi+kassir+10 ofitsiant); apps/web/src/Login.tsx (PIN keypad)

### ✅ [P1] Рол-асосли рухсат (5 рол: директор/менежер/бозорчи/кассир/официант)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §3 Роллар; xodimlar-vazifa.md §Тизимга кирадиганлар
- **Далил:** apps/api/src/db/schema.ts:18-24 userRole enum (5 rol); apps/api/src/trpc.ts:9-23 protected/director/managerProcedure; router.ts:1761 (comp faqat director/manager/cashier), 2241, 2354 (rol tekshiruvlari); apps/web/src/Shell.tsx:48-92 tab'lar rol bo'yicha (Moliya/Analitika/Tannarx/Xodimlar faqat direktor)

### ✅ [P1] Ходим CRUD: қўшиш, номини ўзгартириш, рол бериш, PIN бериш, активсизлантириш (директор)

- **Манба:** RUSTAM-AKA-BAJARILGAN-ISHLAR.md §1 Кириш ва ходимлар
- **Далил:** apps/api/src/router.ts:829-891 users.list/setPin/create/update — create/update/setPin directorProcedure, PIN uniqueness CONFLICT '(Бу PIN банд)' 851-853; apps/web/src/Shell.tsx:166-399 Ходимлар tab (ro'yxat, 'PIN бер', rol tanlash, qo'shish/tahrirlash), faqat direktor tab'i (Shell.tsx:92)

### ✅ [P1] Атрибуция: ҳар сотув қайси официант ва қайси кассир орқали ўтгани + «ким кўп сотяпти» ҳисоботи (маошсиз KPI)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §M4 Атрибуция; PLAN-uz.md «Sotuv attributsiyasi (oyliksiz)»
- **Далил:** router.ts:1586 order yaratilganda waiterId=ctx.user.id; router.ts:1776 closedById (kassir) yopishda; report.byWaiter (router.ts:2829-2877) — ofitsiant kesimida realized revenue+cheklar soni, managerProcedure; openOrders/order query'larida ofitsiant nomi ko'rinadi (1497,1528)

---

## 🔧 Инфра / Offline / Хавфсизлик

_14 талаб: ✅ 5 · 🟡 4 · ❌ 5_

### ❌ [P0] Offline-first асос: локал кэш + синхрон механизми — интернет/свет ўчса POS ишлайди, официант заказ олади, улангач синхрон

- **Манба:** QURISH-REJASI-1bosqich M0+M4; LIMONARIYA-SPEC-TOLIQ §2; WORKFLOW §3 (официант мобил POS); ARXITEKTURA 'Offline-first' + offline layer
- **Далил:** apps/web/src da hech qanday Dexie/IndexedDB/outbox/navigator.onLine kodi yo'q (grep bo'sh), apps/web/package.json da dexie dep yo'q; barcha o'qish-yozish to'g'ridan-to'g'ri tRPC fetch (apps/web/src/trpc.ts). Faqat vite-plugin-pwa static-asset precache bor (apps/web/vite.config.ts) — shell ochiladi, lekin data kesh/yozuv navbati/sinxron yo'q → internet uzilsa savdo yozib bo'lmaydi. RUSTAM-AKA-BAJARILGAN-ISHLAR.md:100 o'zi ham buni keyingi ish #3 deb rostgo'y ko'rsatadi. ARXITEKTURA.md:110-136 rejadagi src/offline/ qatlami kodda umuman yo'q.
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — Binary-safe grep -ra for dexie/indexeddb/outbox/navigator.onLine/offline over apps/web/src and apps/api/src returns zero code hits; no dexie/idb/workbox dep in apps/web/package.json. /Users/wer/projects/la_limonariya/apps/web/src/trpc.ts:4-6 is a plain httpBatchLink tRPC client (every read/write goes straight to network). /Users/wer/projects/la_limonariya/apps/web/vite.config.ts VitePWA block has only registerType:autoUpdate + manifest — no runtimeCaching, no injectManifest, no data cache. Only localStorage use in the whole web app is receipt width (Pos.tsx:899-903). docs/ARXITEKTURA.md:14,26,33,70-76,95 plans the Dexie outbox/src/offline layer that does not exist in code; docs/RUSTAM-AKA-BAJARILGAN-ISHLAR.md lists 'Offline: интернет/ток узилса ҳам сотув давом этади' as future work item #3.

### ❌ [P0] Backup стратегияси: pgBackRest шифрланган кунлик full (03:00) + соатлик incr + WAL, backup-now.sh/restore.sh, deploy.sh healthcheck-fail'да rollback

- **Манба:** ARXITEKTURA.md §9 Деплой (infra/pgbackrest, scripts/)
- **Далил:** Repo'da birorta backup skript/servis yo'q: git ls-files da *.sh fayl yo'q, docker-compose.yml da faqat yalang'och pgdata volume, pgbackrest/cron servisi yo'q, deploy.sh/rollback yo'q. Jonli tizimda qarz daftari (real pul), savdo va obvalka tarixi bitta Docker volume'da — volume/disk o'lsa qaytarib bo'lmaydi.
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — git ls-files contains zero *.sh files and nothing matching backup/pgbackrest/restore/deploy; find over the working tree also finds no .sh scripts. /Users/wer/projects/la_limonariya/docker-compose.yml defines only postgres/api/web services with a single bare 'pgdata' volume — no pgbackrest sidecar, no cron/backup service, no WAL archiving config, no deploy/rollback tooling anywhere in the repo.

### ❌ [P2] HTTPS security headers (HSTS, CSP, COOP) Caddy snippets орқали

- **Манба:** ARXITEKTURA.md §9 caddy/snippets/security-headers
- **Далил:** Caddyfile'da faqat encode gzip + reverse_proxy + file_server — hech qanday header direktivasi yo'q; jonli javobda ham HSTS/CSP kuzatilmadi (curl -I faqat Cloudflare default headerlari).
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — /Users/wer/projects/la_limonariya/Caddyfile (the only Caddyfile in the repo) contains only `encode gzip`, two `handle` blocks with `reverse_proxy api:3000`, and a `file_server` fallback — no `header` directive at all, no HSTS/CSP/COOP/snippets. grep -ra for hsts/csp over apps/ also empty (no header middleware in the Hono API either).

### ❌ [P2] Партия этикеткаси чоп: тур + сана/муддат + партия ID + ким тайёрлади + QR (FIFO ва муддат назоратининг физик уланиши)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §7 'ПАРТИЯ ЭТИКЕТКАСИ'
- **Далил:** Six/vitrina (M3) moduli umuman qurilmagan: apps/web/src da vitrina/marinad/etiketka komponenti yo'q, router.ts da partiya-etiketka chop endpointi yo'q. RUSTAM doc keyingi ishlar #1 sifatida ko'rsatadi.
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — grep -ra for vitrina/витрина/marinad/маринад/etiketka/этикетка/партия/qr over apps/web/src and apps/api/src: the only hit is the literal UI placeholder string "партия?" at apps/web/src/Taannarx.tsx:96 — not a label module. No vitrina/six component in apps/web/src (file list: Analitika, App, Catalog, Dashboard, Hisobot, Inventarizatsiya, Login, Moliya, Obvalka, Ombor, Pos, Purchases, Recipes, Shell, Taannarx), no batch-label endpoint in router.ts, no batch/label table in schema.ts. docs/RUSTAM-AKA-BAJARILGAN-ISHLAR.md lists 'Сих / Витрина' as future work #1.

### ❌ [P2] Критик 🔴 тешик → директорга дарров push (Telegram bot: огоҳлантириш + кечки хулоса)

- **Манба:** QURISH-REJASI M6 'критик → push'; LIMONARIYA-SPEC-TOLIQ §17.4; RUSTAM doc keyingi ishlar #4
- **Далил:** apps/ da telegram/push/webhook kodi yo'q (grep bo'sh). Signallar faqat pull-rejimda: analitika.signals directorProcedure query (apps/api/src/router.ts:2657) — direktor o'zi ochib qaramasa xabar bormaydi.
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — grep -ra for telegram/bot/push/webhook/notif over apps/api/src and apps/web/src finds only JS array .push() calls (e.g. router.ts:123,449,516) — zero messaging/notification code, no bot token env var in docker-compose.yml or .env.example. Signals are pull-only: apps/api/src/router.ts:2657 `signals: directorProcedure.query(() => computeSignals())` — the director must open the Analitika tab; nothing pushes alerts or an evening digest. docs/RUSTAM-AKA-BAJARILGAN-ISHLAR.md lists 'Telegram бот: директорга 🔴 огоҳлантириш + кечки хулоса' as future work #4.

### 🟡 [P0] PIN хэшланган, КУЧЛИ (Clopos'даги 1111/0000 такрорланмайди) + рухсатсиз кириб бўлмайди

- **Манба:** LIMONARIYA-SPEC-TOLIQ §13 Хавфсизлик; QURISH-REJASI M0
- **Далил:** Xeshlash bajarilgan: scrypt+salt (apps/api/src/auth.ts:16-19), pepper-HMAC lookup (auth.ts:9-13), session token sha256 (auth.ts:30-36), httpOnly cookie (router.ts:806-812). LEKIN: (1) bootstrap direktor PIN default '1234' (apps/api/src/db/seed.ts:41; docker-compose.yml BOOTSTRAP_DIRECTOR_PIN:-1234) va docs/RUSTAM-AKA-BAJARILGAN-ISHLAR.md:121 jonli publik URL bilan birga 'PIN: 1234 (Директор)' ni e'lon qiladi — aynan Clopos anti-pattern; (2) login'da rate-limit/lockout yo'q (router.ts:786-814, 'rate/attempt/lock' grep bo'sh) — 4 xonali PIN (pinSchema router.ts:53, 10 000 kombinatsiya) pos77.lalimonariya.uz publik internetda brute-force qilinadi; (3) cookie'da secure flag yo'q.
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Done: scrypt+random-salt hash (apps/api/src/auth.ts:16-20), pepper-HMAC pinLookup (auth.ts:12-14), sha256 session tokens (auth.ts:30-36), httpOnly cookie (apps/api/src/router.ts:806-811). Not done: (1) bootstrap director PIN defaults to '1234' — apps/api/src/db/seed.ts:41 `process.env.BOOTSTRAP_DIRECTOR_PIN ?? "1234"` and docker-compose.yml `BOOTSTRAP_DIRECTOR_PIN: ${BOOTSTRAP_DIRECTOR_PIN:-1234}`, and docs/RUSTAM-AKA-BAJARILGAN-ISHLAR.md 'Қандай кириш' section publishes 'https://pos77.lalimonariya.uz · PIN: 1234 (Директор)'; (2) no rate-limit/lockout on login — router.ts:786-814 login mutation has no attempt counting, grep -ra for rate/attempt/lockout/throttle/brute finds nothing (only pg advisory locks for order concurrency); PIN is 4 digits (pinSchema router.ts:53, /^\d{4}$/ = 10k combos) on a public URL; (3) setCookie at router.ts:806-811 sets httpOnly/sameSite/path/expires but no secure flag.

### 🟡 [P1] Принтерлар: заказ қоғозда станция бўйича чоп (мангал·ошхона·салат·балиқ·нон-чой + касса, 5+1 принтер), ESC/POS, авто-чоп

- **Манба:** LIMONARIYA-SPEC-TOLIQ §8.8 Принтерлар; QURISH-REJASI M4 'станция чоп'; ARXITEKTURA lib/printing (escpos CP866, routing.ts)
- **Далил:** Kuxnya tiketi bor: KitchenTicketView stansiya bo'yicha guruhlaydi (apps/web/src/Pos.tsx:949-1019, byStation Pos.tsx:958-964) va window.print() bilan chop etadi (Pos.tsx:1003), 58/80mm @page CSS (Pos.tsx:896-909). Lekin bu bitta brauzer-printerga qo'lda chop — ESC/POS transport, stansiyaga routing (5 alohida printer), avto-chop yo'q: repo'da escpos/9100/USB/CP866 kodi yo'q (grep bo'sh). RUSTAM doc ham 'Принтер: кухня + касса (5 станция)' ni keyingi ish #5 deb yozadi.
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Exists: KitchenTicketView (apps/web/src/Pos.tsx:949) groups items byStation (Pos.tsx:958-963, rendered per-station at 988), manual 'Чоп этиш' via window.print() (Pos.tsx:1003; receipt print at 1028/1086), 58/80mm @page CSS printCss (Pos.tsx:908) with per-device width toggle (useReceiptWidth Pos.tsx:896-905, localStorage 899-903). Missing: grep -ra for escpos/esc\/pos/:9100/cp866/usb over apps/ finds nothing — no ESC/POS transport, no routing of each station block to its own physical printer (5+1), no auto-print on send-to-kitchen; it is one browser print dialog on whatever printer the device has. docs/RUSTAM-AKA-BAJARILGAN-ISHLAR.md lists 'Принтер: кухня + касса чоп этиш (5 станция)' as future work #5.

### 🟡 [P1] Secrets бошқаруви: .env репога кирмайди, Clopos harvest (токен/PII) commit қилинмайди, production'да кучли pepper/parol

- **Манба:** LIMONARIYA-SPEC-TOLIQ §13; .gitignore izohi; ARXITEKTURA §9 .env.example
- **Далил:** Yaxshi tomoni: .env gitignored (faqat .env.example commit'da, ogohlantirishlar bilan), docs/clopos-api/ (terminal token, admin_password, PII) gitignored, git ls-files da sir yo'q. Kamchilik: docker-compose.yml zaif fallback'lar bilan ishlayveradi — POSTGRES_PASSWORD:-limon_dev, PIN_PEPPER:-dev-pepper-change-me, BOOTSTRAP_DIRECTOR_PIN:-1234; serverda .env unutilsa/yo'qolsa jimgina dev-sirlar bilan prod ishlaydi, hech narsa fail bo'lmaydi.
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Done: /Users/wer/projects/la_limonariya/.gitignore ignores .env and docs/clopos-api/ with an explicit warning comment ('contains secrets (terminal tokens, admin_password...) + PII, do NOT commit'); git ls-files shows only .env.example and no clopos-api files. Not done: silent weak fallbacks in production path — docker-compose.yml `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-limon_dev}`, `PIN_PEPPER: ${PIN_PEPPER:-dev-pepper-change-me}`, `BOOTSTRAP_DIRECTOR_PIN: ${BOOTSTRAP_DIRECTOR_PIN:-1234}`, and apps/api/src/auth.ts:9 `const pepper = process.env.PIN_PEPPER ?? "dev-pepper-change-me"` — if .env is absent on the server, the stack boots normally with dev secrets instead of failing.

### 🟡 [P1] Барча муҳим ҳаракат audit log (ким нима ўзгартирди — заказ ўзгариши, ўчириш, дубликат чоп №22)

- **Манба:** LIMONARIYA-SPEC-TOLIQ §13; teshiklar-nazorat #22
- **Далил:** Umumiy audit-log jadvali yo'q (apps/api/src/db/schema.ts da 'audit' grep bo'sh). Append-only ledger'lar bor: stock_movements (schema.ts:318), debt_payments (373), order_payments (267), orders'da waiter/cashier atributsiya — bular qisman iz qoldiradi. Lekin 'kim nima o'zgartirdi' jurnali (item o'chirish, narx/retsept tahriri, qayta chop) yozilmaydi.
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — No audit table: grep -ai 'audit' over apps/api/src/db/schema.ts returns nothing; full pgTable list (schema.ts:13-428) has no audit/journal table. Partial trails exist as append-only ledgers: orderPayments (schema.ts:267), stockMovements (schema.ts:318), debtPayments (schema.ts:373), plus waiter/cashier attribution on orders. But there is no who-changed-what journal for order-item deletion, price/recipe edits, or duplicate ticket/receipt reprints — reprint via window.print() (Pos.tsx:1003,1086) leaves no server-side record.

### ✅ [P1] Брендли мижоз чеки (лого + телефон) + чек эни 58/80мм созланади (принтерга мослаш)

- **Манба:** RUSTAM-AKA-BAJARILGAN-ISHLAR §5 Касса; LIMONARIYA-SPEC-TOLIQ §8.8 (мижоз чеки)
- **Далил:** apps/web/src/Pos.tsx:1021-1102 Chek komponenti: BRAND.logoSmall + BRAND.name/city/phone (1041-1043), pozitsiyalar/xizmat haqi/ИТОГО/to'lovlar, window.print (1086); useReceiptWidth 58/80mm localStorage'da per-device saqlanadi (896-907), WidthToggle UI (910-927), @page size:{w}mm print CSS (908-909).

### ✅ [P1] PWA: телефонга ўрнатса бўлади (manifest, иконкалар, service worker) — Android+iOS+десктоп бир хил

- **Манба:** LIMONARIYA-SPEC-TOLIQ §8.8 'Қурилма: PWA'; RUSTAM-AKA-BAJARILGAN-ISHLAR §11
- **Далил:** apps/web/vite.config.ts VitePWA (registerType autoUpdate; manifest: name 'La Limonariya', standalone, theme #0e4037, 192/512/maskable ikonkalar); ikonkalar mavjud apps/web/public/brand/. Jonli tekshirildi (2026-07-02): https://pos77.lalimonariya.uz/sw.js → 200, /manifest.webmanifest → 200, index.html'da registerSW.js.

### ✅ [P1] Домен lalimonariya.uz + текин SSL + ҳар жойдан кириш (Cloudflare tunnel орқали жонли)

- **Манба:** RUSTAM-AKA-BAJARILGAN-ISHLAR §11 va 'Қандай кириш'
- **Далил:** Jonli tekshirildi: curl https://pos77.lalimonariya.uz/ → HTTP/2 200, server: cloudflare, TLS ishlaydi (2026-07-02). Caddy :80 tunnel ortida xizmat qiladi (Caddyfile: /trpc,/api → api:3000, SPA try_files). Eslatma: cloudflared/tunnel konfiguratsiyasi repo'da YO'Q (server-side, hujjatlanmagan) — server qayta tiklashda yo'qolish riski.

### ✅ [P1] Docker deploy: офис серверида изоляцияда (Sanoat ERP ёнида), Postgres хостга publish қилинмайди, Mac'сиз мустақил ишлайди

- **Манба:** ARXITEKTURA.md §9 'Изоляция калити'; RUSTAM-AKA-BAJARILGAN-ISHLAR §11; optiplex-server memory
- **Далил:** docker-compose.yml: postgres faqat ichki tarmoqda (port publish yo'q; dev-only override 127.0.0.1:5433 gitignored), restart:unless-stopped hamma servisda, pg_isready healthcheck + depends_on condition, faqat web ${WEB_PORT:-8080}:80 publish. docker/api.Dockerfile har startda idempotent migrate+seed+import. Jonli sayt 200 → serverda mustaqil ishlayapti.

### ✅ [P1] Рол-асосли рухсат: таннарх/фойда фақат директорга; кассир/официант кўрмайди

- **Манба:** LIMONARIYA-SPEC-TOLIQ §13, §11; PLAN-uz 'Rollar va PIN'
- **Далил:** apps/api/src/trpc.ts:9-21 protectedProcedure/directorProcedure/managerProcedure (FORBIDDEN agar rol mos kelmasa). 22 ta directorProcedure: taannarx.list (router.ts:1365), dashboard.summary (1375), moliya dayClose/pnl/debts (2150,2162,2183), signals/digest (2657,2659), setPin/users CRUD (842-876) va h.k. Sessiya: httpOnly cookie + sha256 token hash + 7 kun expiry + active tekshiruvi (context.ts:14-36).

---

## 📋 Каталог / Техкарта

_19 талаб: ✅ 7 · 🟡 7 · ❌ 5_

### ❌ [P1] ~19 асосий ингредиент нархи (гуруч, гўшт, пиёз, масло, зира...) — киритилиши керак

- **Манба:** RUSTAM-AKA-BAJARILGAN-ISHLAR.md §❓ Сиздан керак
- **Далил:** dev DB: 60 ingredient/part маҳсулотдан фақат 3 тасида costPrice (картошка 118, сабзи 150, пиёз кукат 1500). Рецептларда ишлатилган нархсизлар (аниқ рўйхат, uses сони): туз(23) масло(20) помидор(18) пиёз(16) бодринг(13) мурч(8) соя(7) корейски туз(7) майонез(6) чеснок(6) минерал сув(6) кашнич(5) киви(5) паприка(4) думба(4) пармезан сыр(4) зира(3) товуқ гўшт(3) светофор перец(3) розмарин(3); гўшт/мол гўшт — обвалкадан
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — Dev DB: type in ('ingredient','part') = 60 маҳсулот, cost_price NOT NULL фақат 3 та (картошка=118, сабзи=150, пиёз кукат=1500). «товук гушти» ingredient cost_price=NULL. Кодда ингредиент нархларини seed қиладиган скрипт йўқ — фақат purchase.create орқали тўлади, харидлар эса киритилмаган.

### ❌ [P1] SEMI/ярим-тайёр маҳсулотлар рецепт билан + ишлаб чиқариш (Фарш ad-hoc истисно, Шапок→Фарш полуфабрикат)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §4.1, §5.2; texkarta.json confirmations; PLAN-uz 'Farsh istisno'
- **Далил:** dev DB: semi type маҳсулот = 0 та; router.ts'да production процедура йўқ (movementType enum'да 'production' бор, лекин ҳеч ким ёзмайди); ФАРШ/Фарш кг = dish сифатида турибди
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — Dev DB: type='semi' маҳсулот = 0; stock_movements type='production' = 0. schema.ts:309 movement_type enum'да 'production' бор, лекин grep '"production"' router.ts = 0 (ҳеч бир процедура ёзмайди); web/src'да ҳам 0. ФАРШ, Фарш кг, ТОВУК СОНЧАЛАРИ dev DB'да type='dish' сифатида турибди — полуфабрикат оқими йўқ. semi фақат enum/фильтрларда эслатилади (router.ts:984, 1074, 1886).

### ❌ [P2] Мариновка ўсиши (+13–30%: кусковой мол +13%, қўй +15%, Вағури +30%) таннарх ҳисобига киради

- **Манба:** QURISH-REJASI M2; LIMONARIYA-SPEC-TOLIQ.md §6, §8
- **Далил:** recipes.marinade устуни бор (schema.ts:110) ва импортда сақланади, лекин router.ts/obvalka-calc.ts да «marinade» ҳеч қаерда ишлатилмайди (grep 0 натижа) — коэффициент ҳеч қандай ҳисобга кирмайди
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — recipes.marinade сақланади: apps/api/src/db/schema.ts:110 + import-recipes.ts:72; seed'да 7 рецептда marinade note (13%/15%/20%/30%). ЛЕКИН grep 'marinade' apps/api/src/router.ts va obvalka-calc.ts = 0 натижа (фақат schema/seed/import файлларида) — коэффициент ҳеч қандай таннарх/списание ҳисобига кирмайди.

### ❌ [P2] Товуқ гўшти таннархи 1-босқичда ҳисобланади (Цезар 60г товуқ, Гурман 50г товуқ...)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §8; RUSTAM-AKA §Кейинги ишлар №8
- **Далил:** carcassType enum фақат qoy|mol (schema.ts:125); carcassOf() router.ts:127-136 фақат мол/қўй regex; «товук гушти» ингредиентда costPrice null → товуқли таомлар таннархи 0
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — apps/api/src/db/schema.ts:125 carcass_type enum = ['qoy','mol'] холос; router.ts:127-136 carcassOf фақат мол/қўй regex, category='товуқ' null қайтаради; seed'да 2 рецепт kind=hot category='товуқ' бор, лекин dev DB'да «товук гушти» ingredient cost_price=NULL ва computeDishTaannarx costPrice ўқимайди → товуқли таомлар таннархи 0.

### ❌ [P3] QR/AR e-menu (la-limonariya.uz, AR QR электрон меню ғояси)

- **Манба:** brand-identity memory; LIMONARIYA-SPEC-TOLIQ.md §17.5; PLAN-uz 8-bosqich 'Kelajak'
- **Далил:** apps/web/src va apps/api/src'да qr/ar-menyu/e-menu бўйича ҳеч нарса йўқ (grep 0); режада ҳам аниқ «Кейин» деб белгиланган — блок эмас
- **Верификатор:** скептик тасдиқлади: ЙЎҚ — grep -i 'qr|qrcode|e-menu|emenu|ar-menu|augmented|la-limonariya' apps/web/src + apps/api/src = 0 натижа. Кодда ҳеч қандай из йўқ; режада ҳам «Кейин» деб белгиланган — блокловчи эмас.

### 🟡 [P0] Рецепт ↔ каталог маҳсулот боғланиши (шусиз таннарх нархсиз, авто-списание ишламайди): «Taom sotilsa retsept bo'yicha mahsulot o'zi chiqim bo'ladi»

- **Манба:** PLAN-uz.md 'Tex-kartalar — sotuv o'zi chiqim qiladi'; SPEC §5.3
- **Далил:** Код бор: pos.close router.ts:1857-1903 рецепт бўйича списание. ЛЕКИН dev DB: recipes.product_id боғланган 5/38 (Умакай жиз, Мужской каприз, Гурман, Цезар, Мастава), recipe_items боғланган 95/297, 60/65 фаол таомда техкарта ЙЎҚ → аксарият сотув списаниясиз ўтади = сохта фойда давом этади
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Код бор: apps/api/src/router.ts:1857-1903 pos.close рецепт бўйича sale_writeoff (1864-1867 рецептсиз таом skip). ЛЕКИН dev DB: recipes.product_id боғланган 5/38 (Умакай жиз, Мужской каприз, Гурман, Цезар, Мастава); recipe_items.component_id боғланган 95/297; фаол dish=65, шундан рецептсиз=60 → аксарият сотув skippedNames'га тушади, списание ўтмайди.

### 🟡 [P1] Рецепт импорт: texkarta.json → «Состав» (ингредиент + грамм + stock_hint), 26 иссиқ + 12 салат + Фарш

- **Манба:** QURISH-REJASI M1; LIMONARIYA-SPEC-TOLIQ.md §8
- **Далил:** apps/api/src/db/import-recipes.ts:59-93 + texkarta-seed.json (38 рецепт = 26+12; Фарш production ИМПОРТ ҚИЛИНМАГАН); DB: 38 recipes, 297 recipe_items, stockHint сақланган
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — apps/api/src/db/import-recipes.ts:59-93 imports name/qty_g/stock_hint (line 88 stockHint saved); texkarta-seed.json = 38 recipes (hot 26: мол 15 + куй 6 + null 3 + товуқ 2; salad 12). Dev DB: recipes=38, recipe_items=297, items c stock_hint=38. Фарш production-рецепт seed'да ЙЎҚ — фақат таом «Шашлик — фарш» (фарш ингредиент сифатида); DB'да ФАРШ/Фарш кг type='dish', рецептсиз полуфабрикат.

### 🟡 [P1] Техкарта муҳаррири: таомга ингредиент + грамм киритиш (директор), recipeUpsert

- **Манба:** RUSTAM-AKA-BAJARILGAN-ISHLAR.md §2
- **Далил:** apps/web/src/Catalog.tsx:402-467 (муҳаррир, «боғланг» огоҳи), router.ts:1102-1176 recipeUpsert (director). БАГ: insert (1163-1173) stockHint'ни ЁЗМАЙДИ → импортланган рецепт таҳрирланса гўшт-хинт ўчади, carcassOf()/списание гўштни танимай қолади
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — Муҳаррир бор: apps/web/src/Catalog.tsx:403-467 (техкарта блоки, «⚠ … — боғланг» огоҳи 427-қатор); apps/api/src/router.ts:1102 recipeUpsert = directorProcedure. БАГ ТАСДИҚЛАНДИ: input schema (1107-1119) stockHint қабул қилмайди, recipeForProduct (1090-1098) уни қайтармайди, insert (1163-1173) уни ёзмайди — эски items 1154-қаторда delete қилинади → импортланган рецепт таҳрирланса stock_hint йўқолади, carcassOf (131) ва pos.close hint-regex (1874-1882) гўштни танимай қолади.

### 🟡 [P1] Ҳар таомнинг реал таннархи (техкарта + гўшт нархи) жонли + «юпқа маржали таомлар» огоҳи

- **Манба:** RUSTAM-AKA-BAJARILGAN-ISHLAR.md §4; QURISH-REJASI M2
- **Далил:** router.ts:93-167 computeDishTaannarx — ФАҚАТ гўшт (stock_hint regex) ҳисобланади, гўштсиз ингредиентлар costPrice'и таннархга умуман кирмайди; Taannarx.tsx:64-97 гўшт% ≥60% 🔴 огоҳ бор. «Реал таннарх» эмас — «гўшт улуши»
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — apps/api/src/router.ts:93-167 computeDishTaannarx фақат гўшт: carcassOf (127-136) stock_hint regex обвалка/лаҳм/гўшт + мол/қўй; meatCostTotal (139-152) — products.costPrice умуман ўқилмайди, гўштсиз ингредиентлар таннархга кирмайди. Огоҳ бор: apps/web/src/Taannarx.tsx:64 (high = meatPct ≥60), 67/87 қизил, 97 ⚠️, 113 «🔴 ≥60% — маржа юпқа». Бу «гўшт улуши», реал тўлиқ таннарх эмас.

### 🟡 [P1] Харид киритилса → ингредиент нархи янгиланади ва таннарх шундан тўғрилашади

- **Манба:** RUSTAM-AKA-BAJARILGAN-ISHLAR.md §6
- **Далил:** router.ts:2027-2032 purchase.create → products.costPrice = price/qty (done); costPrice COGS (cogsForWindow:188-229) ва инвентар баҳолашда ишлатилади, лекин таом таннархи (computeDishTaannarx) уни ўқимайди
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — apps/api/src/router.ts:2027-2032 purchase.create → products.costPrice = round(price/qty) ✓; costPrice cogsForWindow'да ишлатилади (198, 215) ва valuePortion (173-183) инвентар баҳолашда ✓. ЛЕКИН computeDishTaannarx (93-167) products.costPrice'га умуман мурожаат қилмайди → харид нархи таом таннархига таъсир қилмайди.

### 🟡 [P1] Таннарх фақат директорга кўринади (кассир/официант сотув таннархини кўрмайди)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §13; PLAN-uz.md Rollar
- **Далил:** taannarx.list = directorProcedure (router.ts:1365) ✓, Shell.tsx:89 таб фақат директор ✓; ЛЕКИН catalog.products.list/get (router.ts:959,1042) costPrice'ни ҲАММА роль'га қайтаради (Каталог таб барчага очиқ, Shell.tsx:90) — UI кўрсатмайди, аммо API'дан оқади
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — taannarx.list = directorProcedure (router.ts:1365) ✓, Таннарх таб фақат директор (Shell.tsx:89) ✓. ЛЕКИН catalog.products.list (router.ts:941 protectedProcedure, 959 costPrice) ва .get (1031, 1042 costPrice) costPrice'ни ҳар қандай авторизацияланган роль'га қайтаради; Каталог/Рецептлар таблари барчага очиқ (Shell.tsx:90-91). UI costPrice'ни render қилмайди (Catalog.tsx'да фақат type-def, 13-қатор), лекин API'дан оқади.

### 🟡 [P2] Рецептни Рецептлар табдан таҳрирлаш (✎)

- **Манба:** pos-v2-qa-pass memory / RUSTAM-AKA §2
- **Далил:** Recipes.tsx:93-101 ✎ фақат r.linked бўлганда → dev DB'да 33/38 боғланмаган рецептни бу ердан таҳрирлаб/боғлаб бўлмайди (фақат Каталогдан янги маҳсулот очиш орқали)
- **Верификатор:** скептик тасдиқлади: ҚИСМАН — apps/web/src/Recipes.tsx:93-101 — ✎ тугма фақат `r.linked && r.productId` бўлганда кўрсатилади; edit() (54-57) products.get орқали ProductModal очади. Dev DB'да боғланмаган 33/38 рецепт учун бу табда на таҳрир, на боғлаш йўли йўқ — фақат Каталогдан маҳсулот очиш орқали.

### ✅ [P1] Схема: маҳсулот ягона жадвал type дискриминатор билан (INGREDIENT/PART/SEMI/DISH/GOODS) + категория + станция

- **Манба:** QURISH-REJASI-1bosqich.md M1; LIMONARIYA-SPEC-TOLIQ.md §4.1
- **Далил:** apps/api/src/db/schema.ts:60-101 — productType pgEnum(ingredient|part|semi|dish|goods), products.categoryId/stationId; categories:70, stations:78

### ✅ [P1] Clopos каталог импорт: таомлар + категория + станция + нарх (тозалаб: 9 ўчир + дубликат + ШАШЛИКЛАР→14); «289 маҳсулот, 10 категория» клейми

- **Манба:** QURISH-REJASI M1; RUSTAM-AKA-BAJARILGAN-ISHLAR.md §2
- **Далил:** apps/api/src/db/catalog-seed.json = 289 products/10 categories/6 stations; import-catalog.ts:32-96 idempotent upsert; DB tekshirildi: ШАШЛИКЛАР=14, 10 kategoriya. Kichik dog': «Фарш кг» dublikat 2 marta qolgan (DB query)

### ✅ [P1] Техкартаси йўқ таомга «техкарта йўқ» белгиси (Клопусдаги сохта фойдага қарши)

- **Манба:** RUSTAM-AKA-BAJARILGAN-ISHLAR.md §2
- **Далил:** router.ts:966 hasRecipe exists-subquery; Catalog.tsx:145-149 amber «техкарта йўқ» badge (dish/semi)

### ✅ [P1] Меню бошқаруви: директор таом/нарх/категория қўшиш-таҳрирлаш; нарх фикс (фақат директор ўзгартиради)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §8.8; restaurant-operations-rules
- **Далил:** router.ts:980-1029 products.create/update = directorProcedure (нарх, тур, бирлик, категория, станция, актив); Catalog.tsx ProductModal:223-491; deactivate = менюдан йўқолади (pos.menu router.ts:1484 active+price>0 фильтр)

### ✅ [P1] Категория бошқаруви (қўшиш/таҳрир/ўчириш) + POS'да категория ранглари (шашлик қизил, салат яшил, балиқ кўк...)

- **Манба:** RUSTAM-AKA-BAJARILGAN-ISHLAR.md §5; pos-v2 memory
- **Далил:** router.ts:894-938 categories CRUD (director); Catalog.tsx CategoryModal:493-561; Pos.tsx:62-81 CAT_COLORS (шашлик #c1502e, салат #3f7d4e, балиқ #2f6f8f...)

### ✅ [P1] POS меню: фаол, нархли таомлар категория бўйича (official menu манбаси каталог)

- **Манба:** QURISH-REJASI M4; RUSTAM-AKA §5
- **Далил:** router.ts:1474-1486 pos.menu (active=true, price>0, category join); Pos.tsx MenuItem категория ранги билан

### ✅ [P2] Граммовка кўриниши: Рецептлар таб — ҳар рецепт ингредиент + грамм + stock_hint + боғланганлик белгиси

- **Манба:** PLAN-uz.md 'tex-kartasi (grammovkasi) dasturda turadi'
- **Далил:** apps/web/src/Recipes.tsx:103-139 — qtyG «N г», stockHint қавсда, ✓ = маҳсулотга боғланган; router.ts:1178-1207 recipes/recipe queries

---

## 🔎 КРИТИК ТОПГАН ҚАМРАЛМАГАН ПУНКТЛАР

Булар план/савол-жавоб ҳужжатларида бор (кўпи Рустам ака томонидан «ҲА» деб тасдиқланган), лекин на кодда, на roadmap'да:

### ❌ [P1] Six/Vitrina 3-bosqichli qoldiq: xom go'sht(kg) → marinad(kg) → vitrina(dona), menyu taom ↔ vitrina six 1:1 bog'lanish, FIFO eski six ogohi — butun Milestone 3 audit domenlariga kirmagan (audit faqat 'hisoblangan↔qo'lda six' solishtiruvi va partiya etiketkasini aytadi, vitrina donali qoldiq va 1:1 bog'lanishni emas)

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §7 + QURISH-REJASI-1bosqich.md Milestone 3
- **Далил:** grep 'витрина|vitrina' apps/ → 0 hit; 'marinade' faqat recipes jadvalida text ustun (apps/api/src/db/schema.ts:110); schema'da vitrina/batch jadvali yo'q. Spec bo'yicha shashlik grammi — eng katta pul rychagi (~25-28 mln/oy)

### ✅ [P1] Xizmat haqi har zal bo'yicha: Asosiy 10% · Katta 10% · Terrasa 15% · Soboy 0% (chek yopilganda avto qo'shiladi) — auditning birorta domenida tilga olinmagan

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §5.3 + PLAN.md '💳 Продажи' + Milestone 4
- **Далил:** apps/api/src/db/import-halls.ts (servicePct per hall, owner-confirmed komment), apps/api/src/router.ts:1552 service = round(subtotal*servicePct/100)

### ✅ [P1] Kun chegarasi 06:00 (operatsion kun 06:00–06:00, tungi zakazlar to'g'ri kunga tushadi — smena/tushum/servis/qarz shu oynada) — auditda tilga olinmagan

- **Манба:** PLAN.md '💳 Продажи' + LIMONARIYA-SPEC-TOLIQ.md §1 (kun chegarasi 06:00) va §5.5
- **Далил:** apps/api/src/time.ts:1-20 — 'Operational day cuts at 06:00 Asia/Tashkent', before 06:00 → yesterday

### ❌ [P1] Hisobni bo'lib to'lash (split bill — bitta stol hisobini 2 mijoz alohida to'laydi; D2, raund-10da 'HA' tasdiqlangan). Multi-tender (aralash to'lov) auditda bor, lekin split bill — boshqa talab, tilga olinmagan

- **Манба:** docs/qolgan-savollar-toliq.md D2 + '✅ ЖАВОБЛАР (раунд 10)' №2
- **Далил:** grep 'split|бўлиб тўла' apps/ → faqat string.split() false-positive lar; Pos.tsx da split bill yo'q

### ❌ [P2] Pre-chek (mijoz to'lovdan oldin hisobni so'raganda chop etiladigan oldindan hisob; D6 'HA' tasdiqlangan) — auditda tilga olinmagan

- **Манба:** docs/qolgan-savollar-toliq.md D6 (raund 8 barcha 🟢 → HA)
- **Далил:** grep 'пречек|pre-check' apps/ → 0 hit

### ❌ [P2] Ofitsiant g'oyalari O1/O3/O4/O6/O8 (hamma ✅ tanlangan): O1 stol yig'ishtirish 10 min → 40k shtraf, O3 tayyor taomni 5 minutda eltish, O4 stol chaqiruvi (QR/tugma, javob vaqti), O6 upsell reytingi/liderbord, O8 smena boshida ko'rinish (jonli kamera rasm) — audit faqat O2/O5/O7/O9/O10 ni sanagan

- **Манба:** docs/goyalar-variantlar.md (Rustam aka: HAMMASI ✅) + LIMONARIYA-SPEC-TOLIQ.md §9
- **Далил:** grep 'upsell|чақирув' apps/ → 0 hit; vazifa/shtraf moduli umuman yo'q (schema'da tasks/fines jadvali yo'q)

### ❌ [P2] Administrator g'oyalari A2/A4/A5/A8/A10 (tanlangan): A2 teshikka reaksiya SLA, A4 kunlik obxod (rasm+chek-list), A5 xodim davomati/tabel, A8 xodim reytingi 🟢🟡🔴, A10 mehmon shikoyati jurnali — audit faqat A9 (avto hisobot) va smena topshirishni aytgan

- **Манба:** docs/goyalar-variantlar.md (A1 dan tashqari hammasi ✅) + LIMONARIYA-SPEC-TOLIQ.md §9
- **Далил:** grep 'давомат|табел|шикоят|attendance' apps/ → 0 hit

### ❌ [P2] Yomon go'sht yetkazuvchiga QAYTARISH harakati (A5 'HA' tasdiqlangan — qaytarish movement turi). Auditning harakat turlari ro'yxatida (Xarid·Obvalka·Ishlab chiqarish·Spisaniye·Inventarizatsiya·Yo'qotish·Ko'chirish) qaytarish YO'Q

- **Манба:** docs/qolgan-savollar-toliq.md A5 (raund 8 → HA)
- **Далил:** grep 'қайтариш|return' apps/ → 0 hit; schema stock_movements enum'ida return turi yo'q (schema.ts:309 atrofida faqat production va b.)

### ❌ [P2] Tugagan taom POS'da OGOHLANTIRADI, lekin bloklamaydi (D5, raund 8 tasdiqlangan — minus ruxsat, ogoh bilan) — auditda ombor svetofori bor, lekin POS satrida sotuv paytidagi 'tugagan' ogohi tilga olinmagan

- **Манба:** docs/qolgan-savollar-toliq.md D5 + раунд 10 №4
- **Далил:** grep 'тугаган|soldout|out_of_stock' apps/ → 0 hit; Pos.tsx da stok ogohi yo'q

### ❌ [P2] Banket BRON (sana + zal + ixtiyoriy avans bilan oldindan band qilish; F1 'HA' tasdiqlangan) — audit faqat 'banket avans hisobdan ayiriladi'ni aytgan, bron/rezerv funksiyasining o'zi tilga olinmagan

- **Манба:** docs/qolgan-savollar-toliq.md F1 + раунд 10 №5 + LIMONARIYA-SPEC-TOLIQ.md §15
- **Далил:** grep 'банкет|bron|reserv' apps/ → faqat zal nomlari '3-Банкет зал','4-Банкет зал' (apps/api/src/db/seed-tables.ts:13-14); bron jadvali/ekrani yo'q

### ✅ [P2] Soliq 4% karta tushumidan AVTO hisoblanadi (H2 tasdiqlangan) — auditning moliya-kassa domenida tilga olinmagan

- **Манба:** docs/qolgan-savollar-toliq.md H2 + раунд 10 №8
- **Далил:** apps/api/src/router.ts:617 cardTax = round(electronic*4/100), :649 sofFoyda hisobida ayiriladi; apps/web/src/Moliya.tsx:165 'Солиқ (4% карта)' ko'rsatiladi

### ✅ [P2] Zararsizlik nuqtasi (break-even) direktor panelida — 'bugun ~8.9 mln chiziqdan o'tdimi?' + 'nechta porsiya sotish kerak' — auditning direktor paneli ro'yxatida (4 raqam, svetofor, pul vs foyda) tilga olinmagan

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §11 + PLAN.md 'Аналитика (директор)' ekrani
- **Далил:** apps/web/src/Analitika.tsx:26,133-137 breakEvenFlag ('🔴 break-even остида'); apps/web/src/Moliya.tsx:458 breakEvenPerDay

### ❌ [P2] Fiskal 'IKKI OLAM'ning rasmiy tomoni: ichimlik xaridi cherez schyot (bank) → rasmiy prixod, sotilganda rasmiy rasxod — alohida rasmiy hisob oqimi. Audit faqat 'markirovka SKAN majburiy'ni aytgan, rasmiy prixod/rasxod buxgalteriyasi tilga olinmagan

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §8.7 (jadval: Xarid=cherez schyot, Hisob=rasmiy prixod/rasxod)
- **Далил:** grep 'markirov|datamatrix|скан' apps/ → 0 hit; rasmiy hisob oqimi ham yo'q

### ❌ [P3] Mijoz CRM + tug'ilgan kun: doimiy mijoz bazasi + telefon + tarix → SMS taklif/bonus, qarz mijozlari bilan ulanadi (№9, Rustam aka HAMMASINI tanlagan) — auditda faqat qarz-mijoz bor, CRM/tug'ilgan kun/doimiy mijoz bonus tilga olinmagan

- **Манба:** docs/qoshimcha-goyalar-2.md №9 (✅ TANLANDI) + LIMONARIYA-SPEC-TOLIQ.md §17.9
- **Далил:** grep 'туғилган|birthday|customer' apps/ → 0 hit; schema'da customers jadvali yo'q

### ❌ [P3] Pik soat/kun tahlili (№3): qaysi soat/kun gavjum → smena reja + oldindan tayyorgarlik — auditning analitika domenida tilga olinmagan

- **Манба:** docs/qoshimcha-goyalar-2.md №3 (✅ TANLANDI) + LIMONARIYA-SPEC-TOLIQ.md §17.3
- **Далил:** grep 'пик|peak' apps/ → 0 hit

### ❌ [P3] Kuxnya tayyorlash vaqti + KDS (№6): har taom norma vaqti (shashlik 15 min) → kechiksa 🚩; KDS ekran (printer o'rniga) — auditda tilga olinmagan

- **Манба:** docs/qoshimcha-goyalar-2.md №6 (✅ TANLANDI) + LIMONARIYA-SPEC-TOLIQ.md §17.6
- **Далил:** grep 'kds' apps/ → 0 hit; kitchenTickets jadvali bor (schema.ts:227) lekin vaqt-norma/kechikish nazorati yo'q

### ❌ [P3] Smena reja/grafik (№7): 10 ofitsiant navbatini pik soatga moslab rejalash — auditda tilga olinmagan

- **Манба:** docs/qoshimcha-goyalar-2.md №7 (✅ TANLANDI) + LIMONARIYA-SPEC-TOLIQ.md §17.7
- **Далил:** grep 'смена режа|shift.?plan|rota' apps/ → 0 hit

### ❌ [P3] QR-menyu + mijoz O'ZI zakaz beradi (№5, self-ordering — kamroq ofitsiant, tezroq) — audit katalog domenida faqat brend 'QR/AR e-menu' konseptini aytgan, mijoz o'zi zakaz berish moduli tilga olinmagan

- **Манба:** docs/qoshimcha-goyalar-2.md №5 (✅ TANLANDI) + LIMONARIYA-SPEC-TOLIQ.md §17.5
- **Далил:** grep '\bqr\b' apps/ → 0 hit

### ❌ [P3] Oylik maqsad (№10): direktor oylik foyda maqsadi qo'yadi → real-vaqt progress ('165 mln maqsad, 120 mln bajarildi, 10 kun qoldi') — auditda tilga olinmagan

- **Манба:** docs/qoshimcha-goyalar-2.md №10 (✅ TANLANDI) + LIMONARIYA-SPEC-TOLIQ.md §17.10
- **Далил:** grep 'monthlyTarget|ойлик мақсад' apps/ → 0 hit

### 🟡 [P3] Ko'p-filialli arxitektura (hozir 1 filial, ertaga kengayadi — §2 texnologiya talabi) — auditning infra domenida tilga olinmagan

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §2 + §14 (2-bosqich 'ko'p filial')
- **Далил:** apps/api/src/db/schema.ts:26 branches jadvali + users.branchId bor, seed'da 1 filial (seed.ts:37); filial tanlash/filtrlash logikasi yo'q

### ❌ [P3] Bozor xaritasi: bozorchi GPS nuqtalaridan direktorga OYLIK 'bozor xaritasi' vizual hisoboti — audit GPS avto-yozishni aytgan, xarita hisobotini emas

- **Манба:** LIMONARIYA-SPEC-TOLIQ.md §12
- **Далил:** grep 'gps|geoloc|latitude' apps/ → 0 hit (hatto GPS yozish ham hali kodda yo'q)

---

## ✅ МУСТАҲКАМ ҚУРИЛГАНИ ТАСДИҚЛАНДИ (қисқа)

Обвалка ядроси (±5% баланс, таннарх движок, суяк/чарви cost=0) · чек ёпиш = идемпотент авто-списание (carcass даражасида) · хизмат ҳақи ҳар зал (10/10/15/0) · 46 стол харитаси (4 зал) · текин/ходим (сабаб мажбурий + кунлик лимит сигнали + рол чекловi) · P&L ажратиш (COGS/OPEX/тақсимот) · кун чегараси 06:00 · қарз ledger (қисман тўлаш, overpay блок) · камомад сигнали · PWA + домен + Docker изоляция · PIN auth + 5 рол · каталог 289 + техкарта муҳаррири + «техкарта йўқ» белгиси.

*La Limonariya · plan-gap-audit · 17 агент · 2026-07-02*