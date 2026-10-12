/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  distDir: 'out',
  trailingSlash: true,
  /* Relative, not absolute. The app is loaded from a file:// URL, where an
     absolute /_next/... path resolves against the filesystem root and fails —
     which is what made the router prefetch error intermittently. One route, so
     a document-relative base is always correct. */
  assetPrefix: './',
  basePath: '',
}

module.exports = nextConfig
