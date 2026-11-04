# ⚡ PaxtaGram Stars Promo Snatcher Bot

Paxta.online saytida `@umar` tomonidan e'lon qilingan promo-kodlarni soniyaning ulushlarida (millisekundlarda) ilg'ab olib, **8 ta akkauntning barchasidan birdaniga** `@StarsBot` ga yuboruvchi ultra-tezkor avtomatlashtirilgan bot.

---

## 📁 Loyiha tarkibi
- `accounts.json` — 8 ta akkaunt login va parollari.
- `config.json` — Kuzatiladigan guruhlar (`@group`, `@chat`), maqsadli foydalanuvchi (`@umar`), va `@StarsBot` sozlamalari.
- `src/bot.js` — Asosiy daemon bot (parallel yuborish, monitoring, avto-reconnect).
- `src/paxta-client.js` — PaxtaGram Laravel Sanctum autentifikatsiya va tezkor xabar uzatish klienti.
- `src/promo-extractor.js` — Barcha turdagi promo-kodlarni ajratib oluvchi regex filtr.

---

## 🚀 Ishga tushirish (Lokal kompyuterda)

Terminalda loyiha papkasiga o'tib:
```bash
cd D:\code\paxta-stars-bot
node src/bot.js
```
yoki shunchaki:
```bash
npm start
```
yoki `start.bat` faylini ikki marta bosing!

---

## 🌐 24/7 Tekin Serverda ishlatish (Koyeb / Render / Hugging Face Spaces)

Vercel Serverless bo'lgani uchun 24/7 fonda ishlovchi jarayonlarni qo'llab-quvvatlamaydi. 
Buning o'rniga mutlaqo bepul va 24/7 uzluksiz ishlaydigan quyidagi platformalardan foydalanishingiz mumkin:

1. **Hugging Face Spaces (Node.js)**:
   - 100% bepul, 24/7 to'xtovsiz ishlaydi.
   - Yangi "Docker" yoki "Node.js" Space ochib, ushbu papkadagi fayllarni yuklasangiz bas.
2. **Koyeb / Render**:
   - Free Web Service / Worker ochib, `node src/bot.js` buyrug'i bilan ishga tushirasiz.
