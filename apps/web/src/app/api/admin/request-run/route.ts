import { NextResponse } from "next/server";
import { db, batchRequests } from "@cinemo/shared";

/**
 * 로컬 배치 수동 실행 요청 — 어드민 버튼이 호출.
 * batch_requests에 한 줄 남기면, 각 PC의 5분 폴러가 "내 마지막 실행보다 새 요청이면 수집"한다.
 * (Vercel 서버는 사용자 PC에 직접 접근 못 하므로 플래그 방식.)
 */
const ALLOWED = new Set(["insta-local"]);

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { source?: string };
  const source = body.source ?? "insta-local";
  if (!ALLOWED.has(source)) {
    return NextResponse.json({ error: "허용되지 않은 source" }, { status: 400 });
  }
  const requestedAt = new Date().toISOString();
  await db.insert(batchRequests).values({ source, requestedAt });
  return NextResponse.json({ ok: true, source, requestedAt });
}
