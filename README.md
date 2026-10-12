# O‘qish rejalashtirgichi

Universitet vazifalari, muddatlari, kalendari va baholarini ko‘rish uchun shaxsiy kompyuterda ishlaydigan kichik ilova.

## Ishga tushirish

1. Python 3 o‘rnatilgan bo‘lsin.
2. Windows’da `start.bat` faylini oching.
3. Brauzerda `http://127.0.0.1:8000` manziliga kiring.
4. eStudy login va parolingizni kiriting. Ular diskka saqlanmaydi; portalga so‘rov yuborish uchun ishlatiladi.

Ilova hozircha kompyuterda ishlaydi. GitHub Pages Python serverini ishga tushirmaydi; ushbu repository manba kodini saqlash uchun.

## Maxfiylik

- Portal login ma’lumotlarini faqat o‘zingiz ishongan kompyuterda kiriting.
- Ilova parolni brauzer xotirasida yoki faylda saqlamaydi.
- Vazifalar va baholar brauzerning mahalliy `localStorage` xotirasida saqlanadi.
- Ushbu loyihani ommaviy repository sifatida joylash kodni hammaga ochadi. Shaxsiy login, parol yoki boshqa maxfiy ma’lumotlarni repository’ga qo‘shmang.

## Fayllar

- `index.html`, `styles.css`, `script.js` — foydalanuvchi interfeysi.
- `server.py` — eStudy bilan sinxronlash uchun mahalliy Python server.
- `start.bat` — Windows’da serverni ishga tushirish.
