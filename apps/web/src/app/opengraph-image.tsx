import { ImageResponse } from "next/og";

export const alt = "cinemo 독립영화관 상영시간표와 영화 특전 모아보기";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "76px 84px",
          background: "linear-gradient(135deg, #0e1215 0%, #10201d 55%, #10332e 100%)",
          color: "#e8ecef",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 18, height: 18, borderRadius: 999, background: "#2dd4bf" }} />
          <span style={{ color: "#2dd4bf", fontSize: 34, fontWeight: 800, letterSpacing: 7 }}>CINEMO</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 67, fontWeight: 800, lineHeight: 1.18 }}>
            독립영화관부터 멀티플렉스까지
          </div>
          <div style={{ display: "flex", fontSize: 38, color: "#a9b3bc" }}>
            상영시간표 · 포스터 · 굿즈 특전을 한눈에
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 24, color: "#76828e" }}>
          <span>필름포럼</span><span>·</span><span>라이카시네마</span><span>·</span><span>에무시네마</span><span>·</span><span>아트나인</span>
        </div>
      </div>
    ),
    size,
  );
}
