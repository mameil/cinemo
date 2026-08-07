import { createClient } from "@libsql/client";

// 배치 실행 기록 조회 (crawl_runs) — 두 PC 로컬 배치가 언제·어디서·성공/실패·몇 건 걷었는지.
// 사용법: DOTENV_CONFIG_PATH=.env pnpm exec tsx --require dotenv/config scripts/runs.ts [개수]
//   기본 20건. 특정 소스만: ... scripts/runs.ts 20 insta-local
async function main() {
  const limit = Number(process.argv[2]) || 20;
  const source = process.argv[3];

  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  const where = source ? `WHERE source = '${source.replace(/'/g, "")}'` : "";
  const res = await client.execute(
    `SELECT started_at, machine, source, status, events, screenings, detail
     FROM crawl_runs ${where} ORDER BY id DESC LIMIT ${limit}`
  );
  console.table(res.rows);
  console.log(`(${res.rows.length} rows)`);
}

main();
