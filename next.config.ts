import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Server external packages so pg or pglite can be bundled or run without issues
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
};

export default nextConfig;
