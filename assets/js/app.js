// fcpe.com — 페이지 로직 + 검색 + 에이전트 응답
const DATA = { guide: null, issues: null, plugins: null, community: null };

async function loadData(...names) {
  await Promise.all(
    names.map(async (n) => {
      if (DATA[n]) return;
      const res = await fetch(`data/${n}.json`);
      DATA[n] = await res.json();
    })
  );
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || "";
}

/* ---------------- 검색 엔진 (간단 토큰 점수) ---------------- */
// 질문에서 의미 없는 말(의문사, 요청 표현)은 매칭에서 제외
const STOPWORDS = new Set([
  "어떻게", "어떡해", "어떻해", "무엇", "뭐", "뭔가요", "왜", "어디", "어디서", "언제",
  "방법", "하는법", "하는", "하기", "할", "해요", "하나요", "합니까", "할까요", "하죠",
  "싶어요", "싶은데", "싶습니다", "알려줘", "알려주세요", "궁금해요", "궁금합니다",
  "좀", "제발", "그리고", "그런데", "근데", "혹시", "있나요", "인가요", "때",
  "파이널컷", "파컷", "fcp", "final", "cut", "pro", "에서",
  "how", "to", "do", "does", "i", "my", "the", "a", "an", "in", "on", "is", "it", "can", "what", "why"
]);
// 단어 끝의 한국어 조사/어미 제거 (간단 휴리스틱)
const PARTICLES = [
  "하나요", "할까요", "인가요", "습니까", "합니다", "에서는", "이라고", "까지", "부터",
  "처럼", "마다", "에서", "으로", "해요", "은", "는", "이", "가", "을", "를", "에", "의", "도", "로", "와", "과", "요"
];

function stripParticle(t) {
  for (const p of PARTICLES) {
    if (t.length - p.length >= 2 && t.endsWith(p)) return t.slice(0, t.length - p.length);
  }
  return t;
}

function tokenize(q) {
  return q.toLowerCase()
    .split(/[\s,./?!'"()~…]+/)
    .filter(Boolean)
    .map(stripParticle)
    .filter((t) => t.length >= 1 && !STOPWORDS.has(t));
}

// 토큰이 텍스트에 없으면 어미 변형을 고려해 끝을 줄여 가며 재시도
function tokenMatch(text, tok) {
  if (text.includes(tok)) return 1;
  if (tok.length >= 3 && text.includes(tok.slice(0, -1))) return 0.8;
  if (tok.length >= 4 && text.includes(tok.slice(0, -2))) return 0.6;
  return 0;
}

function scoreItem(tokens, fields) {
  // fields: [{ text, weight }]
  let score = 0;
  for (const tok of tokens) {
    for (const f of fields) {
      if (!f.text) continue;
      const m = tokenMatch(f.text.toLowerCase(), tok);
      if (m) score += f.weight * m * (tok.length >= 2 ? 1 : 0.3);
    }
  }
  return score;
}

function searchGuide(q, limit = 5) {
  const tokens = tokenize(q);
  if (!tokens.length || !DATA.guide) return [];
  return DATA.guide.sections
    .map((s) => ({
      item: s,
      score: scoreItem(tokens, [
        { text: s.title, weight: 4 },
        { text: (s.keywords || []).join(" "), weight: 5 },
        { text: stripHtml(s.body), weight: 1 }
      ])
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function searchIssues(q, limit = 4) {
  const tokens = tokenize(q);
  if (!tokens.length || !DATA.issues) return [];
  return DATA.issues.issues
    .map((i) => ({
      item: i,
      score: scoreItem(tokens, [
        { text: i.title, weight: 4 },
        { text: (i.keywords || []).join(" "), weight: 5 },
        { text: i.desc + " " + (i.workaround || ""), weight: 1 }
      ])
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function searchPlugins(q, limit = 3) {
  const tokens = tokenize(q);
  if (!tokens.length || !DATA.plugins) return [];
  return DATA.plugins.plugins
    .map((p) => ({
      item: p,
      score: scoreItem(tokens, [
        { text: p.name, weight: 4 },
        { text: (p.keywords || []).join(" "), weight: 5 },
        { text: p.desc + " " + (p.desc_en || ""), weight: 1 }
      ])
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* ---------------- 홈: 통합 검색 ---------------- */
function initHome() {
  const input = document.getElementById("q");
  const out = document.getElementById("search-results");
  if (!input) return;
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = input.value.trim();
      if (q.length < 2) { out.innerHTML = ""; return; }
      const g = searchGuide(q, 4);
      const i = searchIssues(q, 3);
      const p = searchPlugins(q, 3);
      if (!g.length && !i.length && !p.length) {
        out.innerHTML = `<div class="empty">${I18N.t("search.none")}</div>`;
        return;
      }
      let html = "";
      for (const r of g) html += resultRow("📖", `guide.html#${r.item.id}`, r.item.title, stripHtml(r.item.body).slice(0, 110) + "…");
      for (const r of i) html += resultRow("🐞", `issues.html#${r.item.id}`, r.item.title, r.item.desc.slice(0, 110) + "…");
      for (const r of p) html += resultRow("🧩", `plugins.html#${r.item.id}`, r.item.name, I18N.pick(r.item, "desc"));
      out.innerHTML = html;
    }, 180);
  });
}

function resultRow(emoji, href, title, snippet) {
  return `<a class="item" style="display:block" href="${href}">
    <h3>${emoji} ${esc(title)}</h3><p>${esc(snippet)}</p></a>`;
}

/* ---------------- 가이드 ---------------- */
function renderGuide(filter = "") {
  const toc = document.getElementById("toc");
  const body = document.getElementById("guide-body");
  if (!toc || !DATA.guide) return;
  const q = filter.trim();
  const visible = q
    ? searchGuide(q, 999).map((r) => r.item.id)
    : DATA.guide.sections.map((s) => s.id);

  let tocHtml = "";
  for (const ch of DATA.guide.chapters) {
    const secs = DATA.guide.sections.filter((s) => s.chapter === ch.id && visible.includes(s.id));
    if (!secs.length) continue;
    tocHtml += `<h4>${esc(ch.title)}</h4>`;
    tocHtml += secs.map((s) => `<a href="#${s.id}">${esc(s.title)}</a>`).join("");
  }
  toc.innerHTML = tocHtml || `<div class="empty">${I18N.t("search.none")}</div>`;

  body.innerHTML = DATA.guide.sections
    .filter((s) => visible.includes(s.id))
    .map((s) => `<section class="item" id="${s.id}" style="padding:20px 22px;margin-bottom:16px">
        <h3 style="font-size:18px">${esc(s.title)}</h3>${s.body}</section>`)
    .join("") || `<div class="empty">${I18N.t("search.none")}</div>`;

  if (location.hash) {
    const el = document.getElementById(location.hash.slice(1));
    if (el) el.scrollIntoView();
  }
}

function initGuide() {
  renderGuide();
  const f = document.getElementById("guide-filter");
  f?.addEventListener("input", () => renderGuide(f.value));
}

/* ---------------- 알려진 이슈 ---------------- */
let issueStatus = "all";
function renderIssues() {
  const out = document.getElementById("issues-list");
  const f = document.getElementById("issues-filter");
  if (!out || !DATA.issues) return;
  const q = (f?.value || "").trim();
  let list = q ? searchIssues(q, 999).map((r) => r.item) : DATA.issues.issues;
  if (issueStatus !== "all") list = list.filter((i) => i.status === issueStatus);

  document.getElementById("issues-count").textContent =
    `${I18N.t("search.results")}: ${list.length}`;

  out.innerHTML = list.map((i) => {
    const statusKey = { open: "issues.open", workaround: "issues.workaround", fixed: "issues.fixed" }[i.status] || i.status;
    return `<div class="item" id="${i.id}">
      <h3>${esc(i.title)}</h3>
      <p>${esc(i.desc)}</p>
      ${i.workaround ? `<p style="margin-top:8px"><b>💡 ${I18N.t("issues.workaround.label")}:</b> ${esc(i.workaround)}</p>` : ""}
      <div class="meta">
        <span class="badge ${i.status}">${I18N.t(statusKey)}</span>
        <span class="badge">${I18N.t("issues.affects")}: ${esc(i.affects)}</span>
      </div>
    </div>`;
  }).join("") || `<div class="empty">${I18N.t("search.none")}</div>`;
}

function initIssues() {
  renderIssues();
  document.getElementById("issues-filter")?.addEventListener("input", renderIssues);
  document.querySelectorAll(".filters [data-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      issueStatus = btn.dataset.status;
      document.querySelectorAll(".filters [data-status]").forEach((b) => b.classList.toggle("on", b === btn));
      renderIssues();
    });
  });
  document.addEventListener("fcpe:langchange", renderIssues);
}

/* ---------------- 플러그인 ---------------- */
let pluginCat = "all";
function renderPlugins() {
  const out = document.getElementById("plugins-list");
  const f = document.getElementById("plugins-filter");
  if (!out || !DATA.plugins) return;
  const q = (f?.value || "").trim();
  let list = q ? searchPlugins(q, 999).map((r) => r.item) : DATA.plugins.plugins;
  if (pluginCat !== "all") list = list.filter((p) => p.category === pluginCat);

  out.innerHTML = list.map((p) => {
    const cat = DATA.plugins.categories.find((c) => c.id === p.category);
    return `<a class="card" id="${p.id}" href="${esc(p.url)}" target="_blank" rel="noopener">
      <h3>${esc(p.name)} ↗</h3>
      <p>${esc(I18N.pick(p, "desc"))}</p>
      <div class="meta" style="display:flex;gap:6px;margin-top:10px">
        <span class="badge cat">${esc(cat ? I18N.pick(cat, "title") : p.category)}</span>
        <span class="badge">${I18N.t(p.pricing === "free" ? "plugins.free" : "plugins.paid")}</span>
      </div></a>`;
  }).join("") || `<div class="empty">${I18N.t("search.none")}</div>`;
}

function initPlugins() {
  const filters = document.getElementById("plugin-cats");
  filters.innerHTML =
    `<button data-cat="all" class="on">${I18N.t("plugins.all")}</button>` +
    DATA.plugins.categories.map((c) => `<button data-cat="${c.id}">${esc(I18N.pick(c, "title"))}</button>`).join("");
  filters.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      pluginCat = btn.dataset.cat;
      filters.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
      renderPlugins();
    });
  });
  document.getElementById("plugins-filter")?.addEventListener("input", renderPlugins);
  document.addEventListener("fcpe:langchange", () => { initPlugins(); renderPlugins(); });
  renderPlugins();
}

/* ---------------- 커뮤니티 ---------------- */
function renderCommunity() {
  const chat = document.getElementById("community-chat");
  const global = document.getElementById("community-global");
  if (!chat || !DATA.community) return;
  chat.innerHTML = DATA.community.chat.map((c) => `
    <div class="card">
      <div class="emoji">${c.emoji}</div>
      <h3>${esc(I18N.pick(c, "name"))}</h3>
      <p>${esc(I18N.pick(c, "desc"))}</p>
      <a class="btn" style="margin-top:14px;padding:9px 20px;font-size:14px" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(I18N.pick(c, "cta"))}</a>
    </div>`).join("");
  global.innerHTML = DATA.community.global.map((g) => `
    <a class="item" style="display:block" href="${esc(g.url)}" target="_blank" rel="noopener">
      <h3>${g.emoji} ${esc(g.name)} ↗</h3><p>${esc(I18N.pick(g, "desc"))}</p></a>`).join("");
}

function initCommunity() {
  renderCommunity();
  document.addEventListener("fcpe:langchange", renderCommunity);
}

/* ---------------- 질문하기 (에이전트) ---------------- */
function botSources(results, hrefBase, titleField, snippetFn) {
  return results.map((r) => {
    const it = r.item;
    return `<a class="src" href="${hrefBase}#${it.id}">
      <b>${esc(it[titleField])}</b><span>${esc(snippetFn(it))}</span></a>`;
  }).join("");
}

async function answerLocally(q) {
  const g = searchGuide(q, 3);
  const i = searchIssues(q, 2);
  const p = searchPlugins(q, 2);
  if (!g.length && !i.length && !p.length) {
    return `<p>${I18N.t("ask.answer.none")}</p>
      <p><a href="community.html">💬 ${I18N.t("nav.community")}</a> · <a href="feedback.html">📝 ${I18N.t("nav.feedback")}</a></p>`;
  }
  let html = "";
  if (g.length) {
    html += `<h4>${I18N.t("ask.answer.guide")}</h4>`;
    // 가장 관련 높은 섹션의 본문 요약을 직접 보여준다 (에이전트식 응답)
    html += `<div>${g[0].item.body}</div>`;
    html += botSources(g, "guide.html", "title", (s) => stripHtml(s.body).slice(0, 90) + "…");
  }
  if (i.length) {
    html += `<h4>${I18N.t("ask.answer.issues")}</h4>`;
    html += botSources(i, "issues.html", "title", (s) => (s.workaround ? "💡 " + s.workaround : s.desc).slice(0, 110) + "…");
  }
  if (p.length) {
    html += `<h4>${I18N.t("ask.answer.plugins")}</h4>`;
    html += botSources(p, "plugins.html", "name", (s) => I18N.pick(s, "desc"));
  }
  html += `<p style="margin-bottom:0;margin-top:12px;font-size:13.5px;color:var(--text-soft)">${I18N.t("ask.answer.more")}
    <a href="community.html">💬</a> <a href="feedback.html">📝</a></p>`;
  return html;
}

async function answerViaApi(q) {
  // 검색된 설명서 문단을 컨텍스트로 동봉해 서버리스 LLM 엔드포인트 호출
  const context = searchGuide(q, 4).map((r) => ({
    id: r.item.id, title: r.item.title, text: stripHtml(r.item.body)
  }));
  const issues = searchIssues(q, 3).map((r) => ({
    title: r.item.title, desc: r.item.desc, workaround: r.item.workaround
  }));
  const res = await fetch(CONFIG.ASK_API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: q, lang: I18N.lang, context, issues })
  });
  if (!res.ok) throw new Error("API " + res.status);
  const data = await res.json();
  return `<p>${esc(data.answer).replace(/\n/g, "<br>")}</p>`;
}

function addMsg(cls, html) {
  const log = document.getElementById("chat-log");
  const div = document.createElement("div");
  div.className = "msg " + cls;
  div.innerHTML = html;
  log.appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "end" });
  return div;
}

async function ask(q) {
  addMsg("user", esc(q));
  const thinking = addMsg("bot", "…");
  let html;
  try {
    html = CONFIG.ASK_API_ENDPOINT
      ? await answerViaApi(q).catch(() => answerLocally(q))
      : await answerLocally(q);
  } catch {
    html = await answerLocally(q);
  }
  thinking.innerHTML = html;
}

function initAsk() {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.value = "";
    ask(q);
  });
  document.querySelectorAll(".suggestions button").forEach((btn) => {
    btn.addEventListener("click", () => ask(btn.textContent.trim()));
  });
  const preset = new URLSearchParams(location.search).get("q");
  if (preset) ask(preset);
}

/* ---------------- 피드백 ---------------- */
function feedbackValues() {
  return {
    type: document.getElementById("fb-type").value,
    fcpVersion: document.getElementById("fb-fcpver").value.trim(),
    macVersion: document.getElementById("fb-macver").value.trim(),
    summary: document.getElementById("fb-summary").value.trim(),
    detail: document.getElementById("fb-detail").value.trim(),
    website: document.getElementById("fb-website")?.value || "", // 허니팟
    lang: I18N.lang
  };
}

// 워커 미설정 시 폴백: GitHub 이슈 작성 화면을 미리 채워서 연다
function openGithubPrefill(fb) {
  const labels = { bug: "bug,fcp-report", feature: "enhancement,fcp-report", site: "site-feedback" }[fb.type];
  const prefix = { bug: "[Bug]", feature: "[Feature Request]", site: "[Site]" }[fb.type];
  const body = [
    fb.type !== "site" ? `**Final Cut Pro:** ${fb.fcpVersion || "-"}` : "",
    fb.type !== "site" ? `**macOS / Hardware:** ${fb.macVersion || "-"}` : "",
    "", fb.detail,
    "", "---", "_Submitted via the fcpe.com feedback page. Bug reports are relayed to Apple Feedback._"
  ].filter((l) => l !== undefined).join("\n");
  const url = `https://github.com/${CONFIG.GITHUB_REPO}/issues/new` +
    `?title=${encodeURIComponent(prefix + " " + fb.summary)}` +
    `&labels=${encodeURIComponent(labels)}` +
    `&body=${encodeURIComponent(body)}`;
  window.open(url, "_blank", "noopener");
}

function setFeedbackStatus(kind, html) {
  const el = document.getElementById("fb-status");
  el.className = "note" + (kind === "error" ? " error" : "");
  el.style.display = "block";
  el.innerHTML = html;
}

function initFeedback() {
  const form = document.getElementById("feedback-form");
  const btn = form.querySelector("button[type=submit]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fb = feedbackValues();

    if (!CONFIG.FEEDBACK_API_ENDPOINT) {
      openGithubPrefill(fb);
      return;
    }

    btn.disabled = true;
    setFeedbackStatus("info", I18N.t("feedback.sending"));
    try {
      const res = await fetch(CONFIG.FEEDBACK_API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fb)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setFeedbackStatus("info",
          `${I18N.t("feedback.success")}` +
          (data.url ? ` <a href="${esc(data.url)}" target="_blank" rel="noopener">#${esc(String(data.number ?? ""))} ↗</a>` : ""));
        form.reset();
      } else {
        setFeedbackStatus("error", I18N.t("feedback.error"));
      }
    } catch {
      setFeedbackStatus("error", I18N.t("feedback.error"));
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------------- 부트스트랩 ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  await I18N.init();
  const page = document.body.dataset.page;
  try {
    if (page === "home") { await loadData("guide", "issues", "plugins"); initHome(); }
    if (page === "guide") { await loadData("guide"); initGuide(); }
    if (page === "issues") { await loadData("issues"); initIssues(); }
    if (page === "plugins") { await loadData("plugins"); initPlugins(); }
    if (page === "community") { await loadData("community"); initCommunity(); }
    if (page === "ask") { await loadData("guide", "issues", "plugins"); initAsk(); }
    if (page === "feedback") { initFeedback(); }
  } catch (err) {
    console.error("fcpe init error:", err);
  }
});
