/**
 * 로컬 감시 공통 런타임 — 로그 · 폰 푸시(ntfy) · 상태 파일 · 연속 실패 관리
 *
 * 알림은 ntfy 폰 푸시만 쓴다 (맥 알림센터·음성 같은 OS 전용 수단은 2026-11 폐기 —
 * 어느 PC에서 돌든 폰으로 오면 충분하고, 맥·윈도우 코드를 하나로 유지하기 위해).
 *
 * 비밀·환경 파일 (전부 레포 밖, 커밋 금지):
 *   ~/.cinemo/ntfy-topic          폰 푸시 토픽 (추측 불가 랜덤 — 아는 사람은 누구나 구독 가능)
 *   ~/.cinemo/ntfy-topic-<kind>   종류별 토픽 (있으면 우선. 예: ntfy-topic-seat)
 *   ~/.cinemo/ca-bundle.pem       회사망 SSL 가로채기 대응 CA (없으면 시스템 기본)
 */

import { appendFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { request } from "https";
import { homedir, platform } from "os";
import { rootCertificates } from "tls";
import { join } from "path";

const CINEMO_HOME = join(homedir(), ".cinemo");
const CA_BUNDLE = join(CINEMO_HOME, "ca-bundle.pem");
const LOG_MAX_BYTES = 5 * 1024 * 1024; // 넘으면 .1 로 한 번 굴린다
const NTFY_URL = "https://ntfy.sh";
const NTFY_TIMEOUT_MS = 10_000;

/** OS 관례 위치의 로그 파일 */
export const LOG_PATH =
  platform() === "darwin"
    ? join(homedir(), "Library", "Logs", "cinemo-watch.log")
    : platform() === "win32"
      ? join(process.env.LOCALAPPDATA ?? CINEMO_HOME, "cinemo-watch.log")
      : join(CINEMO_HOME, "cinemo-watch.log");

/** 회사망 CA가 있으면 curl-impersonate(CGV)·curl(메가박스)에도 적용되도록 env로 넘긴다 */
export function applyCaBundle(): void {
  if (existsSync(CA_BUNDLE) && !process.env.CURL_CA_BUNDLE) process.env.CURL_CA_BUNDLE = CA_BUNDLE;
}

function rotateIfLarge(): void {
  try {
    if (statSync(LOG_PATH).size > LOG_MAX_BYTES) renameSync(LOG_PATH, `${LOG_PATH}.1`);
  } catch {
    // 로그 파일이 아직 없음 — 굴릴 것 없음
  }
}

function ts(): string {
  const d = new Date(Date.now() + 9 * 3600e3); // KST
  return d.toISOString().replace("T", " ").slice(0, 19);
}

export function makeLogger(name: string): (msg: string) => void {
  rotateIfLarge();
  return (msg: string) => {
    const line = `${ts()} [${name}] ${msg}\n`;
    appendFileSync(LOG_PATH, line);
    process.stdout.write(line);
  };
}

function readTrimmed(path: string): string {
  try {
    return readFileSync(path, "utf-8").replace(/\s/g, "");
  } catch {
    return "";
  }
}

export function ntfyTopic(kind: string): string {
  return readTrimmed(join(CINEMO_HOME, `ntfy-topic-${kind}`)) || readTrimmed(join(CINEMO_HOME, "ntfy-topic"));
}

export interface PushMessage {
  topic: string;
  title: string;
  message: string;
  /** 5=최대(방해금지 관통) 4=높음 3=보통 2=낮음 */
  priority: number;
  click?: string;
  tags?: string[];
}

/** ntfy 발행 — 헤더는 비ASCII(한글 제목)에 약해서 JSON 발행을 쓴다. HTTP 코드를 돌려준다. */
export function pushNtfy(msg: PushMessage): Promise<number> {
  const body = JSON.stringify(msg);
  const ca = existsSync(CA_BUNDLE) ? [...rootCertificates, readFileSync(CA_BUNDLE, "utf-8")] : undefined;
  return new Promise((resolve, reject) => {
    const req = request(
      NTFY_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: NTFY_TIMEOUT_MS,
        ca,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      }
    );
    req.on("timeout", () => req.destroy(new Error("ntfy 타임아웃")));
    req.on("error", reject);
    req.end(body);
  });
}

/** 상태 파일 — 숫자 카운터 */
export function readCount(path: string): number {
  const n = Number(readTrimmed(path));
  return Number.isFinite(n) ? n : 0;
}

export function writeText(path: string, text: string): void {
  writeFileSync(path, text);
}

export function readText(path: string): string {
  try {
    return readFileSync(path, "utf-8").trim();
  } catch {
    return "";
  }
}

export function removeFile(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}

/** 오늘(KST) YYYYMMDD · 지금(KST) YYYYMMDDHHMM */
export function nowKst(): { ymd: string; ymdhm: string } {
  const iso = new Date(Date.now() + 9 * 3600e3).toISOString();
  const ymd = iso.slice(0, 10).replace(/-/g, "");
  return { ymd, ymdhm: ymd + iso.slice(11, 16).replace(":", "") };
}
