/**
 * 롯데시네마 크롤러 실행 엔트리
 *
 *   pnpm --filter @cinemo/crawler lotte              # 전체 수집 + DB 적재
 *   pnpm --filter @cinemo/crawler lotte -- --dry     # 수집 결과만 출력 (DB 미적재)
 *   pnpm --filter @cinemo/crawler lotte -- --max=3   # 최대 3건만
 */

import { collectLotte } from "./collect";
import { ingest } from "../db/repo";

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const dry = args.includes("--dry");
  const maxArg = args.find((a) => a.startsWith("--max="));
  const maxEvents = maxArg ? Number(maxArg.split("=")[1]) : undefined;

  console.log(`=== 롯데 수집 시작 ${dry ? "(dry-run: DB 미적재)" : ""} ===`);
  const collected = await collectLotte({ maxEvents });
  console.log(`굿즈 이벤트 ${collected.length}건 수집\n`);

  const preview = dry ? collected : collected.slice(0, 5);
  for (const ev of preview) {
    console.log(`[${ev.sourceEventId}] ${ev.eventName}`);
    console.log(
      `  영화: ${ev.movieTitle ?? "(추출 실패)"} | 기간: ${ev.startDate} ~ ${ev.endDate}`
    );
    if (ev.imageUrl) console.log(`  이미지: ${ev.imageUrl}`);
    console.log(`  굿즈: ${ev.goodies.length}개`);
    for (const g of ev.goodies) {
      const stockSummary = g.stock.length > 0
        ? `${g.stock.length}지점 (보유: ${g.stock.filter(s => s.status === "보유").length}, 소량: ${g.stock.filter(s => s.status === "소량보유").length}, 소진: ${g.stock.filter(s => s.status === "소진").length})`
        : "재고 없음";
      console.log(`    - ${g.name} [${g.sourceGoodsId}] → ${stockSummary}`);
    }
    console.log();
  }

  if (dry) {
    console.log("=== dry-run 종료 (DB 미적재) ===");
    return;
  }

  const stats = await ingest("LOTTE", collected);
  console.log("=== 적재 완료 ===");
  console.log(stats);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
