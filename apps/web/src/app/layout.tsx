import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "cinemo — 상영시간표 + 특전 모아보기",
  description:
    "CGV · 롯데시네마 · 메가박스 상영시간표와 특전/굿즈 소진현황을 한눈에",
  openGraph: {
    title: "cinemo — 상영시간표 + 특전 모아보기",
    description:
      "CGV · 롯데시네마 · 메가박스 상영시간표와 특전/굿즈 소진현황을 한눈에",
    siteName: "cinemo",
    locale: "ko_KR",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="bg-ground text-ink">{children}</body>
    </html>
  );
}
