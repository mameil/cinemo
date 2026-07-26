import { config } from "dotenv";
import { resolve } from "path";
import type { NextConfig } from "next";

// 모노레포 루트 .env 로드
config({ path: resolve(__dirname, "../../.env") });

const nextConfig: NextConfig = {
  env: {
    // 빌드(=배포) 시점에 구워지는 값 — 홈 푸터의 "최근 배포" 표기용
    NEXT_PUBLIC_BUILD_AT: new Date().toISOString(),
    NEXT_PUBLIC_COMMIT: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org" },
    ],
  },
};

export default nextConfig;
