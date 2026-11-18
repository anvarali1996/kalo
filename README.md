# KALO — AI food photos, scan packs and password confirmation

- AI photo scanning with editable portions, estimated calories/macros, and idempotent meal saves.
- Five free scans for existing and new users; repeatable one-time Stripe packs of five scans for €4.99 EUR.
- PostgreSQL credit accounting and transaction history with verified, idempotent webhooks.
- Translated password confirmation and show/hide controls in Uzbek, English, Russian and Latvian.
- The existing free Open Food Facts barcode scanner remains unchanged.

**Setup and release:** [SETUP-AI.md](SETUP-AI.md) includes exact OpenAI, Stripe, Neon migration and Vercel steps.
Use `npm run db:migrate` for this release; `db:push` does not install accounting functions or the welcome-credit trigger.

---

# KALO — kaloriya va vazn nazorati

**Next.js 16 · React 19 · TypeScript · Node.js · Neon PostgreSQL · Drizzle ORM · Tailwind CSS v4 · ZXing · Open Food Facts v3**

KALO — 4 tilda (o‘zbekcha, inglizcha, ruscha, latishcha) ishlaydigan, telefon kamerasi bilan barcode o‘qiydigan va vazn kamaytirishni rejalashga yordam beradigan web-ilova.

## Nimalar ishlaydi?

- **Shaxsiy reja:** yosh (18+), jinsga bog‘liq formula koeffitsiyenti, bo‘y, vazn, maqsad vazni va faollik darajasi asosida BMR, taxminiy TDEE, kaloriya maqsadi, defitsit, haftalik vazn o‘zgarishi va taxminiy muddat.
- **Skaner:** ZXing yordamida kamera yoki yuklangan rasmdan EAN/UPC barcode; raqamni qo‘lda kiritish ham mumkin. Kamera uchun **HTTPS yoki localhost** talab qilinadi.
- **Open Food Facts v3:** mahsulot nomi, brendi, rasmi, 100 grammdagi kkal, oqsil, yog‘, uglevod, shakar, tuz, kletchatka, Nutri-Score, NOVA guruhi, ingredientlar va allergenlar (faqat mavjud bo‘lsa).
- **Ovqat kundaligi:** porsiya grammini tanlash, kkal/makrolarni hisoblash, mahsulotni saqlash/o‘chirish, sana bo‘yicha ko‘rish; topilmagan ovqatni qo‘lda kiritish.
- **Vazn kuzatuvi:** sana bo‘yicha o‘lchovlar, trend grafigi, profil kaloriyalarining yangilanishi.
- **Lokal demo:** Neon ulanmagan holda ham ishlaydi; ma’lumot brauzer `localStorage` ida qoladi.
- **Neon hisobi:** email/parol bilan ro‘yxatdan o‘tish va kirish, bcrypt orqali parol xeshi, 30 kunlik httpOnly cookie-sessiya, foydalanuvchi uchun alohida profil/kundalik/vazn yozuvlari. Demo ma’lumotlari birinchi ro‘yxatdan o‘tishda import qilinadi (250 ta ovqat va 180 ta vazngacha).
- **4 til:** `lib/i18n.ts` va `lib/feature-i18n.ts` ichida interfeys iboralari har bir tilda; tanlangan til shu brauzerda saqlanadi.

## 1. Ishga tushirish

> Talab: **Node.js 20.9+**, npm va internet. Internetga ulangan kompyuterda quyidagilarni bajaring.

```bash
npm install
cp .env.example .env.local
npm run dev
```

`http://localhost:3000` ni oching. Hozircha `DATABASE_URL` bo‘lmasa ham **Demo** ishlaydi. Ro‘yxatdan o‘tish va foydalanuvchi ma’lumotlarini serverda saqlash uchun Neon ulanishi shart.

## 2. Neon PostgreSQL ulash

1. https://neon.tech/ saytida yangi project yaratib, **Connection details** dan `postgresql://...` pooled connection string ni nusxalang.
2. `.env.local` ichidagi kommentga olingan `# DATABASE_URL=...` namunani o‘chirib, o‘rniga **faol** `DATABASE_URL=postgresql://...` haqiqiy ulanishini yozing.
3. O‘zingizning **ishlaydigan email manzilingizni** `OFF_CONTACT_EMAIL=...` ga qo‘ying. Open Food Facts User-Agent uchun talab qiladi.
4. PostgreSQL jadvallarini yarating:

```bash
npm run db:migrate
npm run dev
```

Drizzle sxemasi `db/schema.ts` da. `db:generate` orqali keyinchalik migratsiya fayllarini ham yaratish mumkin. **Muhim:** AI va to‘lovlar uchun `npm run db:migrate` shart: u funksiyalar, triggerlar va bepul kreditlarni ham o‘rnatadi. Batafsil: [SETUP-AI.md](SETUP-AI.md).

## 3. Vercel deploy (keyingi bosqich)

1. Vercel loyihangizni oching yoki Vercel CLI bilan shu lokal loyihani ulang.
2. Framework: **Next.js**; Root Directory: `package.json` joylashgan papka.
3. **Settings → Environment Variables** da [SETUP-AI.md](SETUP-AI.md) jadvalidagi o‘zgaruvchilarni kiriting.
4. Deploydan oldin kerakli Neon bazada `npm run db:migrate` ni bajaring.
5. Stripe webhook manzilini sozlang va env o‘zgarishlaridan keyin qayta deploy qiling.
6. Ro‘yxatdan o‘tish/kirish, bepul barcode, AI skan, Stripe test xaridi va mobil kamerani tekshiring.

Vercel’da alohida Express server shart emas: Next.js `app/api/...` route handlerlari Node.js serverless funksiyalar sifatida ishlaydi. `next.config.ts` avtomatik mos.

## 4. Testlar

```bash
npm run typecheck
npm test
npm run build
```

## Loyiha tuzilishi

```text
app/
  page.tsx                 Dashboard / Scanner / Diary / Profile UI
  globals.css              Responsive dizayn
  api/auth/*               Register, login, logout, session
  api/profile              Profilni saqlash
  api/state                Foydalanuvchi holati
  api/diary, api/diary/[id] Kundalik yozish/o‘chirish
  api/weights              Vazn yozish
  api/products/[barcode]   Open Food Facts v3 + Neon cache
components/
  kalo-app.tsx             Ilova interfeysi va 4 ekran
  scanner.tsx              Kamera, rasm, barcode, qo‘lda kiritish
lib/
  calories.ts              BMR / TDEE / defitsit hisobi
  i18n.ts                  4 tildagi barcha tarjimalar
  server-auth.ts           Session cookie / token xeshi
  validations.ts           Zod sxemalar
  types.ts                 TypeScript modellar
db/
  schema.ts                PostgreSQL jadvallari
  index.ts                 Neon / Drizzle ulanishi
tests/                      Hisoblash testlari
```

## Formula va xavfsizlik

- BMR (Mifflin–St Jeor): `10 × vazn(kg) + 6.25 × bo‘y(sm) − 5 × yosh + S`, bu yerda `S = +5` (erkak), `S = −161` (ayol).
- TDEE ≈ BMR × faollik koeffitsiyenti (`1.2`, `1.375`, `1.55`, `1.725`, `1.9`).
- Rejalashtirilgan defitsit ≈ `haftalik maqsad(kg) × 7700 ÷ 7`; tavsiya etiladigan iste’mol ≈ `max(shartli ehtiyotkor chegara, TDEE − defitsit)`.
- Chegara MVP uchun taxminan 1200 (ayol) / 1500 (erkak) kkal. **Bu universal xavfsizlik kafolati emas.** Haftalik maqsad 0.1–0.75 kg orasida tekshiriladi. Kunlik maqsad **jismoniy mashqda alohida yoqilishi zarur bo‘lgan kaloriya emas**: bu ovqatdan olinadigan energiya bo‘yicha taxmin.
- Hisoblash 18 yoshdan kattalar uchun umumiy ma’lumot; homiladorlik/emizish, ovqatlanish buzilishlari va tibbiy holatlarda qo‘llanmaydi. Shifokor yoki dietolog bilan maslahatlashing.
- `kcal` va makrolar Open Food Facts’da bo‘lmasa `null` bo‘ladi: UI `—` ko‘rsatadi. Kaloriya yo‘q mahsulot avtomatik kundalikka yozilmaydi.

## Open Food Facts foydalanish qoidalari

- API: `GET https://world.openfoodfacts.org/api/v3/product/{barcode}.json?...`.
- **Rate-limit:** mahsulot GET uchun 15/min/IP; izlash uchun 10/min/IP. KALO mahsulotni Neon’da 7 kun cache qiladi, Next `fetch` cache ham 1 kun. Ko‘plab real foydalanuvchilar uchun qo‘shimcha throttling kerak.
- Har doim haqiqiy `OFF_CONTACT_EMAIL` o‘rnating. Kelajakda ularning API usage form ni ham to‘ldiring.
- Barcode **kamerada ZXing orqali o‘qiladi**, Open Food Facts esa **barcode raqamiga mos mahsulotni qidiradi**; OFF kamerani bevosita boshqarmaydi.
- Manba va litsenziyalar: https://world.openfoodfacts.org va https://opendatacommons.org/licenses/odbl/1-0/. Mahsulot rasmlarida ham alohida CC BY-SA shartlari bo‘lishi mumkin. Asl qadoqdan tekshirmasdan allergen yoki tibbiy qaror chiqarmang.
- Ma’lumotlar crowdsourced: xato, yetishmaydigan yoki boshqa davlatga tegishli mahsulotlar bo‘lishi mumkin.

## Productionga ommaviy chiqarishdan oldin

Bu **ishchi MVP kod bazasi**, lekin ommaviy sog‘liq ilovasi uchun yakuniy production xavfsizlik tekshiruvini talab qiladi:

- Email tasdiqlash, parolni tiklash, login va API endpointlarda server tomonlama rate limiting / bot himoyasi.
- Maxfiylik siyosati, account deletion, GDPR huquqlari, ma’lumotni olib chiqish (export) va foydalanuvchi roziligi.
- Neon backup va migratsiya tartibi, monitoring, funksional va kamera qurilmalari testlari, accessibility audit.
- Mifflin–St Jeor formulasi o‘rnini bosuvchi variantlar va professional oziqlanish tavsiyalari bilan klinik validatsiya.

## Litsenziya

Ilova manba kodi sizning loyihangiz uchun taqdim etilgan. Open Food Facts kontenti va tasvirlari o‘z litsenziyalariga bo‘ysunadi.
