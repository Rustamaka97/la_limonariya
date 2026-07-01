# 🍋 Limonariya — restoran boshqaruv tizimi
**Ombor, obvalka, kassa, moliya va analitika — bitta joyda, aynan La Limonariya uchun yasalgan.**

## 🔧 Hozirgi muammo

Hozir hisob-kitob **qo'lda** — Excel va Clopus orqali. Muammo modelda emas, **modelingiz to'g'ri**. Muammo shundaki, hammasini **qo'lda yuritish** kerak, va aynan shu joyda xatolar kelib chiqadi:

- Har bir kirim-chiqimni odam yozadi → unutiladi, adashadi, kechikadi.
- Tushaning obvalkasi, qismlarning tannarxi, yo'qotish — bularning hammasi qog'ozda yoki kallada qoladi.
- Kim qancha sotgani, qancha qarz, qancha go'sht qolgani — aniq emas.

Clopus esa **kassa** dasturi: u sotuvni yozadi, lekin **tannarxni ham, ombor qoldig'ini ham bilmaydi**. U sizga "bugun qancha pul tushdi" deydi, ammo **"qancha foyda qoldi"** va **"qayerda pul oqib ketyapti"** deya olmaydi.

> **Model to'g'ri — faqat qo'lda bajarish susayadi. Biz aynan shu bajarishni dasturga o'tkazamiz.**

## 🏗 Biz nima quramiz

Bitta **tez veb-dastur** — ham telefonda, ham kompyuterda ishlaydi. Ichida hamma narsa bir-biriga ulangan:

- **Ombor** — har bir mahsulot qoldig'i, ikki muzlatkich bo'yicha.
- **Obvalka** — tushani qismlarga ajratish, har qismning haqiqiy tannarxi.
- **Kassa (POS)** — zal va soboy sotuvi, to'lovlar, qarz daftari.
- **Moliya** — kirim, chiqim, qarzlar, seyfdagi naqd.
- **Analitika** — foyda, tannarx, top taomlar, zararsizlik nuqtasi.

Qo'lda Excelga yozish o'rniga — dastur **o'zi yozadi, o'zi hisoblaydi, o'zi tahlil qiladi**.

### Asosiy g'oya

> **Qoldiq "saqlanmaydi" — o'zi hisoblanadi.**
> Har bir harakat (kirim / chiqim) yoziladi, qoldiqni dastur avtomatik chiqaradi. Shuning uchun qoldiqni **qo'lda o'zgartirib, "to'g'rilab" bo'lmaydi** — raqam o'ynalmaydi.

> **Dastur o'zi tahlil qiladi.**
> Siz barcha eski obvalkalarni berasiz, dastur har qism uchun **normal chiqimni o'zi o'rganadi** va g'ayritabiiy holatni **o'zi ushlaydi** (masalan, Maruf +13,9% — avtomatik aniqlanadi). Pul yoki mahsulot **qayerda oqib ketyapti** — dastur sizning shubhalaringizni raqam bilan tekshiradi. Bu shunchaki daftar emas — bu **aql**.

## 🔄 Qanday ishlaydi (oqim)

```
TUSHA  →  OBVALKA  →  QOLDIQ  →  SOTUV  →  TAHLIL / HISOBOT
(qo'y/    (lahm +      (ombor    (zal/     (foyda, tannarx,
 mol      qismlar,     o'zi      soboy,     yo'qotish, top
 xarid)   har biri     hisob-    kassa,     taom, shubhali
          tarozidan)   lanadi)   qarz)      joylar)
```

Har bir tusha xaridi **o'z narxini** saqlaydi. Obvalkada lahm va qismlar (shashlik, shapok, dumba, suyak, farsh, korejka...) **tarozidan o'tadi** — vazn balansi doim yopiladi. Sotuvda esa har taom **tex-karta bo'yicha** ombordan avtomatik chiqim bo'ladi (spisaniye). Oxirida dastur sizga **pulni ham, haqiqiy foydani ham** ko'rsatadi — qarz va qolgan go'sht hisobga olingan holda.

---

## 💡 Obvalka va haqiqiy tannarx

Bu — dasturning eng kuchli joyi. Siz go'shtni butun tusha sotib olasiz, lekin sotuvga **qismlar** ketadi: shashlik, shapok, dumba, suyak, farsh, korejka, va hokazo. Har bir qismning haqiqiy tannarxini bilmasangiz — qayerda foyda, qayerda zarar — buni hech qachon aniq ko'rib bo'lmaydi. Dastur buni siz uchun **o'zi** hisoblaydi.

> **Har bir tusha o'z narxini ko'taradi.**
> Suyak bepul — uning narxi go'shtga o'tadi. Shuning uchun "1 kg lahm" qancha turishini dastur aniq biladi.

### Misol: bitta qo'y tushasi

Aytaylik, qassobdan **100 kg qo'y** olib keldingiz, narxi **5 000 000 so'm**. Obvalkadan keyin u quyidagi qismlarga bo'linadi:

| Qism | Vazn (kg) | Ulush | Tannarx (so'm) | 1 kg tannarxi |
|---|---:|---:|---:|---:|
| Shashlik (premium) | 25 | 30% | 1 500 000 | 60 000 |
| Korejka (premium) | 10 | 14% | 700 000 | 70 000 |
| Dumba | 8 | 8% | 400 000 | 50 000 |
| Shapok / farsh | 22 | 22% | 1 100 000 | 50 000 |
| Oddiy lahm | 25 | 26% | 1 300 000 | 52 000 |
| **Suyak** | 10 | 0% | **0** (bepul) | — |
| **Jami** | **100** | **100%** | **5 000 000** | — |

Bu yerda muhim qoida: **suyak bepul hisoblanadi**, ya'ni uning og'irligi tannarxga qo'shilmaydi, balki **suyak narxi go'shtga taqsimlanadi**. Shuning uchun premium qismlar (korejka, shashlik) ko'proq qiymat ko'taradi — chunki ular qimmatroq sotiladi.

### Yo'qotishni ham hisobga oladi

Obvalka paytida bir oz go'sht yo'qoladi — qirindi, qonsuv, qovurg'aga yopishgan qism. Aytaylik, **10 kg yo'qoldi**. Demak 100 kg emas, faqat **90 kg** sotiladigan go'sht qoldi:

> **5 000 000 so'm ÷ 90 kg = 55 556 so'm / kg** — bu go'shtning **haqiqiy** tannarxi.
> Agar yo'qotishni hisobga olmasangiz, 50 000 so'm deb o'ylaysiz va har kg da **5 556 so'm** zararni sezmaysiz.

Dastur bu farqni har safar o'zi ko'rsatadi.

### Hamma narsa tarozidan o'tadi — balans yopiladi

Obvalkada hech narsa "yo'qolib qolmaydi". Har bir qism tortiladi:

- **Sotiladigan qismlar** — shashlik, korejka, dumba, shapok, farsh, lahm
- **Brak = Musor** — yaroqsiz qism, bitta joyga yoziladi
- **Charvi** — alohida hisoblanadi
- **Yo'qotish** — qirindi, qonsuv (norma bo'yicha)

Hamma og'irlik qo'shilganda **tusha vazniga teng chiqishi shart**. Agar chiqmasa — dastur darrov ogohlantiradi. Shunday qilib **vazn balansi har safar yopiladi**, hech bir kilogramm "g'oyib" bo'lolmaydi.

### Dastur normani O'ZI o'rganadi

Mana eng zo'r joyi. Siz bizga barcha **eski obvalka yozuvlaringizni** berasiz. Dastur ularni o'qib, har bir qism uchun **normal chiqishni o'zi hisoblab chiqaradi** — masalan, "100 kg qo'ydan o'rtacha 25 kg shashlik chiqadi". Bu sizning **haqiqiy** raqamlaringiz, kitobdan emas.

Shundan keyin har bir yangi obvalka shu norma bilan solishtiriladi:

> **Maruf bugun +13.9% ortiqcha farsh chiqardi** — dastur buni darrov ushlaydi va sizga ko'rsatadi.

Bu shunchaki yozib qo'yish emas — bu **aql bilan tekshirish**. Qayerda go'sht ko'p ketyapti, qayerda kam chiqyapti, kim norma buzyapti — hammasi o'zi ko'rinadi. Siz orqangizda turmasangiz ham, dastur sizning o'rningizga nazorat qiladi.

---

## 📦 Ombor, inventarizatsiya va ishlab chiqarish

Obvalkadan chiqqan qismlar omborga tushadi — endi ularni qanday saqlash va hisoblashni ko'ramiz. La Limonariyada ombor ikkita — har biri alohida hisoblanadi:

| Ombor | Nimaga | Qoldiq |
|---|---|---|
| **Oshxona muzlatkichi** | Kunlik ish uchun — qo'l ostidagi go'sht, yarim-tayyorlar | O'zining qoldig'i |
| **Katta muzlatkich** | Zaxira, ko'p saqlanadigan mahsulot | O'zining qoldig'i |

Har bir mahsulot **qaysi omborda turgani** aniq bilinadi. Bir ombordan ikkinchisiga ko'chirilsa — bu ham harakat sifatida yoziladi: bir joydan chiqim, ikkinchisiga kirim. Shunda hech narsa "yo'qolmaydi".

### Har kungi inventarizatsiya

Inventarizatsiyani **omborchi (skladchi) har kuni** o'tkazadi. Dastur ekranda har bir mahsulot bo'yicha **dastur hisoblagan qoldiqni** ko'rsatadi — omborchi haqiqatda bor narsani kiritadi.

- Agar **farq topilsa** (kam yoki ortiq) — omborchi **sababini yozadi**.
- Bu farqni **direktor tasdiqlaydi**. Direktor tasdig'isiz farq "yopilmaydi".
- Manfiy qoldiq (mahsulot minusga ketsa) ham xuddi shunday — **sabab + direktor tasdig'i** bo'lmasa, o'tmaydi.

> **Hech bir farq jimgina yo'qolmaydi — har biri sabab bilan yoziladi va direktor ko'radi.**

Shu tarzda har kuni kichik tekshiruv bo'ladi: muammo bir oydan keyin emas, **o'sha kuniyoq** ko'rinadi.

### Elektron tarozi — avtomatik vazn

Maqsad — **tushani ham, obvalka qismlarini ham elektron tarozida tortish** va vazn dasturga **avtomatik** tushishi. Qo'lda raqam yozish kerak emas:

- Omborchi xato yozolmaydi — tarozi o'zi yuboradi.
- Vazn balansi (kirgan go'sht = chiqqan qismlar) **doim aniq yopiladi**.
- Tortishda vaqt tejaladi, hamma narsa bir xil, ishonchli.

### Ishlab chiqarish — partiya bilan

Oshxona har bir buyurtmaga alohida emas, **katta qozonda partiya** qilib tayyorlaydi. Masalan, bir partiya farsh yoki bir qozon tayyor mahsulot.

- Partiya tayyorlanganda — sarflangan xom-ashyo **ombordan chiqadi**, tayyor bo'lgan **yarim-tayyor mahsulot kirim** bo'ladi.
- Yarim-tayyorlar (masalan, tayyorlangan farsh, marinadlangan go'sht) **alohida qoldiq** sifatida turadi — ular ham omborning bir qismi.

Shunday qilib siz **qancha tayyor mahsulot borligini** har doim ko'rasiz, xom-ashyo va tayyor mahsulot aralashib ketmaydi.

### Tex-kartalar — sotuv o'zi chiqim qiladi

Har bir taomning **tex-kartasi (grammovkasi)** dasturda turadi — qaysi taomga qancha ingredient ketishi aniq yozilgan.

- **Narx fiks** — har bir taomning sotuv narxi barqaror, o'zgarmaydi.
- **Retseptlar barqaror** — bir marta kiritilgan grammovka doim ishlaydi. Faqat **Farsh** istisno: u **har safar boshqacha** (ad-hoc) bo'lgani uchun har gal alohida belgilanadi.
- Taom **sotilganda** — tex-karta bo'yicha kerakli ingredientlar **ombordan o'zi chiqadi** (avtomatik spisaniye). Kassir yoki ofitsiant qo'lda hech narsa yechmaydi.

> **Bitta shashlik sotilsa — go'shti, ziravori, noni ombordan o'zi yechiladi. Siz faqat sotuvni bosasiz, qolganini dastur qiladi.**

Shu sabab kun oxirida qoldiq **haqiqatga mos** turadi: sotilgan narsa avtomatik hisobdan chiqqan bo'ladi, qo'lda hisob-kitob shart emas.

---

## 💳 Sotuv, kassa, to'lov va qarz

Bu — pul kirib keladigan joy. Shuning uchun bu yer **eng tartibli va eng nazoratli** bo'lishi kerak. Dastur har bir sotuvni, har bir so'mni yozib boradi — hech nima ko'rinmay qolmaydi.

### Sotuv turi va xizmat haqi

Har bir buyurtma boshida **tur** tanlanadi:

| Tur | Xizmat haqi | Izoh |
|---|---|---|
| **Zal** (ichkarida) | **+10%** | mehmon zalda o'tirib ovqatlanadi |
| **Soboy** (o'zi olib ketish) | **0%** | xizmat haqi yo'q |

> **Xizmat haqi qo'lda emas — turga qarab dastur o'zi qo'shadi.**
> Zal buyurtmasiga 10% avtomatik qo'shiladi, soboyga umuman qo'shilmaydi. Kassir adashtirib yubora olmaydi.

### To'lov turlari

Mijoz to'rt xil usulda to'laydi:

- **Naqd** — qo'lma-qo'l pul
- **Click** — telefon orqali
- **Payme** — telefon orqali
- **Qarz** — keyin to'laydi (qarz daftariga yoziladi)

Har bir buyurtmaning to'lov turi yoziladi. Kun oxirida dastur o'zi ajratib beradi: bugun qancha **naqd**, qancha **Click/Payme**, qancha **qarzga** ketdi.

### 📒 Qarz daftari

Qog'ozdagi qarz daftari endi dastur ichida — lekin ancha aqlli:

- Har bir qarzdor uchun **ism va telefon** raqami yoziladi
- Mijoz **qisman to'lashi** mumkin (masalan 500 000 dan 200 000 to'ladi — qoldiq 300 000 bo'lib turaveradi)
- **Limit yo'q** — qancha qarz bersangiz shuncha yozaveradi
- Qarzni **kassir ochadi va kassir yopadi**
- **Direktor hammasini ko'radi** — kim qancha qarzdor, kim qachondan beri to'lamayapti

> **Qarz qoldig'i ham o'zi hisoblanadi — qalbakilashtirib bo'lmaydi.**
> Har bir qarz va har bir to'lov yoziladi, qoldiqni dastur o'zi chiqaradi. "Hisobni" qo'lda o'zgartirib, qarzni yashirib qo'yib bo'lmaydi.

### Kassa nazorati

Pul kassada — shuning uchun bu yer maxsus himoyalangan:

- **Kamomad (yetishmovchilik)** topilsa — to'g'ridan-to'g'ri **direktorga ko'rinadi**. Dastur uni o'zi kassirning bo'yniga yozmaydi — qaror direktorniki.
- **Kun oxiri naqd pul → seyf.** Kun yopilganda dastur bugungi naqd summasini ko'rsatadi, u seyfga tushadi.
- **Vozvrat (pul qaytarish)** — faqat **kassir + direktor ruxsati** bilan. Bir o'zi kassir pulni qaytarib yubora olmaydi.
- **O'chirilgan taom** — agar buyurtmadan biror taom o'chirilsa, bu **jurnalga yoziladi** va direktorga ro'yxat bo'lib boradi: qachon, qaysi taom, kim o'chirgan.

> **Har bir g'ayritabiiy harakat — iz qoldiradi.**
> Kamomad, vozvrat, o'chirilgan taom — hammasi yoziladi va direktorga ko'rinadi. Yashirin hech narsa qolmaydi.

### Banket

Katta buyurtmalar (banket) uchun:

- **Har bir taom alohida** hisoblanadi — kishi boshiga emas, balki real buyurtilgan taomlar bo'yicha
- **Avans (oldindan to'lov)** — **ixtiyoriy**: mijoz xohlasa oldindan beradi, dastur uni yozib qo'yadi va keyin umumiy hisobdan ayiradi

---

## 📊 Direktor paneli, tahlil va nazorat

Bu — butun tizimning **yuragi**. Boshqa hamma joy (ombor, obvalka, kassa, sotuv) ma'lumot yig'adi — bu yer esa o'sha ma'lumotni **sizning ko'zingiz** bo'lib ko'rsatadi. Siz har kuni telefonni ochasiz va biznesingiz qanday yurganini **bir qarashda** ko'rasiz.

### Kunlik 4 raqam

Direktor panelini ochsangiz, eng yuqorida har kunning to'rtta asosiy raqami turadi:

| Raqam | Nimani ko'rsatadi |
|---|---|
| 💵 **Tushum** | Bugun qancha pul tushdi (zal + soboy, hamma to'lov turi) |
| 📈 **Sof foyda** | Tannarx, xizmat va chiqimlar ayrilgandan keyin **qo'lda qolgan** pul |
| 🧾 **Qarzlar** | Mijozlar sizdan qancha olib, hali to'lamagan (qarz daftari qoldig'i) |
| 🏆 **Top taom** | Bugun eng ko'p sotilgan taomlar — nima yaxshi ketyapti |

> **Har kuni 4 raqam — biznesingizning puls o'lchovi.**
> Telefonni ochib, 5 soniyada bugun yaxshimi yoki yomonmi — bilib olasiz.

### Pul ham, haqiqiy foyda ham

Bu yerda muhim farq bor. Ko'p egalar faqat **kassadagi pulga** qaraydi — bu xato. Dastur sizga **ikki xil** rasmni ko'rsatadi:

- **Pul (kassa):** bugun qo'lga, Click/Payme'ga real tushgan pul. Bu — naqd haqiqat.
- **Haqiqiy foyda:** bunda dastur **qarzga ketgan** taomni (hali pul kelmagan) va **omborda qolgan go'sht/mahsulot** qiymatini ham hisobga oladi.

Misol: kassada bugun pul kam ko'rinishi mumkin, lekin omborda hali ko'p go'sht turibdi yoki katta qarz bor — demak biznes aslida zarar qilmagan. Yoki aksincha: kassa to'la, lekin hammasini qarzga sotgansiz — bu xavfli. **Dastur ikkalasini ham ochiq ko'rsatadi, siz aldanmaysiz.**

### Zararsizlik nuqtasi

Dastur sizga har oy uchun **zararsizlik nuqtasini** hisoblaydi — ya'ni "ijaraga, oyliklarga, elektrga ketgan xarajatni qoplash uchun kuniga qancha sotishim kerak" degan raqam.

> **Bugun shu chiziqdan o'tdimmi yoki yo'qmi — dastur aniq aytadi.**
> "Kuniga 4 200 000 so'm sotsam, nolga chiqaman. Bugun 5 100 000 sotdim — demak sof 900 000 foyda." Hammasi ko'z oldingizda.

## 🔍 Dastur o'zi tahlil qiladi — pul qayerda yo'qolayotganini topadi

Mana bu — eng kuchli yangilik. Dastur faqat raqamlarni **yozib qo'ymaydi** — u o'zi **o'ylaydi**. Har bir harakatni normal holat bilan solishtiradi va biror narsa noto'g'ri bo'lsa — **sizga o'zi aytadi**. Sizning ko'p gumonlaringiz bor edi; endi gumon emas, **aniq raqam** bo'ladi.

Dastur quyidagi joylarda "teshik" qidiradi:

- **Obvalka chiqimi normadan past.** Siz menga barcha eski obvalka yozuvlaringizni berasiz. Dastur ulardan o'zi **normani o'rganadi** — masalan, bir qo'ydan o'rtacha qancha lahm, qancha shashlik chiqishi kerakligini. Keyin har yangi obvalkani shu norma bilan solishtiradi. Agar bir kuni go'sht kamroq chiqsa — dastur darrov belgilaydi.
- **Ortiqcha spisaniye (chiqim).** Sotuvga tushgan taomlar tex-karta bo'yicha avtomat hisoblanadi. Agar ombordan undan **ko'proq** mahsulot ketgan bo'lsa — bu ortiqcha. Dastur farqni ko'rsatadi.
- **Porsiya chetlashishi.** Tex-karta bo'yicha bitta shashlikka shuncha go'sht ketishi kerak. Agar amalda har porsiyaga ko'proq ketayotgan bo'lsa — go'sht "ortiqcha" sarflanyapti yoki noto'g'ri tortilyapti.
- **Kassa kamomadi.** Kun oxiri hisob-kitobda pul kam chiqsa — dastur summasini va qaysi smenada bo'lganini ko'rsatadi.
- **Tekin (o'chirilgan) ovqat.** Oshxonaga ketgan yoki bekor qilingan taom o'chirilsa — hammasi jurnalga tushadi. Direktor kuni bilan: nima, qancha, kim o'chirgan — ro'yxatini ko'radi.

> **Maruf misoli:** bir obvalkada chiqim normadan **+13,9%** chetlashgan edi — dastur buni **o'zi ushlaydi** va sizga belgilab beradi. Siz hech narsa qidirib o'tirmaysiz — dastur o'zi topib, oldingizga qo'yadi.

Bularning hammasi **bitta ogohlantirish ro'yxatida** to'planadi. Siz ertalab panelni ochasiz — agar qizil belgi bo'lsa, demak bir joyda e'tibor kerak. Bo'lmasa — hammasi joyida. **Qidirish, shubhalanish, "kim oldi?" deb bosh qotirish — yo'q. Dastur o'zi ko'rsatadi.**

### Rollar va PIN

Har bir xodim faqat o'ziga kerakli joyni ko'radi. Har kimga **shaxsiy PIN-kod** beriladi — tizimga shu PIN bilan kiradi, kim nima qilgani yoziladi.

| Rol | Nimani ko'radi va qiladi | Tannarx / foydani ko'radimi |
|---|---|---|
| 👑 **Direktor** | **Hammasini:** sotuv, foyda, tannarx, qarzlar, ogohlantirishlar, hamma hisobot | ✅ Ha — to'liq |
| 📦 **Admin / Skladchi** | Obvalka, kirim (xarid), kunlik inventarizatsiya, ombor qoldig'i | ❌ Yo'q |
| 💳 **Kassir** | Sotuv (zal/soboy), to'lov qabul qilish, qarz daftari (ochish/yopish) | ❌ Yo'q — sof narxni ko'rmaydi |
| 🍽️ **Ofitsiant** | Menyu, buyurtma olish, stolga biriktirish | ❌ Yo'q — pulga aralashmaydi |

> **Tannarx va sof foyda — faqat sizning ko'zingiz uchun.**
> Kassir ham, ofitsiant ham mahsulot necha pulga tushishini ko'rmaydi. Bu siz uchun maxfiy qoladi.

**Sotuv attributsiyasi (oyliksiz).** Tizimda oylik yoki tabel **yo'q** — biz bu yerda maosh hisoblamaymiz. Lekin har bir sotuv **qaysi ofitsiant va qaysi kassir** orqali o'tganini biriktirib qo'yamiz. Shuning uchun siz kelajakda "kim ko'p sotyapti", "kim ko'proq qarzga beryapti" degan savollarga ham javob ola olasiz — hech kimning maoshiga aralashmasdan, faqat **kim qanday ishlayapti** degan toza rasmni ko'rasiz.

---

## 🚀 Ishga tushirish bosqichlari

Dasturni **bir zumda emas, bosqichma-bosqich** quramiz. Har bir bosqich oldingisining ustiga qo'yiladi — shunda har qadamda ishlaydigan, ko'rsa bo'ladigan natija bor.

| # | Bosqich | Nima bo'ladi |
|---|---------|--------------|
| 1 | **Katalog** | 289 ta mahsulot, menyu, narxlar — hammasi dasturda |
| 2 | **Obvalka + qoldiq + tannarx** ⭐ | Tusha → lahm + qismlar, har tushaning o'z narxi, **haqiqiy tannarx** va omborda **avto-qoldiq** |
| 3 | **Kunlik jadval** | Omborchi har kuni inventarizatsiya, farq → sabab + direktor tasdig'i |
| 4 | **Hisobot + Direktor analitikasi** | Tushum, sof foyda, qarzlar, top taom, zararsizlik nuqtasi |
| 5 | **Tex-kartalar (avto-spisaniye)** | Taom sotilsa, retsept bo'yicha mahsulot **o'zi chiqim bo'ladi** |
| 6 | **Kassa: to'lov + qarz** | Naqd / Click / Payme / qarz, qarz daftari, kamomad direktorga |
| 7 | **Tahlil / anomaliya dvigateli** | Dastur tarixni o'rganadi, **normadan chetlanishni o'zi topadi**, pul/mahsulot qayerdan ketayotganini ko'rsatadi |
| 8 | **Kelajak** | QR / AR-menyu, ko'p filial, doimiy mijozlarga loyalty |

> **Eng muhimi: foyda va tannarxni siz allaqachon 2-bosqichdayoq ko'rasiz.**
> Hamma narsani kutib o'tirmaysiz — eng asosiy ustunlik (haqiqiy tannarx + avto-qoldiq) birinchilardan bo'lib ishlaydi.

## 📋 Sizdan nima kerak

Dasturni to'liq, **aynan sizning restoraningizga moslab** qurish uchun bir nechta narsa kerak bo'ladi.

**Bizda allaqachon bor:**
- ✅ **Katalog** — 289 ta mahsulot tayyor
- ✅ **Obvalka modeli** — tusha → lahm + qismlar mantig'i va namunalari
- ✅ **Go'sht narxi** — hisob-kitob uchun asos

**Sizdan kutamiz:**
- 📋 **Barcha tarixiy obvalkalar** — eski yozuvlaringiz. Dastur ularni o'rganib, har bir qism uchun **normal chiqim normasini o'zi aniqlaydi** (anomaliyani topish uchun shu kerak)
- 📋 **Tex-kartalar** — 7 ta shashlik + baliq retseptlari, grammovkalar
- 📋 **Yo'qotish % normasi** — obvalkada o'rtacha qancha brak / yo'qotish bo'lishini
- 📋 **Kunlik xarajatlar** — gaz, svet, oylik, ijara (sof foyda va zararsizlik nuqtasini to'g'ri hisoblash uchun)

> **Qancha ko'p tarixiy ma'lumot bersangiz, dastur shuncha aqlli bo'ladi.**
> Sizning eski yozuvlaringiz — bu dastur uchun "darslik". U shulardan o'rganib, normani o'zi quradi.

## 🛠 Texnologiyalar

Dastur zamonaviy va ishonchli texnologiyalarda quriladi:

- **Next.js + Supabase** — tez, barqaror, himoyalangan baza
- **Telefon + kompyuter** — har qanday qurilmada ishlaydi (kassada kompyuter, qo'lda telefon)
- **Ko'p-filialli** — bugun bitta restoran, ertaga 2-filial yoki markaziy sex qo'shilsa — tizim tayyor
- **Individual** — bu **tayyor shablon emas**, aynan La Limonariya uchun, sizning modelingiz bo'yicha quriladi

> **Bu dastur — sizniki.** Boshqa restoranning andozasi emas, balki sizning ish uslubingizga moslab tikilgan kostyum.

## ✅ Xulosa

Bu dastur bilan siz quyidagilarga ega bo'lasiz:

- ✅ **Haqiqiy tannarx** — har bir taom va qismning aniq narxi, obvalkadagi yo'qotish bilan
- ✅ **Avto-qoldiq** — omborda nima qolganini dastur o'zi hisoblaydi, qo'lda soxtalashtirib bo'lmaydi
- ✅ **Aqlli tahlil** — dastur normadan chetlanishni o'zi topadi, pul qayerdan "oqayotganini" ko'rsatadi
- ✅ **To'liq nazorat** — kassa, qarzlar, sof foyda, zararsizlik nuqtasi — hammasi bir ekranda
- ✅ **Rol bo'yicha himoya** — har kim faqat o'ziga kerakli narsani ko'radi, tannarx faqat sizda
- ✅ **Kelajakka tayyor** — ko'p filial, QR/AR-menyu, loyalty — hammasi shu poydevorga quriladi

Sizning modelingiz **to'g'ri edi** — faqat uni qo'lda yuritish qiyin edi. Endi dastur shu modelni o'zi yuritadi, hisoblaydi va sizga eng muhim narsani beradi: **xotirjamlik va aniq raqamlar.**

*Limonariya · pilot loyiha · Rustam aka uchun tayyorlandi*