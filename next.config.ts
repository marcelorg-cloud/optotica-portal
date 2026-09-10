import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ['qrcode'],
  turbopack: {
    // @techstark/opencv-js (usado só no navegador, pela ferramenta "Medir com
    // foto") tem um require("fs")/require("crypto") dentro de um branch que só
    // roda em Node — nunca no navegador —, mas o Turbopack ainda precisa
    // resolver esses módulos em tempo de build. Aponta para um shim vazio só
    // na condição "browser" (equivalente ao antigo
    // `resolve.fallback: { fs: false, ... }` do webpack) — o bundle do
    // servidor continua usando os módulos reais do Node normalmente.
    resolveAlias: {
      fs: { browser: './lib/node-shims/empty.js' },
      crypto: { browser: './lib/node-shims/empty.js' },
      path: { browser: './lib/node-shims/empty.js' }
    }
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' }
        ]
      }
    ];
  }
};

export default nextConfig;
