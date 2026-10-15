# 🎯 SandiLatihan — Web Generator Soal Latihan + Skor

Web statis (HTML + CSS + JavaScript, tanpa server) untuk membuat **soal latihan pilihan ganda & essay dari file upload** (kisi-kisi, buku soal, foto soal) dan mengerjakannya dengan **penilaian otomatis + skor**.

Semua pemrosesan file terjadi **lokal di browser** — data tidak dikirim ke mana pun (kecuali ke AI bila dipakai).

## Cara menjalankan

1. Buka `index.html` langsung (double-click), **atau** jalankan server lokal:
   ```
   python -m http.server 8000     # lalu buka http://localhost:8000
   ```
2. Butuh internet sekali untuk memuat 2 library dari CDN (OCR & pembaca PDF). Aktivitas analisis soal & kuis tetap lokal.

## 3 Cara membuat paket soal

| Cara | Kapan dipakai | Butuh AI? |
|---|---|---|
| **Tab 1: File/Gambar Soal** — upload `.pdf`, gambar (foto/scan soal), `.txt`, atau tempel teks | File **sudah berisi soal utuh** (pakai kisi dari file) | ❌ Tidak |
| **Tab 2: Kisi-kisi + AI** — tempel daftar kisi-kisi/materi | File hanya berisi **kisi-kisi** (materi/indikator), AI menyusun soal baru | ✅ Ya |
| Tombol **"Muat contoh soal"** | Coba-coba dulu | ❌ Tidak |

## Format soal yang dikenali (mode tanpa AI)

```
1. Pertanyaan ...
A. opsi 1
B. opsi 2
C. opsi 3
D. opsi 4
Jawaban: B          ← baris "Jawaban:" atau "Kunci:" (huruf kunci)

2. Pertanyaan essay ...
Jawaban: <contoh jawaban lengkap>   ← tanpa opsi ⇒ otomatis essay
```

- Kunci juga bisa di akhir file: `Kunci Jawaban: 1.C 2.B 3.D`
- Soal tanpa baris kunci tetap ikut, dan ditandai "tanpa kunci" saat review.
- Bisa campur PG dan essay dalam satu file.

## Penilaian / logika skor

- **Pilihan ganda**: 1 poin per soal, benar jika pilihan = kunci.
- **Essay**: skor 0–100,
  - dengan API key → dinilai AI (memaknai jawaban, bukan cocok kata per kata);
  - tanpa API key → dicocokkan **kata kunci** dari kunci jawaban (≥60 = lolos, 30–59 = hampir).
- Hasil: nilai ujian 0–100 dengan kategori A–E, rincian benar/salah serta PG/essay, tombol **Pembahasan**, dan **"Latihan Soal yang Salah"** untuk mengulang hanya soal yang gagal.
- Jika file hanya berisi pilihan ganda, nilai dihitung hanya dari jumlah soal pilihan ganda; essay tidak dibuat dan tidak masuk denominator penilaian.

## Mengaktifkan AI (untuk kisi-kisi & koreksi essay)

Konfigurasi diatur **langsung di kode**, bukan di web: buka **`js/config.js`**, lalu:

1. **Gemini (disarankan, gratis)** — buka <https://aistudio.google.com/apikey> → *Get API key* → salin, lalu tempel:
   ```js
   gemini: { apiKey: "AIza...key-kamu-di-sini", model: "gemini-3.5-flash-lite" },
   provider: "gemini",
   ```
2. **OpenAI-compatible** (mis. OpenRouter `https://openrouter.ai/api/v1` dengan model `...:free`, atau Groq) — isi `openai.apiKey`, `openai.baseUrl`, `openai.model`, dan set `provider: "openai"`.

Opsi `aiGrade: true` = essay dinilai AI; `false` = penilaian kata kunci offline. Sampai key diisi: mode upload/ketik soal tetap 100% berfungsi, kisi-kisi + AI akan menampilkan error dengan petunjuk membuka `js/config.js`.

### Catatan keamanan API key

Karena project ini berjalan langsung di browser, API key yang ditulis di `js/config.js`
dapat dilihat oleh siapa pun yang memiliki akses ke source/deployment. Untuk demo pribadi,
gunakan key gratis dengan kuota kecil, batasi penggunaan/restriksi key bila provider
mendukungnya, dan jangan commit key asli ke GitHub. Untuk aplikasi publik/produksi,
pindahkan pemanggilan AI ke backend atau serverless function dan simpan key sebagai
environment variable di server.

## Struktur file

```
index.html      UI (3 tab + layar kuis + hasil)
style.css       tema terang responsif
js/parser.js    parser teks → soal PG/essay + penilaian kata kunci
js/extract.js   baca PDF (pdf.js) & OCR gambar (Tesseract.js)
js/ai.js         Gemini / OpenAI-compatible: buat soal & nilai essay
js/config.js     KONFIGURASI AI diatur langsung di sini (API key, model)
js/app.js        alur aplikasi, kuis, shuffle, timer, skor, review
test.html       self-test parser (buka di browser untuk verifikasi)
```

## Batasan

- OCR gambar: akurasi tergantung kualitas foto — teks jelas & lurus = hasil terbaik.
- PDF berbasis pindaian (bukan teks digital) perlu di-foto/OCR dulu.
- AI hanya dijalankan dari browser (`fetch` langsung) — jangan pakai key berbayar berlimpah di komputer bersama.
