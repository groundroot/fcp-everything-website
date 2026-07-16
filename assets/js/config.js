// fcpe.com 사이트 설정
const CONFIG = {
  // 피드백이 이슈로 등록될 GitHub 저장소
  GITHUB_REPO: "groundroot/fcp-everything-website",

  // (선택) 실제 LLM 에이전트 엔드포인트.
  // Cloudflare Worker 등으로 Claude API를 프록시하는 URL을 넣으면
  // ask.html 이 검색된 설명서 문단을 컨텍스트로 함께 보내 답변을 받습니다.
  // 비워 두면 설명서/이슈 검색 기반으로만 답변합니다.
  ASK_API_ENDPOINT: ""
};
