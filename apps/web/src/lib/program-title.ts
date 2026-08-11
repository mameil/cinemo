export interface ProgramTitle {
  title: string;
  badges: string[];
}

/**
 * 극장 편성명에서 확실히 알려진 기획전·부가행사 표기만 분리한다.
 * 일반적인 대괄호나 콜론은 작품 제목일 수 있으므로 임의로 제거하지 않는다.
 */
export function parseProgramTitle(original: string): ProgramTitle {
  let title = original.trim();
  const badges: string[] = [];
  const addBadge = (badge: string) => {
    if (!badges.includes(badge)) badges.push(badge);
  };

  const bracket = title.match(/^\[(시네마투어|정시상영단)\]\s*(.+)$/u);
  if (bracket) {
    addBadge(bracket[1]);
    title = bracket[2].trim();
  }

  const allMovieNight = title.match(/^\[올무비나잇(?:\s+with\s+[^\]]+)?\]\s*(.+)$/iu);
  if (allMovieNight) {
    addBadge("올무비나잇");
    title = allMovieNight[1].trim();
  }

  const prefixes: Array<[RegExp, string]> = [
    [/^보여줘,\s*시네클럽!\s*/u, "시네클럽"],
    [/^애니살롱전\s*\d+월\s*:\s*/u, "애니살롱전"],
    [/^금요일밤의\s*동시상영\s*:\s*/u, "동시상영"],
  ];
  for (const [pattern, badge] of prefixes) {
    if (!pattern.test(title)) continue;
    title = title.replace(pattern, "").trim();
    addBadge(badge);
  }

  const suffix = title.match(/^(.*?)\s*\+\s*(시네토크|GV|관객과의\s*대화)(?:\s+.*)?$/iu);
  if (suffix?.[1]) {
    title = suffix[1].trim();
    const label = suffix[2].toUpperCase() === "GV" ? "GV" : suffix[2].replace(/\s+/g, " ");
    addBadge(label);
  }

  return { title: title || original, badges };
}
