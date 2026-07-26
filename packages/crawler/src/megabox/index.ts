/**
 * 메가박스 크롤러 실행 엔트리
 *
 *   pnpm --filter @cinemo/crawler megabox              # 전체 수집 + DB 적재
 *   pnpm --filter @cinemo/crawler megabox -- --dry     # 수집 결과만 출력 (DB 미적재)
 *   pnpm --filter @cinemo/crawler megabox -- --max=3   # 최대 3건만
 */

import { collectMegabox } from "./collect";
import { ingest } from "../db/repo";

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const dry = args.includes("--dry");
  const maxArg = args.find((a) => a.startsWith("--max="));
  const maxEvents = maxArg ? Number(maxArg.split("=")[1]) : undefined;

  console.log(`=== 메가박스 수집 시작 ${dry ? "(dry-run: DB 미적재)" : ""} ===`);
  const collected = await collectMegabox({ maxEvents });
  console.log(`이벤트 ${collected.length}건 수집\n`);

  const preview = dry ? collected : collected.slice(0, 5);
  for (const ev of preview) {
    console.log(`[${ev.sourceEventId}] ${ev.eventName}`);
    console.log(
      `  영화: ${ev.movieTitle ?? "(추출 실패)"} | 기간: ${ev.startDate} ~ ${ev.endDate}`
    );
    for (const g of ev.goodies) {
      const avail = g.stock.filter((s) => s.status !== "소진").length;
      console.log(
        `  굿즈: ${g.name} — 지점 ${g.stock.length}곳 중 ${avail}곳 보유`
      );
    }
    console.log();
  }

  if (dry) {
    console.log("=== dry-run 종료 (DB 미적재) ===");
    return;
  }

  const stats = await ingest("MEGA", collected);
  console.log("=== 적재 완료 ===");
  console.log(stats);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
