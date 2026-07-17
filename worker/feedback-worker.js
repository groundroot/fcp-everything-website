/**
 * fcpe.com 피드백 워커 (Cloudflare Worker)
 *
 * 사이트의 피드백 폼 제출을 받아:
 *  1. Claude API로 내용을 영어로 의역·정리하고 (원문은 이슈 하단에 보존)
 *  2. fcpe 계정의 토큰으로 GitHub 이슈를 생성합니다.
 * 유저는 GitHub 계정이 필요 없습니다.
 *
 * 배포 (Cloudflare 대시보드에서 이 파일을 붙여넣기만 하면 됩니다):
 *  1. Cloudflare → Workers & Pages → Create Worker → 이 파일 내용 붙여넣기
 *  2. Settings → Variables and Secrets 에 등록:
 *     - GITHUB_TOKEN     (필수, Secret)  fcpe 계정의 Fine-grained PAT.
 *                        이 저장소에 대해 Issues: Read and write 권한만 부여.
 *     - GITHUB_REPO      (필수)          예: groundroot/fcp-everything-website
 *     - ANTHROPIC_API_KEY(권장, Secret)  Claude API 키. 없으면 번역 없이 원문으로 등록.
 *     - ALLOWED_ORIGIN   (권장)          예: https://fcpe.com  (CORS 제한)
 *  3. 워커 URL을 assets/js/config.js 의 FEEDBACK_API_ENDPOINT 에 넣고 배포.
 *
 * 단일 파일·무의존성으로 유지하기 위해 Anthropic API는 raw HTTP(fetch)로 호출합니다.
 */

const MAX = { summary: 200, detail: 5000, fcpVersion: 50, macVersion: 100 };
const TYPES = {
  bug: { labels: ["bug", "fcp-report"], prefix: "[Bug]" },
  feature: { labels: ["enhancement", "fcp-report"], prefix: "[Feature Request]" },
  site: { labels: ["site-feedback"], prefix: "[Site]" }
};

function corsHeaders(env, origin) {
  const allowed = env.ALLOWED_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": allowed === "*" ? "*" : (origin === allowed ? allowed : allowed),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8"
  };
}

function json(env, origin, status, data) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(env, origin) });
}

/** Claude API로 영어 의역: {title, body, category} 반환. 실패 시 null. */
async function translateWithClaude(env, fb) {
  if (!env.ANTHROPIC_API_KEY) return null;

  const schema = {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Concise English issue title, imperative or descriptive, no prefix tag"
      },
      body: {
        type: "string",
        description: "Well-structured English description in Markdown: what happens, steps to reproduce if inferable, expected behavior. Faithful paraphrase, not literal translation."
      }
    },
    required: ["title", "body"],
    additionalProperties: false
  };

  const prompt = [
    "You are triaging user feedback for fcpe.com, a community site for Final Cut Pro users.",
    "Rewrite the following user-submitted feedback as a clear, well-explained English GitHub issue.",
    "Paraphrase for clarity (do not translate word-for-word). Keep all technical details.",
    "Bug reports will be relayed to Apple, so make reproduction steps and expected vs actual behavior explicit when the report allows it. Do not invent details that are not in the report.",
    "",
    `Feedback type: ${fb.type}`,
    fb.fcpVersion ? `Final Cut Pro version: ${fb.fcpVersion}` : "",
    fb.macVersion ? `macOS / hardware: ${fb.macVersion}` : "",
    `Summary (original language): ${fb.summary}`,
    "Details (original language):",
    fb.detail
  ].filter(Boolean).join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (data.stop_reason === "refusal") return null;
  const text = (data.content || []).find((b) => b.type === "text")?.text;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed.title && parsed.body) return parsed;
  } catch {}
  return null;
}

/** GitHub 이슈 생성 (fcpe 계정 토큰 사용) */
async function createIssue(env, { title, body, labels }) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "fcpe-feedback-worker",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ title, body, labels })
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }
  const issue = await res.json();
  return { url: issue.html_url, number: issue.number };
}

export function buildIssue(fb, translated) {
  const t = TYPES[fb.type] || TYPES.bug;
  const title = `${t.prefix} ${translated ? translated.title : fb.summary}`.slice(0, 250);

  const env_section = fb.type !== "site"
    ? `**Final Cut Pro:** ${fb.fcpVersion || "-"}\n**macOS / Hardware:** ${fb.macVersion || "-"}\n\n`
    : "";

  const main = translated
    ? translated.body
    : `${fb.detail}\n\n_(Automatic translation unavailable — original text above.)_`;

  const original = translated
    ? `\n\n---\n<details><summary>Original report (${fb.lang || "unknown"})</summary>\n\n**${fb.summary}**\n\n${fb.detail}\n\n</details>`
    : "";

  const footer = "\n\n---\n_Submitted anonymously via the [fcpe.com](https://fcpe.com) feedback form. Bug reports are collected and relayed to [Apple Feedback](https://www.apple.com/feedback/finalcutpro/)._";

  return { title, body: env_section + main + original + footer, labels: t.labels };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, origin) });
    }
    if (request.method !== "POST") {
      return json(env, origin, 405, { ok: false, error: "method not allowed" });
    }

    let fb;
    try {
      fb = await request.json();
    } catch {
      return json(env, origin, 400, { ok: false, error: "invalid json" });
    }

    // 허니팟: 봇이 채우는 숨은 필드 — 조용히 성공으로 응답
    if (fb.website) return json(env, origin, 200, { ok: true });

    // 검증
    if (!fb.summary?.trim() || !fb.detail?.trim()) {
      return json(env, origin, 400, { ok: false, error: "summary and detail are required" });
    }
    if (!TYPES[fb.type]) fb.type = "bug";
    for (const [k, max] of Object.entries(MAX)) {
      if (fb[k] && String(fb[k]).length > max) {
        return json(env, origin, 400, { ok: false, error: `${k} too long (max ${max})` });
      }
    }
    fb.summary = String(fb.summary).trim();
    fb.detail = String(fb.detail).trim();

    try {
      const translated = await translateWithClaude(env, fb).catch(() => null);
      const issue = buildIssue(fb, translated);
      const created = await createIssue(env, issue);
      return json(env, origin, 200, { ok: true, url: created.url, number: created.number });
    } catch (err) {
      console.error("feedback worker error:", err);
      return json(env, origin, 502, { ok: false, error: "failed to create issue" });
    }
  }
};
