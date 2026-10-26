import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  outputFileTracingRoot: resolve(WEB_ROOT, "../.."),
  outputFileTracingIncludes: {
    "/*": [
      "collectors/instagram/instagram_collector.py",
      "collectors/instagram/config.example.json",
      "collectors/instagram/requirements.txt",
      "vendor/instagram-instagrapi/**/*"
    ]
  },
  outputFileTracingExcludes: {
    "/*": [
      "next.config.ts",
      "next.config.js",
      "apps/web/next.config.ts",
      ".venv-instagram/**/*",
      ".instagram/**/*",
      "**/__pycache__/**/*",
      "**/*.tsbuildinfo"
    ]
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" }
        ]
      }
    ];
  }
};

export default nextConfig;
