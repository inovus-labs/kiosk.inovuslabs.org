import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite'
import { r2Storage } from '@payloadcms/storage-r2'
import { buildConfig } from 'payload'
import { CloudflareContext, getCloudflareContext } from '@opennextjs/cloudflare'
import { GetPlatformProxyOptions } from 'wrangler'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Slides } from './collections/Slides'
import { migrations } from './migrations'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const isProduction = process.env.NODE_ENV === 'production'

const realpath = (v: string) => (fs.existsSync(v) ? fs.realpathSync(v) : v)
const isCLI = process.argv.some((v) => realpath(v ?? '').endsWith(path.join('payload', 'bin.js')))

// Remote bindings need an authenticated wrangler session, which CI does not have.
const isBuild =
  process.env.CF_LOCAL_BINDINGS === 'true' || process.env.NEXT_PHASE === 'phase-production-build'

const cloudflare =
  isCLI || isBuild || !isProduction
    ? await getCloudflareContextFromWrangler(isCLI && isProduction)
    : await getCloudflareContext({ async: true })

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: dirname },
  },
  collections: [Users, Media, Slides],
  graphQL: { disable: true },
  telemetry: false,
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: sqliteD1Adapter({ binding: cloudflare.env.D1, prodMigrations: migrations }),
  plugins: [
    r2Storage({
      bucket: cloudflare.env.R2,
      collections: {
        media: {
          disablePayloadAccessControl: true,
          generateFileURL: ({ filename, prefix }) =>
            `${process.env.R2_PUBLIC_URL ?? ''}/${prefix ? `${prefix}/` : ''}${filename}`,
        },
      },
    }),
  ],
})

function getCloudflareContextFromWrangler(remoteBindings: boolean): Promise<CloudflareContext> {
  return import(/* webpackIgnore: true */ `${'__wrangler'.replaceAll('_', '')}`).then(
    ({ getPlatformProxy }) =>
      getPlatformProxy({
        environment: process.env.CLOUDFLARE_ENV,
        remoteBindings,
      } satisfies GetPlatformProxyOptions),
  )
}
