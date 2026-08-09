/**
 * 어드민 쓰기(수동 실행) 보호.
 * env ADMIN_SECRET 이 설정돼 있으면 요청 헤더 `x-admin-secret` 일치를 요구한다.
 * 미설정이면 통과(공개) — 편의상 기본 개방이나, 클라우드 dispatch를 붙일 땐 설정 권장.
 */
export function requireAdmin(req: Request): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return true;
  return req.headers.get("x-admin-secret") === secret;
}
