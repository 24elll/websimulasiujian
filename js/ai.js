/* ============================================================
   js/ai.js â€” Integrasi AI
   1) Membuat soal dari kisi-kisi (Gemini atau OpenAI-compatible)
   2) Menilai jawaban essay (opsional, jika ada API key)
   Konfigurasi & API key diatur di file js/config.js (langsung di kode).
   ============================================================ */
"use strict";

function aiLoadSettings() {
  const c = (window.SANDI_CONFIG || {});
  const g = c.gemini || {};
  const o = c.openai || {};
  const provider = c.provider === "openai" ? "openai" : "gemini";
  return {
    provider,
    geminiModel: g.model || "gemini-3.5-flash-lite",
    openaiBaseUrl: o.baseUrl || "https://openrouter.ai/api/v1",
    openaiModel: o.model || "meta-llama/llama-3.1-8b-instruct:free",
    key: String((provider === "gemini" ? g.apiKey : o.apiKey) || "").trim(),
    aiGrade: c.aiGrade !== false,
  };
}
function aiSaveSettings() { /* konfigurasi statis di js/config.js â€” tidak ada yg disimpan */ }

/* ---------- Pemanggilan API ---------- */

async function callAI(cfg, prompt) {
  if (!cfg.key) throw new Error("API key belum diisi â€” atur di file js/config.js.");
  return cfg.provider === "gemini" ? callGemini(cfg, prompt) : callOpenAICompatible(cfg, prompt);
}

async function callGemini(cfg, prompt) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.geminiModel)}:generateContent` +
    `?key=${encodeURIComponent(cfg.key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("API key Gemini ditolak (401). Buat API key baru di Google AI Studio, pastikan Gemini API aktif, lalu update js/config.js di repository dan lakukan hard refresh.");
    }
    if (res.status === 403) {
      throw new Error("Akses Gemini ditolak (403). Periksa pembatasan API key, project Google Cloud, dan kuota Gemini.");
    }
    throw new Error(data?.error?.message || `Gemini HTTP ${res.status}`);
  }
  const txt = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!txt) throw new Error("Gemini tidak mengembalikan teks.");
  return txt;
}

async function callOpenAICompatible(cfg, prompt) {
  const base = (cfg.openaiBaseUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("Base URL belum diisi.");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.key}`,
      "HTTP-Referer": window.location.href,
      "X-Title": "SandiLatihan",
    },
    body: JSON.stringify({
      model: cfg.openaiModel,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  const txt = data?.choices?.[0]?.message?.content || "";
  if (!txt) throw new Error("Model tidak mengembalikan teks.");
  return txt;
}

/** Ambil objek JSON pertama dari balasan model (toleran terhadap markdown fence). */
function safeParseJSON(text) {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const a = cleaned.indexOf("{");
  const b = cleaned.lastIndexOf("}");
  if (a === -1 || b === -1) throw new Error("Balasan AI bukan JSON.\n\n" + cleaned.slice(0, 400));
  const json = JSON.parse(cleaned.slice(a, b + 1));
  return json;
}

/* ---------- 1) Buat soal dari kisi-kisi ---------- */

async function aiBuildPrompt({ kisi, mc, essay, level, subject }) {
  return [
    `Anda adalah guru profesional pembuat soal ${level} berbahasa Indonesia.`,
    subject ? `Mata pelajaran/konteks: ${subject}.` : "",
    `Berdasarkan KISI-KISI / materi berikut:`,
    `"""${(kisi || "").slice(0, 6000)}"""`,
    ``,
    `Tugas: buat TEPAT ${mc} soal PILIHAN GANDA (4 opsi A-D) dan TEPAT ${essay} soal ESSAY.`
  ].filter(Boolean).join("\n") + `

Ketentuan:
- Soal harus jelas, berbobot (mengukur pemahaman, bukan hafalan mentah), dan tidak tumpang tindih.
- Setiap soal pilihan ganda WAJIB punya kunci jawaban yang benar.
- Setiap soal essay WAJIB punya kunci jawaban (contoh jawaban lengkap) dan 3-8 kata kunci penilaian.
- Jawab HANYA dengan JSON valid (tanpa penjelasan lain) dengan skema:
{"questions":[{"type":"mc","question":"...","options":["teks opsi A","teks opsi B","teks opsi C","teks opsi D"],"answerLetter":"A","explanation":"alasan singkat kunci"},
 {"type":"essay","question":"...","reference":"contoh jawaban lengkap","keywords":["kata","kunci"]}]}`;
}

/** @returns {Array} soal dalam struktur yang sama dengan parser.js */
async function aiGenerateQuestions(cfg, opts) {
  const prompt = await aiBuildPrompt(opts);
  const raw = await callAI(cfg, prompt);
  const json = safeParseJSON(raw);
  const list = Array.isArray(json) ? json : json.questions;
  if (!Array.isArray(list) || !list.length) throw new Error("AI tidak menyusun soal. Coba lagi.");

  const out = [];
  let i = 0;
  for (const q of list) {
    i++;
    if (q.type === "mc" || (Array.isArray(q.options) && q.options.length >= 2)) {
      const options = (q.options || []).map(String);
      if (options.length < 2) continue;
      const letters = options.map((_, k) => String.fromCharCode(65 + k));
      let idx = null;
      const lm = String(q.answerLetter || q.answer || q.kunci || "").trim().toUpperCase();
      if (/^[A-H]$/.test(lm)) idx = lm.charCodeAt(0) - 65;
      else if (typeof q.answerIdx === "number") idx = q.answerIdx;
      const cleanQ = String(q.question || "").replace(/^soal\s*\d+\s*[.)]\s*/i, "").trim();
      if (!cleanQ) continue;
      out.push({
        type: "mc", question: cleanQ, options, letters,
        answerIdx: idx !== null && idx < options.length ? idx : null,
        answerText: idx !== null && idx < options.length ? options[idx] : null,
        explanation: String(q.explanation || ""),
        keyMissing: idx === null,
      });
    } else {
      const ref = String(q.reference || q.answer || "").trim();
      if (!ref) continue;
      out.push({
        type: "essay",
        question: String(q.question || "").trim(),
        options: [],
        answerText: ref,
        keywords: Array.isArray(q.keywords) && q.keywords.length
          ? q.keywords.map(String).slice(0, 12)
          : window.SANDI_PARSER.extractKeywords(ref),
        keyMissing: false,
      });
    }
  }
  if (!out.length) throw new Error("AI mengirim soal tidak valid. Coba lagi.");
  return out;
}

/* ---------- 2) Koreksi essay dengan AI ---------- */

/** Nilai batch essay: return [{id, score(0-100), feedback}] */
async function aiGradeEssays(cfg, items) {
  const prompt = [
    `Anda guru yang menilai jawaban essay siswa berbahasa Indonesia.`,
    `Untuk SETIAP item, beri skor 0-100 berdasarkan kesesuaian dengan kunci jawaban (perhatikan makna, bukan kata per kata persis).`,
    `Skor >= 60 dianggap lulus. Beri umpan balik singkat maksimal 2 kalimat.`,
    `Jawab HANYA JSON valid: {"grades":[{"id":<number>,"score":<0-100>,"feedback":"..."}]}`,
    ``,
    `Item:`,
    JSON.stringify(items.slice(0, 15).map((it) => ({
      id: it.id, pertanyaan: it.question, kunci: it.reference, jawaban_siswa: it.student,
    }))),
  ].join("\n");
  const raw = await callAI(cfg, prompt);
  const json = safeParseJSON(raw);
  return json.grades || json;
}

window.SANDI_AI = { aiLoadSettings, aiSaveSettings, callAI, aiGenerateQuestions, aiGradeEssays };
