/* ============================================================
   js/extract.js — Ekstraksi teks dari file yang diupload
   - .txt/.md            → langsung dibaca
   - .pdf                → pdf.js (CDN)
   - gambar (jpg/png/…)  → Tesseract.js OCR (CDN), bahasa ind+eng
   Semua terjadi di browser, tanpa server.
   ============================================================ */
"use strict";

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

/** Ekstrak teks dari satu File sesuai tipe. onProgress(0..1, label) */
async function extractTextFromFile(file, onProgress = () => {}) {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    onProgress(0.05, "Membuka PDF…");
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    let out = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      onProgress(p / pdf.numPages, `Membaca halaman ${p}/${pdf.numPages}…`);
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      out += groupPdfLines(tc.items) + "\n\n";
    }
    return out.trim();
  }

  if (file.type.startsWith("image/")) {
    onProgress(0.1, "Menyiapkan OCR…");
    const worker = await Tesseract.createWorker("ind+eng", 1, {
      logger: (m) => {
        if (m.status === "recognizing text")
          onProgress(0.1 + m.progress * 0.85, `Membaca gambar (OCR)… ${Math.round(m.progress * 100)}%`);
        else onProgress(0.05, `OCR: ${m.status}`);
      },
    });
    try {
      const { data } = await worker.recognize(file);
      return data.text.trim();
    } finally {
      await worker.terminate();
    }
  }

  // default: anggap teks (.txt, .md, dll)
  onProgress(0.3, "Membaca berkas teks…");
  return await file.text();
}

/** Gabungkan item teks pdf.js menjadi baris (mengelompokkan per koordinat-Y). */
function groupPdfLines(items) {
  const rows = new Map();
  for (const it of items) {
    if (typeof it.str !== "string" || !it.str.trim()) continue;
    const y = Math.round(it.transform[5]);
    const key = Array.from(rows.keys()).find((k) => Math.abs(k - y) <= 2) ?? y;
    const arr = rows.get(key) || [];
    arr.push({ x: it.transform[4], s: it.str });
    rows.set(key, arr);
  }
  return Array.from(rows.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, arr]) =>
      arr.sort((a, b) => a.x - b.x)
        .map((o) => o.s)
        .join(" ")
        .trim()
    )
    .filter(Boolean)
    .join("\n");
}

window.SANDI_EXTRACT = { extractTextFromFile };
