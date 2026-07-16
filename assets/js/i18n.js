// 다국어(UI) 처리 — i18n/*.json 사전을 로드해 data-i18n 속성에 적용
const I18N = {
  SUPPORTED: ["ko", "en", "ja", "zh"],
  LABELS: { ko: "한국어", en: "English", ja: "日本語", zh: "中文" },
  dict: {},
  lang: "ko",

  detect() {
    const saved = localStorage.getItem("fcpe-lang");
    if (saved && this.SUPPORTED.includes(saved)) return saved;
    const nav = (navigator.language || "ko").slice(0, 2).toLowerCase();
    return this.SUPPORTED.includes(nav) ? nav : "en";
  },

  async init() {
    this.lang = this.detect();
    await this.load(this.lang);
    this.buildSwitcher();
    this.apply();
  },

  async load(lang) {
    const res = await fetch(`i18n/${lang}.json`);
    this.dict = await res.json();
    this.lang = lang;
    document.documentElement.lang = lang;
  },

  t(key) {
    return this.dict[key] || key;
  },

  // 콘텐츠 객체에서 언어에 맞는 필드 선택 (ko 원문 / *_en 번역)
  pick(obj, field) {
    if (this.lang !== "ko" && obj[field + "_en"]) return obj[field + "_en"];
    return obj[field];
  },

  apply() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.innerHTML = this.t(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      el.placeholder = this.t(el.dataset.i18nPh);
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      document.title = this.t(el.dataset.i18nTitle) + " — fcpe.com";
    });
  },

  buildSwitcher() {
    const sel = document.getElementById("lang");
    if (!sel) return;
    sel.innerHTML = this.SUPPORTED.map(
      (l) => `<option value="${l}" ${l === this.lang ? "selected" : ""}>${this.LABELS[l]}</option>`
    ).join("");
    sel.addEventListener("change", async () => {
      localStorage.setItem("fcpe-lang", sel.value);
      await this.load(sel.value);
      this.apply();
      document.dispatchEvent(new CustomEvent("fcpe:langchange"));
    });
  }
};
