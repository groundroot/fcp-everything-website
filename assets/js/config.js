// fcpe.com 사이트 설정
const CONFIG = {
  // 피드백이 이슈로 등록될 GitHub 저장소
  GITHUB_REPO: "groundroot/fcp-everything-website",

  // 피드백 워커 엔드포인트 (worker/feedback-worker.js 배포 후 URL 입력).
  // 설정하면: 유저가 GitHub 계정 없이 제출 → 영어로 의역·정리되어
  // fcpe 계정으로 이슈가 등록됩니다.
  // 비워 두면: GitHub 이슈 작성 화면을 미리 채워서 여는 예전 방식으로 동작.
  FEEDBACK_API_ENDPOINT: "",

  // (선택) 실제 LLM 에이전트 엔드포인트.
  // Cloudflare Worker 등으로 Claude API를 프록시하는 URL을 넣으면
  // ask.html 이 검색된 설명서 문단을 컨텍스트로 함께 보내 답변을 받습니다.
  // 비워 두면 설명서/이슈 검색 기반으로만 답변합니다.
  ASK_API_ENDPOINT: ""
};
