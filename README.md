# fcpe.com — Final Cut Pro Everything

**파이널컷에 관련된 모든 것.** 전 세계 Final Cut Pro 사용자들이 어려움을 겪을 때 찾는 사이트.

- 📖 Final Cut Pro 사용 설명서 기반 가이드 & 문제 해결
- 🐞 알려진 이슈 / 버그 트래커 (fcp.cafe 등 커뮤니티 정보 취합)
- 🤖 질문하면 설명서 기반으로 에이전트처럼 답변
- 🧩 서드파티 플러그인 / 앱 안내
- 💬 카카오톡 오픈채팅 · Discord · 전 세계 유저그룹 연결
- 📝 유저 피드백 → 이 저장소의 GitHub 이슈로 자동 등록 → Apple에 전달

빌드 도구가 전혀 필요 없는 **순수 정적 사이트**입니다. GitHub에서 JSON 파일만 수정해도 사이트가 즉시 갱신됩니다 (GitHub Pages 자동 배포).

---

## 구조

```
index.html          홈 (통합 검색)
ask.html            질문하기 — 설명서/이슈/플러그인 기반 에이전트 응답
guide.html          사용 설명서 기반 가이드
issues.html         알려진 이슈 & 버그
plugins.html        서드파티 플러그인 / 앱
community.html      카톡방 · Discord · 유저그룹
feedback.html       피드백 → GitHub 이슈 등록
data/               모든 콘텐츠 (JSON) — 여기만 수정하면 사이트가 자란다
  guide.json        설명서 섹션
  issues.json       알려진 이슈
  plugins.json      서드파티 목록
  community.json    커뮤니티 링크
i18n/               UI 다국어 (ko / en / ja / zh)
scripts/
  ingest-guide.mjs  파이널컷 12.3 설명서 소스 → data/guide.json 변환기
assets/             CSS / JS
```

## 설명서 소스 넣기 (중요)

설명서 원본 소스 경로는 스크립트에 **고정**되어 있습니다
(`scripts/ingest-guide.mjs` 상단의 `DEFAULT_SRC`):

```
/Users/chrictvictory/코딩/파이널컷 PPT 제작/final_cut_pro_12_3_full_guide_source
```

이 저장소를 클론한 뒤, **소스가 있는 Mac에서** 인자 없이 아래 한 줄만 실행하면
그 경로의 `.md` / `.html` / `.txt` 문서를 읽어 `data/guide.json`을 생성/갱신하고,
소스 폴더의 이미지도 `assets/guide-img/`로 함께 복사해 **가이드와 질문 답변에
설명서의 사진과 내용이 그대로 표시**되게 합니다:

```bash
npm run ingest        # = node scripts/ingest-guide.mjs (고정 경로 사용)
git add data/guide.json assets/guide-img && git commit -m "설명서 콘텐츠 갱신" && git push
```

경로가 바뀌면 `DEFAULT_SRC`를 고치거나 인자로 넘기면 됩니다:
`node scripts/ingest-guide.mjs "<다른 경로>"`. 소스 폴더를 못 찾으면 스크립트가
안내 메시지와 함께 안전하게 종료됩니다(기존 `guide.json`은 그대로 유지).

### 이미지 처리 모드 (저작권 관련)

설명서 스크린샷을 원본 그대로 재배포하는 것은 규모가 커질수록 저작권(테이크다운)
위험이 있습니다. 세 가지 모드 중 선택할 수 있습니다:

| 명령 | 동작 | 저작권 |
|---|---|---|
| `npm run ingest` | 이미지 그대로 복사·표시, 설명 없음 | 🔴 원본 재배포 (주의) |
| `npm run ingest -- --describe` | 이미지 유지 + **Claude 비전이 각 화면을 분석해 한국어 설명(alt·캡션)** 자동 생성 | 🟡 인용 맥락·접근성 보강 |
| `npm run ingest -- --no-images` | **원본 이미지는 넣지 않고 AI 설명 텍스트만** 삽입 | ✅ 가장 안전 |

- `--describe` / `--no-images` 는 `ANTHROPIC_API_KEY` 환경변수가 필요합니다:
  `ANTHROPIC_API_KEY=sk-ant-... npm run ingest -- --no-images`
- 생성된 설명은 `data/guide-captions.json` 에 **캐시**되어 재실행 시 다시 호출하지
  않습니다(비용 절감). 이 파일도 커밋하세요.
- 설명은 검색 키워드에도 반영되어, 그림으로만 설명된 화면도 질문으로 찾을 수 있습니다.

현재 `data/guide.json`에는 대표 주제들로 만든 시드 콘텐츠(직접 그린 개념 다이어그램,
저작권 문제 없음)가 들어 있으며, 위 명령을 실행하면 실제 12.3 설명서로 교체됩니다.
이후 질문하기는 설명서 문단과 (모드에 따라) 이미지·AI 설명을 근거로 답하고,
답변 하단에 출처 섹션 링크를 함께 보여 줍니다.

## 콘텐츠 추가하는 법

- **알려진 이슈 추가**: `data/issues.json`에 항목 추가 (GitHub 웹에서 바로 편집 가능)
- **플러그인 추가**: `data/plugins.json`에 항목 추가
- **커뮤니티 링크**: `data/community.json` (카톡방/디스코드 초대 링크를 실제 링크로 교체하세요)
- **언어 추가**: `i18n/` 폴더에 언어 파일 추가 후 `assets/js/i18n.js`의 `SUPPORTED` 목록에 코드 추가

## 피드백 → Apple 전달 흐름

사이트의 피드백 페이지에서 작성한 내용은 이 저장소의 GitHub 이슈로 등록됩니다.
한국 사용자를 비롯해 많은 사람들이 Apple에 직접 리포트하지 않는 점에 착안하여,
여기 모인 이슈를 정리해 [Apple Feedback](https://www.apple.com/feedback/finalcutpro/)으로 전달합니다.

**유저는 GitHub 계정이 필요 없습니다.** `worker/feedback-worker.js`(Cloudflare Worker)를
배포하면, 폼 제출이 워커로 전송되어 ① Claude API가 내용을 **영어로 의역·정리**하고
(원문은 이슈 하단에 접혀서 보존) ② **fcpe 계정**의 토큰으로 이슈가 자동 등록됩니다.

워커 배포 (약 5분, 무료 티어로 충분):

1. [Cloudflare](https://dash.cloudflare.com) → Workers & Pages → Create Worker →
   `worker/feedback-worker.js` 내용 붙여넣기 → Deploy
2. Worker의 Settings → Variables and Secrets에 등록:
   - `GITHUB_TOKEN` (Secret) — fcpe 계정의 Fine-grained PAT (이 저장소, Issues: Read and write만)
   - `GITHUB_REPO` — `groundroot/fcp-everything-website`
   - `ANTHROPIC_API_KEY` (Secret) — Claude API 키 (없으면 번역 없이 원문으로 등록)
   - `ALLOWED_ORIGIN` — `https://fcpe.com`
3. 워커 URL을 `assets/js/config.js`의 `FEEDBACK_API_ENDPOINT`에 넣고 푸시

워커를 설정하지 않으면 예전 방식(GitHub 이슈 작성 화면을 미리 채워서 열기)으로 동작합니다.
스팸은 허니팟 필드로 1차 차단됩니다.

## AI 에이전트 연동 (선택)

`ask.html`은 기본적으로 설명서/이슈 데이터 검색 기반으로 답변합니다.
실제 LLM(Claude API) 연동을 원하면 서버리스 엔드포인트(Cloudflare Worker 등)를 만들고
`assets/js/config.js`의 `ASK_API_ENDPOINT`에 URL을 넣으면, 검색된 설명서 문단을
컨텍스트로 함께 보내 스트리밍 답변을 받도록 되어 있습니다.

## 배포

`main` 브랜치에 푸시하면 GitHub Actions가 GitHub Pages로 자동 배포합니다.
저장소 Settings → Pages → Source를 **GitHub Actions**로 설정한 뒤,
`fcpe.com` 도메인을 커스텀 도메인으로 연결하세요 (`CNAME` 파일 포함됨).
