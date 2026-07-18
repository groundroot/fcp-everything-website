#!/usr/bin/env node
/**
 * 파이널컷 사용 설명서 소스 → data/guide.json 변환기 (이미지 포함)
 *
 * 설명서 소스 경로는 아래 DEFAULT_SRC 에 고정되어 있습니다.
 * 따라서 소스가 있는 Mac에서 인자 없이 그냥 실행하면 됩니다:
 *   node scripts/ingest-guide.mjs
 * (다른 경로를 쓰려면 인자로 덮어쓸 수 있습니다:
 *   node scripts/ingest-guide.mjs "/다른/경로")
 *
 * - 소스 폴더의 .md / .html / .htm / .txt 문서를 재귀적으로 읽어
 *   사이트가 사용하는 data/guide.json 형식으로 변환합니다.
 * - 소스 폴더의 이미지(.png/.jpg/.jpeg/.gif/.webp/.svg/.avif)를
 *   assets/guide-img/ 로 복사하고, 본문의 <img>와 ![..](..)를 자동 연결합니다.
 * - 하위 폴더 이름이 챕터가 됩니다 (없으면 "manual" 챕터).
 *
 * 이미지 처리 모드 (플래그):
 *   (기본)        이미지를 복사해 그대로 표시. 설명 없음.
 *   --describe    각 이미지를 Claude 비전으로 분석해 한국어 설명(alt·캡션)을
 *                 자동 생성. 이미지는 유지하되 접근성·검색·인용맥락이 좋아집니다.
 *                 (ANTHROPIC_API_KEY 환경변수 필요)
 *   --no-images   원본 이미지를 복사하지 않고, --describe로 만든 설명 텍스트만
 *                 넣습니다. 설명서 이미지를 재배포하지 않으므로 가장 안전합니다.
 *                 (--no-images 는 자동으로 --describe 를 켭니다)
 *   --model <id>  설명 생성에 쓸 모델 (기본 claude-opus-4-8)
 *
 * 설명은 data/guide-captions.json 에 캐시되어 재실행 시 재호출하지 않습니다.
 */
import { readdir, readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises";
import { join, extname, basename, relative, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ⬇ 설명서 소스 위치 고정. 이 경로에서 사진과 내용을 가져와 질문에 답합니다.
const DEFAULT_SRC = "/Users/chrictvictory/코딩/파이널컷 PPT 제작/final_cut_pro_12_3_full_guide_source";

const rawArgs = process.argv.slice(2);
const flags = new Set(rawArgs.filter((a) => a.startsWith("--")));
const positional = rawArgs.filter((a) => !a.startsWith("--") && rawArgs[rawArgs.indexOf(a) - 1] !== "--model");
const modelIdx = rawArgs.indexOf("--model");
const MODEL = modelIdx >= 0 ? rawArgs[modelIdx + 1] : "claude-opus-4-8";
const NO_IMAGES = flags.has("--no-images");
const DESCRIBE = flags.has("--describe") || NO_IMAGES;

const SRC = positional[0] || DEFAULT_SRC;

if (DESCRIBE && !process.env.ANTHROPIC_API_KEY) {
  console.error("--describe / --no-images 모드에는 ANTHROPIC_API_KEY 환경변수가 필요합니다.");
  console.error('예:  ANTHROPIC_API_KEY=sk-ant-... node scripts/ingest-guide.mjs --describe');
  process.exit(1);
}

try {
  await access(SRC);
} catch {
  console.error(`설명서 소스 폴더를 찾을 수 없습니다:\n  ${SRC}\n`);
  console.error("이 스크립트는 설명서 소스가 있는 Mac에서 실행해야 합니다.");
  console.error("경로가 바뀌었다면 scripts/ingest-guide.mjs 상단의 DEFAULT_SRC 를 수정하거나,");
  console.error('인자로 넘겨 주세요:  node scripts/ingest-guide.mjs "<소스 경로>"');
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "guide.json");
const IMG_OUT_DIR = join(ROOT, "assets", "guide-img");
const IMG_SITE_PREFIX = "assets/guide-img/";
const DOC_EXTS = new Set([".md", ".markdown", ".html", ".htm", ".txt"]);
const IMG_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"]);

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function slugify(s) {
  return s.toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "section";
}

/* --- 1차 스캔: 문서/이미지 분류, 이미지 경로 맵 구성 --- */
const docFiles = [];
const imageMap = new Map(); // 소스 절대경로 → 사이트 경로 (assets/guide-img/…)
const usedNames = new Set();

for await (const file of walk(SRC)) {
  const ext = extname(file).toLowerCase();
  if (DOC_EXTS.has(ext)) docFiles.push(file);
  else if (IMG_EXTS.has(ext)) {
    let name = slugify(basename(file, ext)) + ext;
    let i = 2;
    while (usedNames.has(name)) name = `${slugify(basename(file, ext))}-${i++}${ext}`;
    usedNames.add(name);
    imageMap.set(resolve(file), IMG_SITE_PREFIX + name);
  }
}

const usedImages = new Set();

/** 문서 파일 기준으로 이미지 참조(src)를 사이트 경로로 변환. 못 찾으면 원본 유지 */
function resolveImg(docFile, src) {
  if (!src || /^(https?:|data:)/i.test(src)) return src;
  const abs = resolve(dirname(docFile), decodeURI(src.split("?")[0].split("#")[0]));
  const mapped = imageMap.get(abs);
  if (mapped) { usedImages.add(abs); return mapped; }
  return src;
}

/* --- 최소 Markdown → HTML (이미지 지원) --- */
function mdToHtml(md, docFile) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) =>
    esc(s)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) =>
        `<img src="${resolveImg(docFile, src)}" alt="${alt}" loading="lazy">`)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/\*([^*]+)\*/g, "<i>$1</i>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = md.split(/\r?\n/);
  let html = "", inList = false, para = [];
  const flush = () => {
    if (para.length) { html += `<p>${inline(para.join(" "))}</p>`; para = []; }
  };
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
  for (const line of lines) {
    const l = line.trim();
    if (!l) { flush(); closeList(); continue; }
    const h = l.match(/^(#{1,6})\s+(.*)/);
    if (h) { flush(); closeList(); const lv = Math.min(h[1].length + 2, 5); html += `<h${lv}>${inline(h[2])}</h${lv}>`; continue; }
    const li = l.match(/^[-*+]\s+(.*)/);
    if (li) { flush(); if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    para.push(l);
  }
  flush(); closeList();
  return html;
}

/* --- HTML 정리: head/script/style 제거, 이미지 경로 재작성 --- */
function cleanHtml(html, docFile) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const body = s.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (body) s = body[1];
  s = s.replace(/<\/?(html|head|meta|link|iframe|form|input|button|nav|header|footer)[^>]*>/gi, "");
  s = s.replace(/\son\w+="[^"]*"/gi, "");
  // <img> 경로 재작성 (alt 유지, lazy 로딩)
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!src) return "";
    const alt = tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || "";
    return `<img src="${resolveImg(docFile, src)}" alt="${alt.replace(/"/g, "&quot;")}" loading="lazy">`;
  });
  return s.trim();
}

function titleOf(raw, file, isHtml) {
  if (isHtml) {
    const t = raw.match(/<title[^>]*>([^<]+)<\/title>/i) || raw.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (t) return t[1].trim();
  } else {
    const h = raw.match(/^#\s+(.+)$/m);
    if (h) return h[1].trim();
  }
  return basename(file).replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
}

function textOf(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/* --- Claude 비전으로 이미지 설명 생성 --- */
const VISION_MEDIA = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp"
};
const CAPTION_CACHE = join(ROOT, "data", "guide-captions.json");

async function loadCaptionCache() {
  try { return JSON.parse(await readFile(CAPTION_CACHE, "utf8")); }
  catch { return {}; }
}

const DESCRIBE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["alt", "caption"],
  properties: {
    alt: { type: "string", description: "화면을 한 문장으로 요약한 접근성 대체 텍스트 (한국어, 40자 내외)" },
    caption: { type: "string", description: "이 스크린샷이 Final Cut Pro의 어떤 화면·기능이고 무엇을 보여주는지 1~2문장으로 설명 (한국어)" }
  }
};

/** 이미지 1개를 Claude 비전으로 설명. 실패 시 null */
async function describeImage(absPath) {
  const ext = extname(absPath).toLowerCase();
  const media = VISION_MEDIA[ext];
  if (!media) return null; // svg/avif 등 비전 미지원 형식은 건너뜀
  const b64 = (await readFile(absPath)).toString("base64");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      output_config: { format: { type: "json_schema", schema: DESCRIBE_SCHEMA } },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: media, data: b64 } },
          { type: "text", text: "이 이미지는 Apple Final Cut Pro 사용 설명서의 스크린샷입니다. Final Cut Pro 사용자가 이 화면을 글로만 읽고도 이해할 수 있도록, 어떤 화면·패널·버튼이 보이고 무엇을 하는 장면인지 한국어로 설명해 주세요. 화면에 없는 내용은 지어내지 마세요." }
        ]
      }]
    })
  });

  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.stop_reason === "refusal") return null;
  const text = (data.content || []).find((b) => b.type === "text")?.text;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed.alt || parsed.caption) return parsed;
  } catch {}
  return null;
}

/** 동시성 제한 풀 실행 */
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/* --- 2차: 문서 변환 --- */
const sections = [];
const chapterSet = new Map();

for (const file of docFiles) {
  const raw = await readFile(file, "utf8");
  const ext = extname(file).toLowerCase();
  const isHtml = ext === ".html" || ext === ".htm";
  const rel = relative(SRC, file);
  const chapterName = rel.includes(sep) ? rel.split(sep)[0] : "manual";
  const chapterId = slugify(chapterName);
  if (!chapterSet.has(chapterId)) chapterSet.set(chapterId, chapterName === "manual" ? "사용 설명서" : chapterName);

  const title = titleOf(raw, file, isHtml);
  const body = isHtml ? cleanHtml(raw, file)
    : ext === ".txt" ? mdToHtml(raw, file)
    : mdToHtml(raw.replace(/^#\s+.+$/m, ""), file); // 첫 h1은 제목으로 썼으므로 본문에서 제거

  if (!textOf(body) && !/<img/i.test(body)) continue;

  let id = slugify(title);
  while (sections.some((s) => s.id === id)) id += "-2";

  const text = textOf(body);
  const keywords = [...new Set(
    (title + " " + text.slice(0, 400)).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2)
  )].slice(0, 25);

  sections.push({ id, chapter: chapterId, title, keywords, body });
  console.log(`  + [${chapterName}] ${title}`);
}

if (!sections.length) {
  console.error("변환할 문서(.md/.html/.txt)를 찾지 못했습니다:", SRC);
  process.exit(1);
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* --- 3차: 이미지 설명 생성 (--describe) --- */
// site 경로("assets/guide-img/x.png") → { alt, caption }
const descBySite = {};
if (DESCRIBE && usedImages.size) {
  const cache = await loadCaptionCache();
  const list = [...usedImages].map((abs) => ({ abs, site: imageMap.get(abs) }));
  let done = 0, fromCache = 0, failed = 0;
  console.log(`\n🖼  이미지 설명 생성 중 (${list.length}개, 모델 ${MODEL})…`);
  await mapPool(list, 4, async ({ abs, site }) => {
    if (cache[site]) { descBySite[site] = cache[site]; fromCache++; done++; return; }
    try {
      const d = await describeImage(abs);
      if (d) { descBySite[site] = d; cache[site] = d; }
      else failed++;
    } catch (e) {
      failed++;
      console.warn(`   ! 설명 실패 ${site}: ${e.message}`);
    }
    done++;
    if (done % 10 === 0) console.log(`   … ${done}/${list.length}`);
  });
  await mkdir(dirname(CAPTION_CACHE), { recursive: true });
  await writeFile(CAPTION_CACHE, JSON.stringify(cache, null, 2), "utf8");
  console.log(`   완료: 신규 ${done - fromCache - failed}, 캐시 ${fromCache}, 실패 ${failed} (캐시: ${relative(ROOT, CAPTION_CACHE)})`);
}

/* --- 4차: 본문의 <img> 를 모드에 맞게 후처리 --- */
function postProcessImages(html) {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    if (!src.startsWith(IMG_SITE_PREFIX)) return tag; // 외부 이미지는 그대로
    const d = descBySite[src];
    const origAlt = tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || "";
    const alt = (d && d.alt) || origAlt;
    const caption = d && d.caption;

    if (NO_IMAGES) {
      // 원본 이미지 없이 설명 텍스트만 (가장 안전)
      const body = caption || alt || "설명서 그림";
      return `<figure class="guide-shot text-only"><figcaption>🖼 <b>화면 설명</b> — ${esc(body)}` +
        `<span class="src-note">출처: Apple Final Cut Pro 사용 설명서 (그림은 생략, AI 설명)</span></figcaption></figure>`;
    }
    // 이미지 유지 + (있으면) 설명 캡션
    const imgTag = `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">`;
    if (caption) {
      return `<figure class="guide-shot"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">` +
        `<figcaption>${esc(caption)}<span class="src-note">출처: Apple Final Cut Pro 사용 설명서</span></figcaption></figure>`;
    }
    return imgTag;
  });
}

for (const s of sections) {
  if (/<img/i.test(s.body)) {
    s.body = postProcessImages(s.body);
    // 검색 품질 향상: 생성된 설명을 키워드에 반영
    const extra = textOf(s.body).slice(0, 400).toLowerCase()
      .split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
    s.keywords = [...new Set([...s.keywords, ...extra])].slice(0, 40);
  }
}

/* --- 5차: 실제로 참조된 이미지 복사 (--no-images 면 생략) --- */
let copied = 0;
if (!NO_IMAGES && usedImages.size) {
  await mkdir(IMG_OUT_DIR, { recursive: true });
  for (const abs of usedImages) {
    const site = imageMap.get(abs);
    await copyFile(abs, join(IMG_OUT_DIR, site.slice(IMG_SITE_PREFIX.length)));
    copied++;
  }
}

const out = {
  meta: {
    source: SRC,
    generatedBy: "scripts/ingest-guide.mjs",
    generatedAt: new Date().toISOString(),
    targetVersion: "Final Cut Pro 12.3",
    imageMode: NO_IMAGES ? "descriptions-only" : (DESCRIBE ? "images+descriptions" : "images"),
    describedImages: Object.keys(descBySite).length
  },
  chapters: [...chapterSet].map(([id, title]) => ({ id, title })),
  sections
};

await writeFile(OUT, JSON.stringify(out, null, 2), "utf8");

console.log(`\n✅ 섹션 ${sections.length}개 → ${OUT}`);
if (NO_IMAGES) {
  console.log(`   이미지 모드: 설명 텍스트만 (원본 미복사, 저작권 안전). 설명 ${Object.keys(descBySite).length}개`);
  console.log("git add data/guide.json data/guide-captions.json && git commit && git push");
} else if (DESCRIBE) {
  console.log(`   이미지 모드: 이미지 유지 + AI 설명 캡션. 복사 ${copied}개, 설명 ${Object.keys(descBySite).length}개`);
  console.log("git add data/guide.json data/guide-captions.json assets/guide-img && git commit && git push");
} else {
  console.log(`   이미지 모드: 이미지만 복사 (설명 없음). 복사 ${copied}개`);
  console.log("   💡 설명서 이미지를 그대로 재배포하는 방식입니다. 저작권이 걱정되면");
  console.log("      --describe (이미지+AI설명) 또는 --no-images (설명만) 를 고려하세요.");
  console.log("git add data/guide.json assets/guide-img && git commit && git push");
}
