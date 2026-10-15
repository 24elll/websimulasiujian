/* ============================================================
   js/config.js — ATUR AI DI SINI (langsung di kode, bukan di web)
   ------------------------------------------------------------
   1) Google Gemini (gratis): buka https://aistudio.google.com/apikey
      → klik "Get API Key" → salin, lalu tempel di bawah (mulai "AIza...").
   2) OpenAI-compatible (gratis via OpenRouter): buka https://openrouter.ai/keys
      → tempel key di openai.apiKey, dan isi base URL + model free yang tersedia.

   provider: "gemini"  ← pakai gemini.apiKey
             "openai"  ← pakai openai.apiKey + baseUrl + model
   aiGrade: true  → essay dinilai AI; false → penilaian kata kunci (offline)
   ============================================================ */
"use strict";

window.SANDI_CONFIG = {
  provider: "gemini",
  aiGrade: true,

  gemini: {
    apiKey: "AQ.Ab8RN6LcJnDJ2BD27V4_Z5FKsn76Dvv1jj857QJqSEFuNRPYgQ",
    model: "gemini-3.5-flash-lite",
  },

};
