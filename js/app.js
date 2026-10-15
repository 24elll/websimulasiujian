/* ============================================================
   js/app.js — Alur aplikasi & logika skor
   Tab file/kisi → layar persiapan → kuis → hasil & review
   ============================================================ */
"use strict";

const PARSER = window.SANDI_PARSER;
const EXTRACTOR = window.SANDI_EXTRACT;
const AI = window.SANDI_AI;
const $ = (id) => document.getElementById(id);

/* ---------------- State ---------------- */
let rawText = "";            // teks gabungan hasil upload/ketikan
let questions = [];          // daftar soal (struktur parser.js)
let quiz = { title: [], order: [], idx: 0, answers: [], optMap: [], cfg: null };
let timer = null;
let timerLeft = 0;
let selectedFiles = [];      // File[] dari drop zone

/* ---------------- Tab & layar ---------------- */
function switchPanel(tabId) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tabId));
  document.querySelectorAll("main > section").forEach((s) => s.classList.add("hidden"));
  const el = $(tabId) || $("tab-file");
  el.classList.remove("hidden");
  el.classList.add("active");
}

function hideAllScreensAndShow(name) {
  switchPanel("tab-file"); // pastikan panel utama terlihat di belakang
}

document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => switchPanel(t.dataset.tab))
);

/* ---------------- Konfigurasi AI (dari js/config.js) ---------------- */
function aiStatusHtml() {
  const s = AI.aiLoadSettings();
  if (!s.key) return `<span style="color:var(--bad)">API key belum diisi di file <b>js/config.js</b>.</span>`;
  const model = s.provider === "gemini" ? s.geminiModel : s.openaiModel;
  return `<span style="color:var(--ok)">✔ Siap: ${escapeHtml(s.provider)} · ${escapeHtml(model)}</span>`;
}

/* ---------------- Upload file ---------------- */
const dz = $("dropZone");
$("fileInput").addEventListener("change", (e) => addFiles(Array.from(e.target.files)));
dz.addEventListener("click", () => $("fileInput").click());
["dragover", "dragleave", "drop"].forEach((ev) =>
  dz.addEventListener(ev, (e) => {
    e.preventDefault();
    dz.classList.toggle("dragover", ev === "dragover");
    if (ev === "drop") addFiles(Array.from(e.dataTransfer.files));
  })
);

function addFiles(files) {
  selectedFiles = selectedFiles.concat(files);
  $("fileList").innerHTML = selectedFiles
    .map((f, i) =>
      `<span class="file-chip">${fileIcon(f)} ${escapeHtml(f.name)} <button data-i="${i}" title="hapus">✕</button></span>`)
    .join("");
  $("fileList").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      selectedFiles.splice(+b.dataset.i, 1);
      addFiles([]); // re-render
      // (addFiles([]) merender ulang daftar tanpa menambah)
    })
  );
}
function fileIcon(f) {
  if (f.type.startsWith("image/")) return "🖼️";
  if (f.name.toLowerCase().endsWith(".pdf")) return "📄";
  return "📝";
}

$("btnParseFiles").addEventListener("click", async () => {
  if (!selectedFiles.length) { showError("parseError", "Belum ada file. Tarik file ke kotak upload dulu."); return; }
  clearError("parseError");
  $("progressWrap").classList.remove("hidden");
  let combined = rawText ? rawText + "\n\n" : "";
  try {
    for (const f of selectedFiles) {
      combined += (await EXTRACTOR.extractTextFromFile(f, (p, label) => {
        $("progressBar").style.width = `${Math.round(p * 100)}%`;
        $("progressText").textContent = `${f.name} — ${label}`;
      })) + "\n\n";
    }
    rawText = combined;
    const { questions: qs, warn } = PARSER.parseQuestions(rawText);
    const suggestedTitle = suggestTitleFromFile();
    questions = qs;
    $("progressWrap").classList.add("hidden");
    selectedFiles = []; $("fileList").innerHTML = "";
    inputToPrepare(qs, warn, suggestedTitle);
  } catch (e) {
    $("progressWrap").classList.add("hidden");
    showError("parseError", `${e.message}\n\nTips: pastikan foto/scan cukup tajam, dan format soal bernomor dengan opsi A./B./C. serta baris Jawaban:`);
  }
});
function suggestTitleFromFile() {
  if (!selectedFiles.length) return "";
  return selectedFiles[0].name.replace(/\.(pdf|txt|md|png|jpe?g|webp)$/i, "").replace(/[_-]+/g, " ").trim();
}

/* ---------------- Ketik / tempel & contoh ---------------- */
$("btnSample").addEventListener("click", () => {
  $("pasteArea").value = PARSER.SAMPLE_TEXT;
});
$("btnParseText").addEventListener("click", () => {
  clearError("parseError");
  try {
    const { questions: qs, warn } = PARSER.parseQuestions($("pasteArea").value);
    questions = qs;
    inputToPrepare(qs, warn, "");
  } catch (e) {
    showError("parseError", String(e.message));
  }
});

/* ---------------- Kisi-kisi + AI ---------------- */
function refreshKisiHint() {
  $("kisiAIHint").innerHTML = aiStatusHtml();
}
$("btnMakeFromKisi").addEventListener("click", async () => {
  clearError("kisiError");
  const kisi = $("kisiInput").value.trim();
  const mc = Math.max(0, +$("kisiMC").value || 0);
  const essay = Math.max(0, +$("kisiEssay").value || 0);
  if (!kisi) { showError("kisiError", "Tempel kisi-kisi/materi dulu."); return; }
  if (mc + essay === 0) { showError("kisiError", "Isi jumlah soal lebih dari 0."); return; }
  const s = AI.aiLoadSettings();
  if (!s.key) { showError("kisiError", "API key belum diisi. Buka file js/config.js lalu tempel key di gemini.apiKey."); return; }
  $("kisiStatus").textContent = "⏳ AI sedang menyusun soal…";
  try {
    const qs = await AI.aiGenerateQuestions(s, {
      kisi, mc, essay,
      level: $("kisiLevel").value,
      subject: $("kisiSubject").value.trim(),
    });
    questions = qs;
    $("kisiStatus").textContent = `✔ ${qs.length} soal dibuat.`;
    inputToPrepare(qs, [], $("kisiSubject").value.trim() || "Soal dari Kisi-kisi");
  } catch (e) {
    $("kisiStatus").textContent = "";
    showError("kisiError", `Gagal membuat soal: ${e.message}`);
  }
});

/* ---------------- Layar persiapan ---------------- */
function inputToPrepare(qs, warns, suggestedTitle) {
  if (!qs.length) {
    showError("parseError", "Belum ada soal yang bisa disusun.");
    return;
  }
  $("quizTitle").value = suggestedTitle;
  $("prepareSummary").innerHTML = summarize(qs);
  $("previewList").innerHTML = qs
    .map((q, i) => {
      const typeTag = q.type === "mc"
        ? `<span class="qtype mc">PILIHAN GANDA</span>`
        : `<span class="qtype essay">ESSAY</span>`;
      const opts = q.type === "mc" ? `<div class="ans">${q.options.map((o, k) => `${q.letters[k]}. ${o}`).join(" &nbsp;•&nbsp; ")}</div>` : "";
      const ansLine = q.keyMissing
        ? `<div class="noans">⚠ Kunci jawaban belum ada — soal tetap ikut, nilainya akan ditandai.</div>`
        : `<div class="ans">Kunci: ${q.type === "mc" ? `${q.letters[q.answerIdx]}. ${q.options[q.answerIdx]}` : q.answerText}</div>`;
      return `<div class="preview-item">${typeTag}<b>${i + 1}.</b> ${escapeHtml(q.question)}
        ${opts}${ansLine}</div>`;
    })
    .join("");
  hideRootPanels();
  $("screen-prepare").classList.remove("hidden");
  if (warns && warns.length) showError("parseError", warns.join("\n"), false);
}
function summarize(qs) {
  const mc = qs.filter((q) => q.type === "mc").length;
  const es = qs.length - mc;
  const noKey = qs.filter((q) => q.keyMissing).length;
  return `<span class="chip">Total <b>${qs.length}</b> soal</span>
    <span class="chip">Pilihan ganda <b>${mc}</b></span>
    <span class="chip">Essay <b>${es}</b></span>
    ${noKey ? `<span class="chip">⚠ Tanpa kunci <b>${noKey}</b></span>` : ""}`;
}
function hideRootPanels() {
  ["tab-file", "tab-kisi", "screen-result", "screen-quiz", "screen-prepare"]
    .forEach((id) => $(id).classList.add("hidden"));
}
$("optTimer").addEventListener("change", () => $("optTimerMin").classList.toggle("hidden", !$("optTimer").checked));
$("btnBackHome").addEventListener("click", () => { hideAllScreensAndShow(); switchPanel("tab-file"); });

/* ---------------- Kuis ---------------- */
$("btnStartQuiz").addEventListener("click", () => {
  if (!questions.length) {
    showError("parseError", "Belum ada soal untuk dimulai.");
    return;
  }
  quiz = {
    title: $("quizTitle").value.trim() || "Latihan",
    order: [...questions.keys()],
    idx: 0,
    answers: questions.map(() => null),
    optMap: questions.map(() => null),
    cfg: { timer: $("optTimer").checked, timerMin: +$("optTimerMin").value || 20 },
  };
  if ($("optShuffle").checked) quiz.order = shuffle(quiz.order);
  // acak posisi opsi (jawaban dinilai via index asli)
  questions.forEach((q, i) => {
    if (q.type === "mc" && $("optShuffleOpts").checked) {
      quiz.optMap[i] = shuffle([...q.options.keys()]);
    }
  });
  if ($("optTimer").checked) startTimer(quiz.cfg.timerMin * 60);
  else stopTimer();
  renderQuiz();
});
function shuffle(a) {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}
function renderQuiz() {
  hideRootPanels();
  $("screen-quiz").classList.remove("hidden");
  $("quizTitleLbl").textContent = quiz.title;
  const qi = quiz.order[quiz.idx];
  const q = questions[qi];
  const total = quiz.order.length;
  $("quizProgressLbl").textContent = ` — Soal ${quiz.idx + 1} dari ${total}`;
  $("quizProgressBar").style.width = `${Math.round(((quiz.idx + 1) / total) * 100)}%`;

  let html = `<div class="question-meta">
      <span class="q-number">PERTANYAAN ${String(quiz.idx + 1).padStart(2, "0")}</span>
      <span class="question-type ${q.type === "mc" ? "mc" : "essay"}">${q.type === "mc" ? "Pilihan ganda" : "Essay"}</span>
    </div>
    <div class="q-text">${escapeHtml(q.question)}</div>`;

  if (q.type === "mc") {
    const disp = quiz.optMap[qi] || [...q.options.keys()];
    html += `<div class="options">` + disp.map((realIdx) => {
      const sel = quiz.answers[qi] === realIdx;
      return `<label class="option ${sel ? "selected" : ""}">
          <input type="radio" name="opt" ${sel ? "checked" : ""} data-real="${realIdx}" />
          <span class="option-letter">${q.letters[realIdx]}</span>
          <span class="option-copy">${escapeHtml(q.options[realIdx])}</span>
        </label>`;
    }).join("") + `</div>`;
  } else {
    html += `<label class="hint" style="margin-top:4px">Ketik jawabanmu di bawah:</label>
      <textarea class="essay-input" id="essayInput" placeholder="Tulis jawabanmu…">${escapeHtml(quiz.answers[qi] || "")}</textarea>`;
  }
  $("quizCard").innerHTML = html;

  // event
  if (q.type === "mc") {
    $("quizCard").querySelectorAll('input[name="opt"]').forEach((r) =>
      r.addEventListener("click", () => {
        quiz.answers[qi] = +r.dataset.real;
        renderQuiz();
      })
    );
  } else {
    $("essayInput").addEventListener("input", (e) => { quiz.answers[qi] = e.target.value; updateDots(); });
    $("essayInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.ctrlKey && quiz.idx < quiz.order.length - 1) step(1); // Ctrl+Enter = lanjut
    });
  }
  updateDots();
  $("btnPrev").disabled = quiz.idx === 0;
  $("btnNext").textContent = quiz.idx === quiz.order.length - 1 ? "Lihat hasil →" : "Berikutnya →";
}
function step(d) {
  const n = quiz.order.length;
  const next = quiz.idx + d;
  if (next < 0) return;
  if (next >= n) { finishQuiz(); return; }
  quiz.idx = next;
  renderQuiz();
}
$("btnPrev").addEventListener("click", () => step(-1));
$("btnNext").addEventListener("click", () => step(1));

function updateDots() {
  $("quizDots").innerHTML = quiz.order
    .map((qi, i) => {
      const answered = quiz.answers[qi] !== null && quiz.answers[qi] !== "";
      return `<button class="qdot ${answered ? "answered" : ""} ${i === quiz.idx ? "current" : ""}" data-i="${i}">${i + 1}</button>`;
    })
    .join("");
  $("quizDots").querySelectorAll(".qdot").forEach((b) =>
    b.addEventListener("click", () => { quiz.idx = +b.dataset.i; renderQuiz(); })
  );
}
$("btnFinishTop").addEventListener("click", () => finishQuiz());

/* ---------------- Timer ---------------- */
function startTimer(sec) {
  stopTimer();
  timerLeft = sec;
  $("quizTimer").classList.remove("hidden", "warn");
  tick();
  timer = setInterval(tick, 1000);
  function tick() {
    $("quizTimer").textContent = fmtTime(timerLeft);
    if (timerLeft <= 60) $("quizTimer").classList.add("warn");
    if (timerLeft <= 0) { stopTimer(); finishQuiz(); }
    timerLeft--;
  }
}
function stopTimer() {
  if (timer) { clearInterval(timer); timer = null; }
  $("quizTimer").classList.add("hidden");
}
function fmtTime(s) {
  const m = Math.floor(s / 60), r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/* ---------------- Penilaian & skor ---------------- */
async function finishQuiz() {
  stopTimer();
  // simpan essay input terakhir (blur race)
  const essayNow = $("essayInput");
  if (essayNow && questions[quiz.order[quiz.idx]]?.type === "essay")
    quiz.answers[quiz.order[quiz.idx]] = essayNow.value;

  const per = quiz.order.map((qi, pos) => ({ qi, pos }));
  const mcs = per.filter(({ qi }) => questions[qi].type === "mc");
  const essays = per.filter(({ qi }) => questions[qi].type === "essay");

  const result = {
    items: quiz.order.map((qi) => ({
      qi, type: questions[qi].type,
      points: 0, status: "wrong", aiFeedback: "", student: null,
    })),
    // Nilai hanya memakai soal yang benar-benar terbaca dari file/paket.
    // Soal essay tidak pernah ditambahkan jika sumber hanya berisi PG.
    gained: 0, max: mcs.length + essays.length, usedAI: false,
  };

  // ---- Skor langsung: pilihan ganda ----
  for (const { qi } of mcs) {
    const q = questions[qi];
    const chosen = quiz.answers[qi];
    const it = result.items.find((r) => r.qi === qi);
    it.student = chosen === null ? null : `${q.letters[chosen]}. ${q.options[chosen]}`;
    if (chosen !== null && q.answerIdx !== null && chosen === q.answerIdx) {
      it.points = 1; it.status = "correct"; result.gained++;
    }
    if (q.keyMissing) { it.status = "unknown"; }
  }

  // ---- Essay ----
  const essayItems = essays.map(({ qi }) => {
    const q = questions[qi];
    return { qi, q, student: String(quiz.answers[qi] || ""), id: qi };
  });
  const aiCfg = AI.aiLoadSettings();
  let aiGrades = null;
  if (aiCfg.aiGrade && aiCfg.key && essayItems.some((e) => e.student.trim())) {
    try {
      aiGrades = await AI.aiGradeEssays(aiCfg, essayItems.map((e) => ({
        id: e.qi, question: e.q.question, reference: e.q.answerText, student: e.student,
      })));
      result.usedAI = true;
    } catch (err) {
      result.aiGradeError = "Penilaian AI gagal, dipakai kata kunci. (" + err.message + ")";
      aiGrades = null;
    }
  }

  for (const { qi, q, student } of essayItems) {
    const it = result.items.find((r) => r.qi === qi);
    it.student = student;
    let score = 0;
    if (aiGrades) {
      const g = aiGrades.find((g) => +g.id === qi);
      it.aiFeedback = g ? String(g.feedback || "") : "";
      score = g ? Math.max(0, Math.min(100, +g.score || 0)) : 0;
    } else if (student.trim() && q.answerText) {
      score = keywordScore(student, q.answerText, q.keywords);
    }
    if (score >= 60) { it.points = 1; it.status = "correct"; result.gained++; }
    else if (score >= 30) { it.status = "partial"; }
    else it.status = "wrong";
    it.essayScore = score;
  }

  showResult(result);
}

/** Skor berbasis kata kunci (fallback tanpa AI): proporsi kata kunci yang muncul. */
function keywordScore(student, reference, keywords) {
  const s = student.toLowerCase();
  const kws = (keywords && keywords.length ? keywords : window.SANDI_PARSER.extractKeywords(reference));
  if (!kws.length) return student.trim() ? 50 : 0;
  const hit = kws.filter((k) => s.includes(k)).length;
  // makna bukan kata per kata: beri nilai proporsional dengan bobot
  return Math.round(100 * hit / kws.length);
}

/* ---------------- Layar hasil & review ---------------- */
function showResult(result) {
  hideRootPanels();
  $("screen-result").classList.remove("hidden");
  $("reviewCard").classList.add("hidden");
  const pct = result.max ? Math.round((result.gained / result.max) * 100) : 0;
  const grade = getGrade(pct);
  $("scorePct").textContent = `${pct}`;
  $("scorePts").textContent = `Nilai ujian • ${grade}`;
  const ring = $("ringFg");
  const circ = 2 * Math.PI * 52; // ≈327
  ring.style.strokeDasharray = circ;
  requestAnimationFrame(() => {
    ring.style.strokeDashoffset = circ * (1 - pct / 100);
    ring.style.stroke = pct >= 80 ? "var(--ok)" : pct >= 60 ? "var(--warn)" : "var(--bad)";
  });
  $("scoreMsg").textContent =
    pct >= 80 ? "Luar biasa! Terus pertahankan. 🎉" :
    pct >= 60 ? "Bagus, sudah lulus. Masih bisa ditingkatkan!" :
    "Semangat! Pelajari pembahasannya lalu coba lagi. 💪";

  const mcC = result.items.filter((r) => r.type === "mc" && r.status === "correct").length;
  const mcT = result.items.filter((r) => r.type === "mc").length;
  const esC = result.items.filter((r) => r.type === "essay" && r.status === "correct").length;
  const esT = result.items.filter((r) => r.type === "essay").length;
  const noKey = result.items.filter((r) => r.status === "unknown").length;
  const wrong = result.max - result.gained;
  $("resultBreakdown").innerHTML = `
    <span class="chip score-chip grade">Nilai <b>${pct}/${grade}</b></span>
    <span class="chip score-chip success">Benar <b>${result.gained}</b></span>
    <span class="chip score-chip danger">Salah <b>${wrong}</b></span>
    <span class="chip">Total soal <b>${result.max}</b></span>
    <span class="chip">PG benar <b>${mcC}/${mcT}</b></span>
    ${esT ? `<span class="chip">Essay lolos <b>${esC}/${esT}</b></span>` : ""}
    ${noKey ? `<span class="chip">Tanpa kunci <b>${noKey}</b></span>` : ""}
    ${result.usedAI ? `<span class="chip">✨ Essay dinilai AI</span>` : ""}`;
  lastResult = result;
  refreshKisiHint();
}

function getGrade(score) {
  if (score >= 86) return "A";
  if (score >= 76) return "B";
  if (score >= 66) return "C";
  if (score >= 56) return "D";
  return "E";
}
let lastResult = null;

function showReview(result) {
  const list = $("reviewList");
  list.innerHTML = result.items.map((r) => {
    const q = questions[r.qi];
    const cls = r.status === "correct" ? "correct" : r.status === "unknown" ? "" : r.status === "partial" ? "partial" : "wrong";
    const verdict =
      r.status === "correct" ? '<span class="verdict">✔ BENAR</span>' :
      r.status === "partial" ? `<span class="verdict">◐ HAMPIR (skor ${r.essayScore})</span>` :
      r.status === "unknown" ? '<span class="verdict">— KUNCI TIDAK ADA</span>' :
      '<span class="verdict">✘ SALAH</span>';
    const stud = r.student ? `<div>🧑 Jawabanmu: <b>${escapeHtml(r.student)}</b></div>` : "";
    const key = q.keyMissing
      ? `<div class="ref">⚠ Kunci jawaban tidak tersedia pada file sumber.</div>`
      : q.type === "mc"
        ? `<div class="ref">🔑 Kunci: ${q.letters[q.answerIdx]}. ${escapeHtml(q.options[q.answerIdx])}${q.explanation ? `<br>💡 ${escapeHtml(q.explanation)}` : ""}</div>`
        : `<div class="ref">🔑 Kunci: ${escapeHtml(q.answerText)}</div>`;
    const fb = r.aiFeedback ? `<div class="feedback-box">🔎 Umpan balik AI: ${escapeHtml(r.aiFeedback)}</div>` : "";
    return `<div class="review-item ${cls}">
      ${verdict} <b>${r.qi + 1}.</b> ${escapeHtml(q.question)}
      ${stud}${key}${fb}</div>`;
  }).join("");
  $("reviewCard").classList.remove("hidden");
  $("reviewCard").scrollIntoView({ behavior: "smooth" });
}
$("btnReview").addEventListener("click", () => lastResult && showReview(lastResult));
$("btnHome2").addEventListener("click", () => { hideAllScreensAndShow(); refreshKisiHint(); });
$("btnRetryWrong").addEventListener("click", () => {
  if (!lastResult) return;
  const wrongQis = lastResult.items.filter((r) => r.status !== "correct" && r.status !== "unknown").map((r) => r.qi);
  if (!wrongQis.length) { alert("Semua soal sudah benar! 🎉"); return; }
  // Ganti questions dengan subset soal yang salah (urutan asli dipertahankan),
  // sehingga semua index di quiz.order merujuk array yang sama.
  questions = wrongQis.map((i) => questions[i]);
  quiz = {
    title: "Latihan Ulang",
    order: shuffle([...questions.keys()]),
    idx: 0,
    answers: questions.map(() => null),
    optMap: questions.map((q) => (q.type === "mc" ? shuffle([...q.options.keys()]) : null)),
    cfg: { timer: false },
  };
  renderQuiz();
});

/* ---------------- Util ---------------- */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function showError(id, msg, isError = true) {
  const el = $(id);
  el.textContent = (isError ? "" : "") + msg;
  el.classList.remove("hidden");
}
function clearError(id) { $(id).classList.add("hidden"); }

/* ---------------- Init ---------------- */
refreshKisiHint();
switchPanel("tab-file");
