import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * 클라우드 배치 수동 실행 — GitHub Actions `workflow_dispatch` 트리거.
 * PAT는 서버 env `GITHUB_DISPATCH_TOKEN`(workflow 권한)로만 쓰이고 노출되지 않는다.
 */
const REPO = "mameil/cinemo";
const ALLOWED: Record<string, string> = {
  showtime: "schedule.yml", // 상영시간표
  goods: "crawl.yml", // 체인 굿즈
  "insta-apify": "insta.yml", // 인스타 Apify 폴백
};

export async function POST(req: Request) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_DISPATCH_TOKEN 미설정 — Vercel 환경변수에 PAT를 추가하세요." },
      { status: 503 }
    );
  }
  const body = (await req.json().catch(() => ({}))) as { target?: string };
  const workflow = body.target ? ALLOWED[body.target] : undefined;
  if (!workflow) {
    return NextResponse.json({ error: "허용되지 않은 target" }, { status: 400 });
  }

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "master" }),
    }
  );

  if (res.status === 204) {
    return NextResponse.json({ ok: true, target: body.target, workflow });
  }
  const text = await res.text().catch(() => "");
  return NextResponse.json(
    { error: `GitHub ${res.status}: ${text.slice(0, 200)}` },
    { status: 502 }
  );
}
