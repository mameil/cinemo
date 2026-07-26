/**
 * 권역(지역) 설정 — 극장 하드코딩이 아니라 **시/군/구 조합**으로 정의.
 *
 * 극장은 지오코딩(theater-geo)으로 sigungu가 자동 부여되므로, 여기서는
 * "이 권역 = 어떤 시군구들"만 정하면 된다. 새 극장이 생겨도 시군구만 맞으면 자동 포함.
 */

export interface RegionDef {
  key: string;
  name: string;
  /** 이 권역에 속하는 시/군/구 목록 (theaters.sigungu 값과 매칭) */
  sigungu: string[];
}

export const REGIONS: RegionDef[] = [
  {
    key: "goyang-paju-seoul-west",
    name: "일산·고양 / 파주 / 서울 서부",
    sigungu: [
      "고양시",
      "파주시",
      "김포시",
      "영등포구",
      "구로구",
      "금천구",
      "양천구",
      "강서구",
      "마포구",
      "은평구",
      "서대문구",
    ],
  },
  {
    key: "seoul-all",
    name: "서울 전체",
    sigungu: [], // sido='서울...' 로 처리 (빈 배열이면 시도 기준)
  },
];

export function regionByKey(key: string): RegionDef | undefined {
  return REGIONS.find((r) => r.key === key);
}
