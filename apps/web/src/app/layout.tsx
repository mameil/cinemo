import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://mameil-cinemo.vercel.app");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "cinemo — 독립영화관 상영시간표와 특전 모아보기",
    template: "%s · cinemo",
  },
  description:
    "필름포럼·라이카시네마·에무시네마 등 독립영화관과 CGV·롯데시네마·메가박스의 상영시간표, 포스터·굿즈 특전 정보를 한눈에 확인하세요.",
  keywords: ["독립영화관", "상영시간표", "영화 특전", "영화 포스터", "필름포럼", "라이카시네마", "에무시네마"],
  openGraph: {
    title: "cinemo — 독립영화관 상영시간표와 특전 모아보기",
    description:
      "독립영화관부터 멀티플렉스까지, 오늘의 상영시간표와 포스터·굿즈 특전을 한눈에 확인하세요.",
    siteName: "cinemo",
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "cinemo — 독립영화관 상영시간표와 특전 모아보기",
    description: "독립영화관부터 멀티플렉스까지, 상영시간표와 포스터·굿즈 특전을 한눈에.",
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
