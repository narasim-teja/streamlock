/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@streamlock/common',
    '@streamlock/crypto',
    '@streamlock/aptos',
    '@streamlock/creator-sdk',
    '@streamlock/viewer-sdk',
  ],
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'fluent-ffmpeg'],
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
    };
    return config;
  },
};

export default nextConfig;
