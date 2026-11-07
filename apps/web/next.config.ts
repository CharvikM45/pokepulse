import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: [
    "@pokepulse/contracts",
    "@pokepulse/domain",
    "@pokepulse/fixtures",
    "@pokepulse/ui",
  ],
};
export default config;
