# 🍋 Limonariya — Ombor va obvalka hisobi tizimi

**Restoranni avtomatlashtirish — pilot loyiha**
Qo'lda hisobni (Excel / Clopus) o'z dasturimizga almashtirish.

---

## Hozirgi muammo

Hozir go'sht hisobi qo'lda jadvalda yuritiladi. Har kuni har bir mahsulot bo'yicha yozish kerak: qancha kirdi, qancha chiqdi, qancha qoldi. Shuning uchun:

- Qoldiqlar oson "yo'qoladi" va to'g'ri kelmaydi.
- Har bir qismning **haqiqiy tannarxini** (1 kg shashlik, shapok, dumba…) hech kim hisoblamaydi.
- Obvalkadagi **yo'qotish ko'rinmaydi** — qancha "nolga ketdi".
- Tez hisobot yo'q: kun bo'yicha, oy bo'yicha, qaysi mahsulotda zarar.

---

## Biz nima quramiz

Oddiy va tez veb-dastur — **telefon va kompyuterda** ishlaydi. Omborchi obvalkani to'g'ridan-to'g'ri telefondan kiritadi, rahbar esa istalgan paytda qoldiq va hisobotlarni ko'radi.

### Asosiy g'oya

> **Qoldiq "saqlanmaydi" — o'zi hisoblanadi.**
> Har bir harakat (kirim / chiqim) yoziladi, qoldiqni dastur avtomatik hisoblaydi. Shuning uchun qoldiqni **qo'lda o'zgartirib bo'lmaydi**, va doim ko'rinadi — qayerdan keldi, qayerga ketdi.

---

## Qanday ishlaydi (oqim)

```
TUSHA (qo'y / mol)  →  OBVALKA  →  QOLDIQ (qismlar omborda)  →  CHIQIM (oshxona/sotuv)  →  HISOBOTLAR
   100 kg, narx        ajratish      shashlik, shapok, dumba…       qoldiqdan chiqarish        tannarx, yo'qotish
```

1. **Tusha kirimi.** Kiritamiz: qaysi go'sht (qo'y/mol), vazn, xarid narxi.
2. **Obvalka.** Tushani qismlarga ajratamiz (shashlik, shapok, dumba, suyak, farsh…). Dastur darhol **balansni** ko'rsatadi: «100 dan 90 kg kiritildi, yo'qotish 10 kg = 10%».
3. **Qoldiq.** Har bir qism avtomatik omborga tushadi.
4. **Chiqim.** Oshxona/sotuv qismlarni ombordan chiqaradi (kunlik jadvalda, odatdagi Excel kabi).
5. **Hisobotlar.** Istalgan paytda: qoldiqlar, davr bo'yicha kirim-chiqim, yo'qotish %, har qismning 1 kg tannarxi.

---

## Dastur ekranlari

| Ekran | Vazifasi |
|---|---|
| **Dashbord** | Barcha qismlarning joriy qoldig'i, bugungi kirim-chiqim, kam/manfiy qoldiq ogohlantirishi. |
| **Obvalka** | Tusha → qismlar. Jonli vazn va yo'qotish balansi. Omborchining asosiy ekrani (telefondan). |
| **Kunlik jadval** | Odatdagi «Excel kabi» ko'rinish: sanani tanladi → har mahsulot bo'yicha kirim / sotuv / qoldiq. |
| **Katalog** | Barcha qism va taomlar ro'yxati (qo'shish / o'zgartirish / o'chirish). |
| **Hisobotlar** | Davr → kirim-chiqim, yo'qotish %, tannarx, grafiklar, yuklab olish. |

---

## 💡 Asosiy ustunlik — tannarx va yo'qotish

Dastur har bir qismning **haqiqiy** tannarxini, obvalkadagi yo'qotishni hisobga olib hisoblaydi.

**Misol.** Qo'y xarid qilindi: **100 kg — 5 000 000 so'm** (tirik vazn 50 000 so'm/kg).
Obvalkadan keyin:

| Qism | Vazn, kg | Narx ulushi | Tannarx, so'm | 1 kg, so'm |
|---|---:|---:|---:|---:|
| Shashlik | 30 | 33% | 1 666 667 | **55 556** |
| Shapok | 15 | 17% | 833 333 | 55 556 |
| Dumba | 10 | 11% | 555 556 | 55 556 |
| Suyak | 20 | 22% | 1 111 111 | 55 556 |
| Farsh | 10 | 11% | 555 556 | 55 556 |
| Charvi | 5 | 6% | 277 778 | 55 556 |
| **Yo'qotish** | **10** | — | — | — |
| **Jami sotiladi** | **90** | 100% | **5 000 000** | — |

> Tirik vazn 50 000 so'm/kg bo'lsa ham, **sotiladigan go'shtning haqiqiy tannarxi = 55 556 so'm/kg** — chunki 10 kg yo'qotishga ketdi va uning qiymati qolgan 90 kg ustiga tushdi.
>
> **Mana shu narsa qo'lda hisobda ham, Clopusda ham yo'q.** Endi taom narxini to'g'ri qo'yish mumkin — va yo'qotish normadan yuqori bo'lsa darhol ko'rinadi (demak zarar yoki o'g'irlik bor).

*Premium qismlar (korejka, shashlik) ko'proq qiymat «ko'tarishi», suyak esa kamroq — moslashuvchan.*

---

## Ishga tushirish bosqichlari

| Bosqich | Nima olamiz | Siz uchun natija |
|---|---|---|
| **1. Katalog** | Barcha qism va taomlar ro'yxati | Asos tayyor |
| **2. Obvalka + qoldiq** ⭐ | Tusha → qismlar → ombor + tannarx | **Asosiy vazifa hal bo'ldi** |
| **3. Kunlik jadval** | Kunlar bo'yicha kirim/sotuv/qoldiq | Excel'ni to'liq almashtirish |
| **4. Hisobotlar** | Yo'qotish %, tannarx, grafiklar | Nazorat va tahlil |
| **5. Tex-kartalar (retseptlar)** | Taom sotildi → ingredient o'zi chiqdi | Oshxona avtomatlashtirildi |

Navbat bilan ishga tushiramiz — foyda **2-bosqichdayoq** paydo bo'ladi.

---

## Sizdan nima kerak

- Barcha qism va taomlar ro'yxati (hozirgi jadvaldan olsa bo'ladi — u bizda bor).
- Taxminiy chiqish normalari: qo'y / mol odatda qancha beradi (yo'qotishni nazorat qilish uchun).
- 1–2 kishi, kim ma'lumot kiritadi (omborchi, menejer).

---

## Texnologiyalar (qisqacha)

Zamonaviy veb-stek (Next.js + Supabase). Telefon va kompyuter brauzerida ishlaydi, ma'lumotlar himoyalangan bazada, login/parol va rollar orqali kirish. Dastur **individual** — sizning restoran uchun yozilgan, shablon emas.

---

## Xulosa

Siz quyidagi dasturni olasiz:

- ✅ qoldiqni xatosiz yuritadi (uni qalbakilashtirib bo'lmaydi),
- ✅ har qismning tannarxi va yo'qotishni hisoblaydi,
- ✅ oshxonada telefondan, ofisda kompyuterdan ishlaydi,
- ✅ Excel va Clopusni to'liq almashtiradi,
- ✅ restoran bilan birga o'sadi (filiallar, oshxona, retseptlar).

---

*Limonariya · pilot loyiha · Rustam aka uchun tayyorlandi*
