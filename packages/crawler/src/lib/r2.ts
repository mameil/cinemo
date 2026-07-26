/**
 * Cloudflare R2 업로드 유틸 (S3 호환 API)
 *
 * 용도: 인스타그램 CDN 이미지는 서명이 붙어 만료되므로, 수집 즉시 R2에 복사하고
 * 우리 퍼블릭 URL(R2_PUBLIC_URL)로 치환한다. (설계서 2026-07-22 인스타 파이프라인 ④)
 *
 * 환경변수: R2_ACCOUNT_ID · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_BUCKET · R2_PUBLIC_URL
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

// ── 과금 방어 (R2는 무료 한도 초과 시 실과금 — budget-guard.ts 참고) ──
/** 프로세스(=크론 1회)당 업로드 상한 — 폭주 시 저장/쓰기 과금 방지 */
const MAX_UPLOADS_PER_RUN = 120;
/** 개별 이미지 크기 상한 (인스타 이미지는 보통 수백 KB) */
const MAX_OBJECT_BYTES = 8 * 1024 * 1024;
let uploadsThisRun = 0;

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 환경변수 누락 (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)");
  }
  client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

function bucket(): string {
  const b = process.env.R2_BUCKET;
  if (!b) throw new Error("R2_BUCKET 환경변수 누락");
  return b;
}

function publicUrl(key: string): string {
  const base = process.env.R2_PUBLIC_URL;
  if (!base) throw new Error("R2_PUBLIC_URL 환경변수 누락");
  return `${base.replace(/\/$/, "")}/${key}`;
}

/** 이미 업로드된 키인지 (재크롤 시 중복 업로드 방지) */
export async function existsInR2(key: string): Promise<boolean> {
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * 원격 이미지를 R2로 복사하고 퍼블릭 URL을 반환.
 * 같은 키가 이미 있으면 다운로드/업로드 생략 (멱등).
 */
export async function copyImageToR2(sourceUrl: string, key: string): Promise<string> {
  if (await existsInR2(key)) return publicUrl(key);

  if (uploadsThisRun >= MAX_UPLOADS_PER_RUN) {
    throw new Error(`R2 업로드 상한(${MAX_UPLOADS_PER_RUN}/실행) 도달 — 과금 방지를 위해 이번 실행에선 생략`);
  }

  const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`이미지 다운로드 실패 HTTP ${res.status}: ${sourceUrl.slice(0, 80)}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.byteLength > MAX_OBJECT_BYTES) {
    throw new Error(`이미지 크기 초과(${Math.round(body.byteLength / 1024 / 1024)}MB > 8MB) — 업로드 생략`);
  }
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  uploadsThisRun++;

  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return publicUrl(key);
}
