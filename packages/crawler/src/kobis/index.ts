import {
  fetchMovieList,
  fetchMovieInfo,
  fetchDailyBoxOffice,
  filterUpcoming,
  formatOpenDt,
} from "./api";

/** 오늘 날짜를 YYYYMMDD 로 반환 */
function todayYmd(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

async function main() {
  console.log("=== KOBIS 크롤러 시작 ===\n");

  const today = todayYmd();
  const year = today.slice(0, 4);

  // 1. 올해 개봉작 목록
  console.log(`--- ${year}년 영화 목록 ---`);
  const movieList = await fetchMovieList({
    openStartDt: year,
    openEndDt: year,
    itemPerPage: 100,
    curPage: 1,
  });
  console.log(`총 ${movieList.totCnt}개 (1페이지 ${movieList.list.length}건)\n`);

  // 2. 개봉 예정작만 추출
  const upcoming = filterUpcoming(movieList.list, today);
  console.log(`--- 개봉 예정작 (${today} 이후) ${upcoming.length}건 ---`);
  for (const m of upcoming.slice(0, 10)) {
    const director = m.directors.map((d) => d.peopleNm).join(", ") || "미정";
    console.log(`[${m.movieCd}] ${m.movieNm} (${formatOpenDt(m.openDt)})`);
    console.log(`  ${m.repNationNm} · ${m.repGenreNm} · 감독: ${director}`);
  }
  console.log();

  // 3. 첫 개봉 예정작 상세
  const target = upcoming[0] ?? movieList.list[0];
  if (target) {
    console.log(`--- 영화 상세: ${target.movieNm} ---`);
    const info = await fetchMovieInfo(target.movieCd);
    const grade = info.audits.map((a) => a.watchGradeNm).join(", ") || "미정";
    const cast = info.actors.slice(0, 5).map((a) => a.peopleNm).join(", ") || "미정";
    console.log(`  원제: ${info.movieNmOg || "-"} / 영문: ${info.movieNmEn || "-"}`);
    console.log(`  상영시간: ${info.showTm || "-"}분 · 등급: ${grade}`);
    console.log(`  장르: ${info.genres.map((g) => g.genreNm).join(", ")}`);
    console.log(`  주연: ${cast}`);
    console.log();
  }

  // 4. 최근 일별 박스오피스 (전일 기준)
  const yesterday = new Date(Date.now() - 86400000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
  console.log(`--- 일별 박스오피스 (${formatOpenDt(yesterday)}) ---`);
  const boxOffice = await fetchDailyBoxOffice(yesterday);
  for (const b of boxOffice.slice(0, 10)) {
    const tag = b.rankOldAndNew === "NEW" ? " 🆕" : "";
    console.log(
      `  ${b.rank}위 ${b.movieNm}${tag} — 관객 ${Number(b.audiCnt).toLocaleString()}명 (누적 ${Number(b.audiAcc).toLocaleString()})`
    );
  }

  console.log("\n=== KOBIS 크롤러 완료 ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
