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
      '**/next/dist/compiled/babel/**',
    ],
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
