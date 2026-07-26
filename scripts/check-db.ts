import { createClient } from "@libsql/client";

async function main() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  const res = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table'"
  );
  console.log(
    "테이블 목록:",
    res.rows.map((r) => r.name)
  );
}

main();
