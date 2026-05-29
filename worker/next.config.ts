import { withPayload } from '@payloadcms/next/withPayload'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

initOpenNextCloudflareForDev()

const nextConfig = {
  images: {
    localPatterns: [{ pathname: '/api/media/file/**' }],
  },
  serverExternalPackages: ['jose'],
  outputFileTracingExcludes: {
    '*': [
      '**/next/dist/compiled/@vercel/og/**',
      '**/next/dist/compiled/sharp/**',
      '**/node_modules/sharp/**',
      '**/next/dist/compiled/babel/**',
      '**/next/dist/compiled/babel-packages/**',
      '**/next/dist/compiled/terser/**',
      '**/next/dist/compiled/postcss/**',
      '**/next/dist/compiled/@swc/**',
      '**/node_modules/@swc/**',
      '**/next/dist/compiled/@opentelemetry/**',
      '**/next/dist/compiled/eslint-rule-tester/**',
      '**/next/dist/compiled/web-vitals-attribution/**',
      '**/next/dist/compiled/web-vitals/**',
      '**/next/dist/compiled/jsonwebtoken/**',
      '**/next/dist/compiled/@edge-runtime/cookies/**',
    ],
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
