import type { NextConfig } from "next";
import UnoCSS from '@unocss/webpack'

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.plugins.push(UnoCSS())
    return config
  },
};

export default nextConfig;
