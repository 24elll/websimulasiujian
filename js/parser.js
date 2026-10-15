/* ============================================================
   js/parser.js — Parser soal offline
   Mengubah teks mentah (hasil OCR/PDF/ketikan) menjadi array soal:
   { type: "mc"|"essay", question, options[], answer, reference, keywords }
   Format dikenali:
     1. Pertanyaan ...            → nomor soal (juga "Soal 1.")
     A. opsi  B. opsi ...          → opsi pilihan ganda (dengan `.` atau `)`)
     Jawaban: B  /  Kunci: B       → kunci MC (huruf) atau teks jawaban essay
   ============================================================ */
"use strict";

const STOPWORDS = new Set([
  "adalah", "yang", "dan", "atau", "dengan", "pada", "dalam", "untuk", "dari",
  "ke", "di", "ini", "itu", "oleh", "sebagai", "juga", "akan", "tidak", "bisa",
  "ada", "para", "para", "serta", "agar", "bahwa", "karena", "saat", "hanya",
  "the", "is", "are", "of", "to", "and", "in", "a", "an", "for", "with", "by", "on"
]);

function normalizeText(raw) {
  return String(raw || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Ambil kisi-kisi/kunci jawaban global: "1.A 2.B 3.C" atau "1) A" dsb. */
function extractGlobalKey(text) {
  const map = {};
  const lines = text.split("\n");
  const keyHeader = /(?:kunci\s*(?:jawaban|jawaban\s*pg)?|jawaban\s*(?:pg|pilihan\s*ganda)|answer\s*key)/i;
  const pairRe = /(?:^|[\s,;|])(\d{1,3})\s*(?:[.\-):]|(?=[A-Ha-h](?:\s|$)))\s*([A-Ha-h])(?=\s|$|[,;.|])/g;
  let inKeySection = false;
  for (const line of lines) {
    const clean = line.trim();
    if (keyHeader.test(clean)) inKeySection = true;
    if (!inKeySection && !/^\s*(?:jawaban|kunci)\s*[:=]/i.test(clean)) continue;
    let m;
    while ((m = pairRe.exec(clean)) !== null) {
      map[parseInt(m[1], 10)] = m[2].toUpperCase();
    }
    pairRe.lastIndex = 0;
  }
  return map;
}

/** Pisahkan teks menjadi blok-blok soal berdasarkan penanda nomor. */
function splitBlocks(text) {
  const lines = text.split("\n");
  const starts = [];
  const startRe = /^(?:soal\s*)?(\d{1,3})(?:\s*[.)]\s*|\s+)(.*)$/i;
  let inKeySection = false;
  for (let i = 0; i < lines.length; i++) {
    if (/(?:kunci\s*(?:jawaban|jawaban\s*pg)?|jawaban\s*(?:pg|pilihan\s*ganda)|answer\s*key)/i.test(lines[i])) {
      inKeySection = true;
      continue;
    }
    if (inKeySection) continue;
    const m = lines[i].match(startRe);
    if (!m) continue;
    const num = parseInt(m[1], 10);
    const hasNumberDelimiter = /^\s*(?:soal\s*)?\d{1,3}\s*[.)]/i.test(lines[i]);
    // Validasi agar nomor daftar dalam opsi (mis. "1. baris dalam opsi") tidak salah tangkap:
    // anggap mulai soal jika nomornya 1, atau nomornya tepat nomor sebelumnya + 1.
    const prev = starts.length ? starts[starts.length - 1].num : 0;
    if (starts.length === 0 && hasNumberDelimiter) starts.push({ i, num });
    else if (num === prev + 1 || (hasNumberDelimiter && prev > 0 && num >= prev)) starts.push({ i, num });
  }
  const blocks = [];
  starts.forEach((s, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1].i : lines.length;
    const body = lines.slice(s.i + 1, end).join("\n").trim();
    blocks.push({ num: s.num, first: s.startsText || "", text: (m0(lines, s.i) + "\n" + body).trim() });
  });
  return blocks;
}
function m0(lines, i) { // baris pertama (asli) blok
  return lines[i];
}

const OPTION_RE = /^([A-Ha-h])\s*[.)]\s+(.*)$/;
const ANSWER_RE = /^(?:jawaban|kunci(?:\s+jawaban)?)\s*[:.\-=]\s*(.*)$/i;
const PAGE_ARTIFACT_RE = /^(?:halaman|page|www\.|http:\/\/|https:\/\/|www\.|dicetak|©|\d+\s*\/\s*\d+|\-\s*\d+\s*\-)/i;

function isOptionContinuation(line, previousOption) {
  if (!previousOption || PAGE_ARTIFACT_RE.test(line)) return false;
  if (isAnswerKeyArtifact(line)) return false;
  if (/[.!?:;]$/.test(previousOption)) return false;
  // PDF line wrapping normally continues with lowercase text, punctuation, or a number.
  return /^[a-zà-ÿ0-9([{"'“‘]/.test(line);
}

function isAnswerKeyArtifact(line) {
  const numberedLetters = line.match(/\b\d{1,3}\s*[.)-]?\s*[A-H]\b/gi) || [];
  const answerLetters = line.match(/\b[A-D]\b/gi) || [];
  const numbers = line.match(/\b\d{1,3}\b/g) || [];
  // PDF answer-key tables are often flattened into dense number/letter text.
  return numberedLetters.length >= 3 ||
    (numbers.length >= 4 && answerLetters.length >= 6 && line.length > 24);
}

/** Parse satu blok menjadi objek soal. */
function parseBlock(block, globalKey) {
  const lines = block.text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  let questionLines = [];
  const options = [];
  let letters = [];
  let answerText = null;
  let inOptions = false;
  let inPdfArtifact = false;

  for (const line of lines) {
    if (isAnswerKeyArtifact(line)) {
      inPdfArtifact = true;
      continue;
    }
    if (inPdfArtifact && /^[\dA-Ha-h\s.)|;:,-]+$/.test(line)) continue;
    const opt = line.match(OPTION_RE);
    const ans = line.match(ANSWER_RE);
    if (ans) {
      answerText = ans[1].trim();
      continue;
    }
    if (opt) {
      const L = opt[1].toUpperCase();
      // Opsi berurutan A,B,C.. dan tidak mundur ⇒ benar-benar opsi
      const prev = letters.length ? letters[letters.length - 1] : "@";
      if (L.charCodeAt(0) === prev.charCodeAt(0) + 1) {
        inOptions = true;
        letters.push(L);
        options.push(opt[2].trim());
        continue;
      }
    }
    if (!inOptions) questionLines.push(line);
    else if (isOptionContinuation(line, options[options.length - 1])) {
      options[options.length - 1] += " " + line;
    }
  }

  const question = questionLines.join(" ").replace(/^(?:soal\s*)?\d{1,3}\s*[.)]\s*/i, "").trim();
  if (question.replace(/[^a-zA-Z0-9]/g, "").length < 3) return null;

  if (options.length >= 2) {
    // ---- PILIHAN GANDA ----
    let key = null;
    if (answerText) {
      const lm = answerText.match(/^([A-Ha-h])\b/);
      if (lm) key = lm[1].toUpperCase();
    }
    // fallback: kunci global "1. A"
    if (!key && globalKey[block.num]) key = globalKey[block.num];
    // fallback: jawaban berupa teks opsi? cocokkan ke opsi
    let answerIdx = null;
    if (key) {
      answerIdx = letters.indexOf(key);
      if (answerIdx === -1 && answerText) {
        // "Jawaban: Bandung" → cocokkan teks
        const t = answerText.toLowerCase();
        answerIdx = options.findIndex(o => o.toLowerCase().replace(/[^a-z0-9]/g, "") === t.replace(/[^a-z0-9]/g, "") || o.toLowerCase().includes(t));
      }
    }
    return {
      type: "mc",
      question,
      options,
      letters,
      answerIdx,           // null = kunci tidak ditemukan (akan ditandai saat review)
      answerText: answerIdx !== null ? options[answerIdx] : (key ? key : null),
      keyMissing: answerIdx === null
    };
  }

  // ---- ESSAY ----
  if (!answerText && question.replace(/[^a-zA-Z0-9]/g, "").length < 5) return null;
  const kw = answerText ? extractKeywords(answerText) : [];
  return {
    type: "essay",
    question,
    options: [],
    answerText: answerText || "",
    keywords: kw,
    keyMissing: !answerText
  };
}

/** Kata kunci untuk penilaian essay otomatis (tanpa AI). */
function extractKeywords(ref) {
  return (ref.toLowerCase().match(/[a-zA-Z0-9\u00c0-\u024f]+/g) || [])
    .filter(w => w.length >= 4 && !STOPWORDS.has(w))
    .filter((w, i, a) => a.indexOf(w) === i)
    .slice(0, 12);
}

/**
 * Parse teks mentah menjadi daftar soal.
 * @returns {{questions: Array, warn: string[]}}
 */
function parseQuestions(rawText) {
  const text = normalizeText(rawText);
  const globalKey = extractGlobalKey(text);
  const blocks = splitBlocks(text);
  const questions = [];
  const warn = [];
  let prevNum = 0;
  for (const b of blocks) {
    const q = parseBlock(b, globalKey);
    if (!q) { continue; }
    questions.push(q);
    prevNum = b.num;
  }
  if (!questions.length) throw new Error(
    "Tidak ada soal yang dikenali. Pastikan formatnya: soal bernomor, opsi A./B./C., dan baris Jawaban:/Kunci:"
  );
  const nNoKey = questions.filter(q => q.keyMissing).length;
  if (nNoKey) warn.push(`${nNoKey} soal tidak memiliki kunci jawaban — kunci bisa diisi saat review hasil.`);
  return { questions, warn };
}

/** Contoh soal untuk demo/tombol "Muat contoh". */
const SAMPLE_TEXT = `1. Ibu kota Provinsi Jawa Barat adalah ...
A. Semarang
B. Bandung
C. Surabaya
D. Serang
Jawaban: B

2. Nilai perbandingan trigonometri tan theta pada segitiga siku-siku adalah ...
A. sisi depan terhadap sisi samping
B. sisi depan terhadap sisi miring
C. sisi samping terhadap sisi samping
D. sisi miring terhadap sisi depan
Jawaban: A

3. Organisme penghasil antibiotik alami adalah ...
A. Rafflesia
B. Penicillium
C. Volvox
D. Hydra
Jawaban: B

4. Jelaskan proses fotosintesis pada tumbuhan!
Jawaban: Fotosintesis adalah proses tumbuhan berhijau daun membuat makanan (glukosa) menggunakan cahaya matahari, air, dan karbon dioksida, serta menghasilkan oksigen sebagai produk sampingan.

5. Sebutkan tiga dampak negatif sampah plastik bagi lingkungan dan berikan solusinya!
Jawaban: Dampak antara lain pencemaran laut dan saluran air, kematian hewan karena memakan atau melilit plastik, serta pencemaran tanah oleh mikroplastik. Solusinya: kurangi plastik sekali pakai, gunakan tas belanja, daur ulang, dan kelola sampah`;

// Expose global
window.SANDI_PARSER = { parseQuestions, normalizeText, extractKeywords, SAMPLE_TEXT };
