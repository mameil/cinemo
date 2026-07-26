import { createClient } from "@libsql/client";

// 사용법: npx tsx --env-file=.env scripts/query.ts "SELECT * FROM movies LIMIT 5"
async function main() {
  const sql = process.argv.slice(2).join(" ");
  if (!sql) {
    console.error('SQL을 인자로 넘겨주세요. 예: ... scripts/query.ts "SELECT * FROM movies LIMIT 5"');
    process.exit(1);
  }

  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  const res = await client.execute(sql);
  console.table(res.rows);
  console.log(`(${res.rows.length} rows)`);
}

main();
