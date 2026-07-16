#!/usr/bin/env node
/**
 * 파이널컷 사용 설명서 소스 → data/guide.json 변환기
 *
 * 사용법 (소스가 있는 Mac에서):
 *   node scripts/ingest-guide.mjs "/Users/chrictvictory/코딩/파이널컷 PPT 제작/final_cut_pro_12_3_full_guide_source"
 *
 * 소스 폴더의 .md / .html / .htm / .txt 문서를 재귀적으로 읽어
 * 사이트가 사용하는 data/guide.json 형식으로 변환합니다.
 * 하위 폴더 이름이 챕터가 됩니다 (없으면 "manual" 챕터).
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, extname, basename, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = process.argv[2];
if (!SRC) {
  console.error('사용법: node scripts/ingest-guide.mjs "<설명서 소스 폴더 경로>"');
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "guide.json");
const EXTS = new Set([".md", ".markdown", ".html", ".htm", ".txt"]);

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (EXTS.has(extname(e.name).toLowerCase())) yield p;
  }
}

function slugify(s) {
  return s.toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "section";
}

/* --- 최소 Markdown → HTML --- */
function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) =>
    esc(s)
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

/* --- HTML 정리: head/script/style 제거, body 내용만 --- */
function cleanHtml(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const body = s.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (body) s = body[1];
  // 위험/불필요 요소 제거
  s = s.replace(/<\/?(html|head|meta|link|iframe|form|input|button|nav|header|footer)[^>]*>/gi, "");
  s = s.replace(/\son\w+="[^"]*"/gi, "");
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

const sections = [];
const chapterSet = new Map();
let count = 0;

for await (const file of walk(SRC)) {
  const raw = await readFile(file, "utf8");
  const ext = extname(file).toLowerCase();
  const isHtml = ext === ".html" || ext === ".htm";
  const rel = relative(SRC, file);
  const chapterName = rel.includes(sep) ? rel.split(sep)[0] : "manual";
  const chapterId = slugify(chapterName);
  if (!chapterSet.has(chapterId)) chapterSet.set(chapterId, chapterName === "manual" ? "사용 설명서" : chapterName);

  const title = titleOf(raw, file, isHtml);
  const body = isHtml ? cleanHtml(raw)
    : ext === ".txt" ? mdToHtml(raw)
    : mdToHtml(raw.replace(/^#\s+.+$/m, "")); // 첫 h1은 제목으로 썼으므로 본문에서 제거

  if (!textOf(body)) continue;

  let id = slugify(title);
  while (sections.some((s) => s.id === id)) id += "-2";

  const text = textOf(body);
  const keywords = [...new Set(
    (title + " " + text.slice(0, 400)).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2)
  )].slice(0, 25);

  sections.push({ id, chapter: chapterId, title, keywords, body });
  count++;
  console.log(`  + [${chapterName}] ${title}`);
}

if (!count) {
  console.error("변환할 문서(.md/.html/.txt)를 찾지 못했습니다:", SRC);
  process.exit(1);
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
console.log(`\n✅ ${count}개 섹션 → ${OUT}`);
console.log("git add data/guide.json && git commit && git push 하면 사이트에 반영됩니다.");
