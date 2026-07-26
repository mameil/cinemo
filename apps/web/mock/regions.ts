import type { RegionPreset } from "./types";

/**
 * 지역 프리셋 (GET /api/regions) — ⚠️ v1 홈에서는 미사용.
 *
 * 사용자 결정: v1 홈은 지역 선택 없이 크롤 대상 전역(파주·일산·고양·서울 서부)을 그대로 보여준다.
 * 이 프리셋 목록은 향후(v2) 지역 필터/즐겨찾기 도입 시를 위한 보류 자료로만 남겨둔다.
 * keywords는 실제 적재된 지점명(branch_name) 기준 — 크롤러 `--only` 와 동일한 부분일치 방식.
 */
export const MOCK_REGIONS: RegionPreset[] = [
  {
    id: "seoul-yongsan",
    label: "서울 도심(용산·강남)",
    keywords: ["용산", "강남", "왕십리", "청량리", "건대"],
    theaterCount: 9,
  },
  {
    id: "seoul-west",
    label: "서울 서부(영등포·목동)",
    keywords: ["영등포", "목동", "신촌", "홍대", "상암"],
    theaterCount: 8,
  },
  {
    id: "goyang-ilsan",
    label: "일산·고양",
    keywords: ["일산", "고양", "화정", "행신"],
    theaterCount: 5,
  },
  {
    id: "anyang-pyeongchon",
    label: "안양·평촌",
    keywords: ["평촌", "범계", "안양", "인덕원"],
    theaterCount: 4,
  },
  {
    id: "incheon",
    label: "인천",
    keywords: ["인천", "부평", "송도", "청라"],
    theaterCount: 6,
  },
];

/** 기본 선택 지역 (localStorage 없을 때) */
export const DEFAULT_REGION_ID = "seoul-yongsan";
