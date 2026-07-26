/**
 * 한 줄 쿼리 → 시간 / 장소 / 영화 구조화 파싱 (클라이언트).
 * 챗봇식 자연어 응답이 아니라, 파싱 결과를 시간표 필터로 그대로 반영한다.
 * 예: "주토피아 일산 저녁" → 영화=주토피아 · 장소=일산 · 시간=17:00 이후
 */

export interface TheaterLite {
  id: number;
  branchName: string;
  area: string;
}

export interface ParsedQuery {
  date: string | null; // YYYY-MM-DD
  dateLabel: string | null;
  timeFrom: string | null; // HH:MM
  timeTo: string | null;
  timeLabel: string | null;
  location: string | null; // 지점/지역 키워드 (coverage 극장 목록과 대조됨)
  movieText: string | null; // 잔여 텍스트 = 영화 제목 후보
}

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── 날짜 ──

function extractDate(text: string): { date: string; label: string; rest: string } | null {
  const today = new Date();

  // "7/20" / "7월 20일"
  const md = text.match(/(\d{1,2})\s*[\/월]\s*(\d{1,2})일?/);
  if (md) {
    const d = new Date(today.getFullYear(), parseInt(md[1]) - 1, parseInt(md[2]));
    return { date: fmt(d), label: `${md[1]}/${md[2]}`, rest: text.replace(md[0], " ") };
  }

  // "(이번주) X요일"
  const dayM = text.match(/(이번\s*주?\s*)?([월화수목금토일])요일/);
  if (dayM) {
    const target = DAY_NAMES.indexOf(dayM[2]);
    let diff = target - today.getDay();
    if (diff <= 0) diff += 7;
    const d = new Date(today);
    d.setDate(d.getDate() + diff);
    return { date: fmt(d), label: `${dayM[2]}요일`, rest: text.replace(dayM[0], " ") };
  }

  if (/주말/.test(text)) {
    let diff = 6 - today.getDay();
    if (diff <= 0) diff += 7;
    const d = new Date(today);
    d.setDate(d.getDate() + diff);
    return { date: fmt(d), label: "주말(토)", rest: text.replace(/이번\s*주말|주말/, " ") };
  }
  if (/모레/.test(text)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 2);
    return { date: fmt(d), label: "모레", rest: text.replace(/내일모레|모레/, " ") };
  }
  if (/내일/.test(text)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return { date: fmt(d), label: "내일", rest: text.replace(/내일/, " ") };
  }
  if (/오늘/.test(text)) {
    return { date: fmt(today), label: "오늘", rest: text.replace(/오늘/, " ") };
  }
  return null;
}

// ── 시간 ──

function extractTime(text: string): { from: string | null; to: string | null; label: string; rest: string } | null {
  // "N시(반) (이후|부터|이전|까지)"
  const m = text.match(/(\d{1,2})\s*시\s*(반)?\s*(이후|부터|이전|까지)?/);
  if (m) {
    let h = parseInt(m[1]);
    const isAM = /오전|아침|새벽/.test(text);
    if (h >= 1 && h <= 8 && !isAM) h += 12; // 1~8시는 오후로 간주
    if (isAM && h === 12) h = 0;
    const mm = m[2] ? "30" : "00";
    const t = `${String(h).padStart(2, "0")}:${mm}`;
    const rest = text.replace(m[0], " ").replace(/오전|오후|아침|새벽/, " ");
    const disp = `${m[1]}시${m[2] ? "반" : ""}`;
    if (m[3] === "이전" || m[3] === "까지") return { from: null, to: t, label: `${disp} 이전`, rest };
    return { from: t, to: null, label: `${disp} 이후`, rest };
  }

  const words: [RegExp, string | null, string | null, string][] = [
    [/심야/, "22:00", null, "심야"],
    [/밤/, "20:00", null, "밤"],
    [/저녁/, "17:00", null, "저녁"],
    [/오후|낮/, "12:00", null, "오후"],
    [/아침|오전/, null, "12:00", "오전"],
  ];
  for (const [re, from, to, label] of words) {
    if (re.test(text)) return { from, to, label, rest: text.replace(re, " ") };
  }
  return null;
}

// ── 장소 (커버리지 극장 목록과 대조) ──

function extractLocation(text: string, theaters: TheaterLite[]): { location: string; rest: string } | null {
  const tokens = text.split(/\s+/).filter(Boolean);
  for (const raw of tokens) {
    const tok = raw.replace(/(에서|에)$/, "");
    if (tok.length < 2) continue;
    const hit = theaters.some(
      (t) => t.branchName.includes(tok) || t.area.includes(tok) || tok.includes(t.branchName)
    );
    if (hit) return { location: tok, rest: text.replace(raw, " ") };
  }
  return null;
}

// ── 메인 ──

export function parseQuery(raw: string, theaters: TheaterLite[]): ParsedQuery {
  let text = ` ${raw.trim()} `;

  const d = extractDate(text);
  if (d) text = d.rest;
  const t = extractTime(text);
  if (t) text = t.rest;
  const loc = extractLocation(text, theaters);
  if (loc) text = loc.rest;

  // 잔여 텍스트 → 영화 제목 후보 (의도 표현만 최소 제거)
  const movieText =
    text
      .replace(/보고\s*싶(어|은데)?|볼래|볼까|보여줘|알려줘|찾아줘|상영|시간표?|특전|굿즈/g, " ")
      .replace(/\s+/g, " ")
      .trim() || null;

  return {
    date: d?.date ?? null,
    dateLabel: d?.label ?? null,
    timeFrom: t?.from ?? null,
    timeTo: t?.to ?? null,
    timeLabel: t?.label ?? null,
    location: loc?.location ?? null,
    movieText,
  };
}
