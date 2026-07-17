#!/usr/bin/env node
/**
 * 파이널컷 사용 설명서 소스 → data/guide.json 변환기 (이미지 포함)
 *
 * 사용법 (소스가 있는 Mac에서):
 *   node scripts/ingest-guide.mjs "/Users/chrictvictory/코딩/파이널컷 PPT 제작/final_cut_pro_12_3_full_guide_source"
 *
 * - 소스 폴더의 .md / .html / .htm / .txt 문서를 재귀적으로 읽어
 *   사이트가 사용하는 data/guide.json 형식으로 변환합니다.
 * - 소스 폴더의 이미지(.png/.jpg/.jpeg/.gif/.webp/.svg/.avif)를
 *   assets/guide-img/ 로 복사하고, 본문의 <img>와 ![..](..)를 자동 연결합니다.
 *   → 질문 답변과 가이드에 설명서 이미지가 그대로 표시됩니다.
 * - 하위 폴더 이름이 챕터가 됩니다 (없으면 "manual" 챕터).
 */
import { readdir, readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { join, extname, basename, relative, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = process.argv[2];
if (!SRC) {
  console.error('사용법: node scripts/ingest-guide.mjs "<설명서 소스 폴더 경로>"');
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

/* --- 3차: 실제로 참조된 이미지만 복사 --- */
if (usedImages.size) {
  await mkdir(IMG_OUT_DIR, { recursive: true });
  for (const abs of usedImages) {
    const site = imageMap.get(abs);
    await copyFile(abs, join(IMG_OUT_DIR, site.slice(IMG_SITE_PREFIX.length)));
  }
}

const out = {
  meta: {
    source: SRC,
    generatedBy: "scripts/ingest-guide.mjs",
    generatedAt: new Date().toISOString(),
    targetVersion: "Final Cut Pro 12.3"
  },
  chapters: [...chapterSet].map(([id, title]) => ({ id, title })),
  sections
};

await writeFile(OUT, JSON.stringify(out, null, 2), "utf8");
console.log(`\n✅ 섹션 ${sections.length}개, 이미지 ${usedImages.size}개 → ${OUT}`);
console.log("git add data/guide.json assets/guide-img && git commit && git push 하면 사이트에 반영됩니다.");
