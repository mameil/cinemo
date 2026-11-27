/**
 * 좌석 감시 — 이름 규칙과 "붙어 있는 N자리(연석)" 판정. 네트워크 없는 순수 함수.
 *
 * 붙어 있음은 좌석 번호가 아니라 CGV 좌석 응답의 실제 배치로 본다:
 *   - 같은 줄: seatRowNm 과 ycoordStartVal 이 같다
 *   - 맞닿음: 왼쪽 자리 xcoordEndVal === 오른쪽 자리 xcoordStartVal (통로 자리는 x 가 한 칸 띄어 있다)
 *   - 통로 없음: 왼쪽 자리 rghtPwayYn·오른쪽 자리 leftPwayYn 둘 다 "Y" 가 아니다
 * 예) 영등포 IMAX관 J6 [x 11-13, rghtPwayYn=Y] · J7 [x 15-17, leftPwayYn=Y] → 번호는 이웃이지만 연석 아님.
 */

import type { CgvSeat } from "../cgv/api";

export const seatId = (s: Pick<CgvSeat, "seatRowNm" | "seatNo">): string => s.seatRowNm + s.seatNo;

function isTouching(left: CgvSeat, right: CgvSeat): boolean {
  return (
    left.seatRowNm === right.seatRowNm &&
    left.ycoordStartVal === right.ycoordStartVal &&
    Number(left.xcoordEndVal) === Number(right.xcoordStartVal) &&
    left.rghtPwayYn !== "Y" &&
    right.leftPwayYn !== "Y"
  );
}

/**
 * 고른 좌석들 중 모두 빈 연속 n자리 묶음 → ["L13-L14", ...]
 * 4자리가 이어 비면 n=2 기준 L13-L14 · L14-L15 · L15-L16 셋 — 그중 하나라도 처음 보는 것이면 알릴 수 있게 창 단위로 낸다.
 */
export function freeAdjacentGroups(seats: CgvSeat[], n: number): string[] {
  const free = seats
    .filter((s) => s.seatSaleYn === "Y")
    .sort((a, b) => a.seatRowNm.localeCompare(b.seatRowNm) || Number(a.xcoordStartVal) - Number(b.xcoordStartVal));

  const runs: CgvSeat[][] = [];
  for (const seat of free) {
    const run = runs.at(-1);
    if (run && isTouching(run.at(-1)!, seat)) run.push(seat);
    else runs.push([seat]);
  }

  return runs.flatMap((run) =>
    run.slice(0, Math.max(0, run.length - n + 1)).map((_, i) => `${seatId(run[i])}-${seatId(run[i + n - 1])}`)
  );
}

/** rows=J,L,M cols=9-19 → ["J9", ..., "M19"] (cols 는 "9-19" 범위 또는 "9 10 12" 목록, 섞어도 됨) */
export function expandRowsCols(rows: string, cols: string): string[] {
  const rowList = rows.split(/[\s,]+/).filter(Boolean);
  const colList = cols
    .split(/[\s,]+/)
    .filter(Boolean)
    .flatMap((tok) => {
      const m = tok.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) throw new Error(`cols 는 숫자 또는 범위(9-19): ${tok}`);
      const [from, to] = [Number(m[1]), Number(m[2] ?? m[1])];
      if (to < from) throw new Error(`cols 범위가 거꾸로: ${tok}`);
      return Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
    });
  if (rowList.length === 0 || colList.length === 0) throw new Error("rows·cols 둘 다 필요");
  return rowList.flatMap((r) => colList.map((c) => r + c));
}
