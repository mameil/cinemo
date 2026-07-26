/**
 * 극장 지오코딩 백필 — 좌표/주소 → 행정구역(시군구) 자동 분류
 *
 * 카카오 로컬 API(무료)로 "{체인} {지점}"을 검색해 주소·시군구·좌표를 받아 theaters에 저장한다.
 * 하드코딩 대신 좌표/주소로 자동 매핑 → 새 극장도 자동 편입, "권역=시군구 조합"으로 필터 가능.
 *
 *   pnpm --filter @cinemo/crawler theater-geo -- --dry   # 매칭 결과만 출력
 *   pnpm --filter @cinemo/crawler theater-geo            # DB 저장
 *
 * 필요: 환경변수 KAKAO_REST_KEY (developers.kakao.com REST API 키, 무료)
 */

import { db, theaters } from "@cinemo/shared";
import { eq, isNull } from "drizzle-orm";

const KEY = process.env.KAKAO_REST_KEY;

const CHAIN_KR: Record<string, string> = {
  CGV: "CGV",
  LOTTE: "롯데시네마",
  MEGA: "메가박스",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Geo {
  address: string;
  sido: string;
  sigungu: string;
  lat: string;
  lng: string;
}

/** 카카오 키워드 검색으로 극장 위치 해석 */
async function geocode(chain: string, branch: string): Promise<Geo | null> {
  const name = branch.replace(/^CGV\s*/, "").trim();
  const query = `${CHAIN_KR[chain] ?? chain} ${name}`;
  const url =
    "https://dapi.kakao.com/v2/local/search/keyword.json?category_group_code=CT1&size=1&query=" +
    encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KEY}` },
  });
  if (!res.ok) throw new Error(`Kakao HTTP ${res.status}`);
  const data = (await res.json()) as {
    documents: {
      address_name: string;
      road_address_name: string;
      x: string;
      y: string;
    }[];
  };
  const d = data.documents?.[0];
  if (!d) return null;
  const addr = d.road_address_name || d.address_name || "";
  const parts = addr.split(/\s+/);
  return {
    address: addr,
    sido: parts[0] ?? "",
    sigungu: parts[1] ?? "",
    lat: d.y,
    lng: d.x,
  };
}

async function main() {
  if (!KEY) {
    console.error("KAKAO_REST_KEY 환경변수가 필요합니다 (developers.kakao.com REST 키).");
    process.exit(1);
  }
  const dry = process.argv.includes("--dry");
  const pending = await db
    .select()
    .from(theaters)
    .where(isNull(theaters.sigungu));
  console.log(`=== 극장 지오코딩${dry ? " (DRY)" : ""}: 대상 ${pending.length}곳 ===`);

  let ok = 0,
    miss = 0;
  for (const t of pending) {
    let geo: Geo | null = null;
    try {
      geo = await geocode(t.chain, t.branchName);
    } catch (e) {
      console.error(`  ✗ ${t.chain} ${t.branchName}: ${(e as Error).message}`);
    }
    if (!geo || !geo.sigungu) {
      console.log(`  ? ${t.chain} ${t.branchName} — 매칭 실패`);
      miss++;
      await sleep(120);
      continue;
    }
    console.log(`  ✓ ${t.chain} ${t.branchName} → ${geo.sido} ${geo.sigungu}`);
    if (!dry) {
      await db
        .update(theaters)
        .set({
          sido: geo.sido,
          sigungu: geo.sigungu,
          latitude: geo.lat,
          longitude: geo.lng,
          address: geo.address,
        })
        .where(eq(theaters.id, t.id));
    }
    ok++;
    await sleep(120);
  }
  console.log(`\n=== 완료: ${ok}곳 매칭 / ${miss}곳 실패 ===`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
