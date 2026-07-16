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

설명서 원본 소스는 로컬 Mac의 아래 경로에 있습니다:

```
/Users/chrictvictory/코딩/파이널컷 PPT 제작/final_cut_pro_12_3_full_guide_source
```

이 저장소를 클론한 뒤, Mac에서 아래 명령을 실행하면 소스 폴더의 `.md` / `.html` / `.txt` 문서들을 읽어 `data/guide.json`을 생성/갱신합니다:

```bash
node scripts/ingest-guide.mjs "/Users/chrictvictory/코딩/파이널컷 PPT 제작/final_cut_pro_12_3_full_guide_source"
git add data/guide.json && git commit -m "설명서 콘텐츠 갱신" && git push
```

현재 `data/guide.json`에는 대표 주제들로 만든 시드 콘텐츠가 들어 있으며, 위 명령을 실행하면 실제 12.3 설명서 전체로 교체됩니다.

## 콘텐츠 추가하는 법

- **알려진 이슈 추가**: `data/issues.json`에 항목 추가 (GitHub 웹에서 바로 편집 가능)
- **플러그인 추가**: `data/plugins.json`에 항목 추가
- **커뮤니티 링크**: `data/community.json` (카톡방/디스코드 초대 링크를 실제 링크로 교체하세요)
- **언어 추가**: `i18n/` 폴더에 언어 파일 추가 후 `assets/js/i18n.js`의 `SUPPORTED` 목록에 코드 추가

## 피드백 → Apple 전달 흐름

사이트의 피드백 페이지에서 작성한 내용은 이 저장소의 GitHub 이슈로 등록됩니다
(`.github/ISSUE_TEMPLATE/` 양식 사용). 한국 사용자를 비롯해 많은 사람들이 Apple에
직접 리포트하지 않는 점에 착안하여, 여기 모인 이슈를 정리해
[Apple Feedback](https://www.apple.com/feedback/finalcutpro/)으로 전달합니다.

## AI 에이전트 연동 (선택)

`ask.html`은 기본적으로 설명서/이슈 데이터 검색 기반으로 답변합니다.
실제 LLM(Claude API) 연동을 원하면 서버리스 엔드포인트(Cloudflare Worker 등)를 만들고
`assets/js/config.js`의 `ASK_API_ENDPOINT`에 URL을 넣으면, 검색된 설명서 문단을
컨텍스트로 함께 보내 스트리밍 답변을 받도록 되어 있습니다.

## 배포

`main` 브랜치에 푸시하면 GitHub Actions가 GitHub Pages로 자동 배포합니다.
저장소 Settings → Pages → Source를 **GitHub Actions**로 설정한 뒤,
`fcpe.com` 도메인을 커스텀 도메인으로 연결하세요 (`CNAME` 파일 포함됨).
