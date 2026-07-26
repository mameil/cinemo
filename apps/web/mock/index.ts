/**
 * 프론트엔드 목업 데이터 진입점
 *
 * 실제 조회 API가 붙기 전, 화면 개발/디자인 논의용 고정 데이터.
 * 계획서: docs/frontend-tasks.md · 스키마: packages/shared/src/schema.ts
 * 값은 실제 Turso DB(2026-07-12 스냅샷)에서 추출.
 */
export * from "./types";
export { MOCK_REGIONS, DEFAULT_REGION_ID } from "./regions";
export { MOCK_HOME_TIMETABLE } from "./home-timetable";
export { MOCK_MOVIE_DETAIL } from "./movie-detail";
