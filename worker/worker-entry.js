// Wraps OpenNext's worker to add a `scheduled()` handler — Cloudflare Cron
// Triggers fire scheduled(), not fetch(), and OpenNext doesn't generate one.
// The cron tick self-calls a Next.js route so the cron logic can use Payload's
// local API inside the normal request context.

import openNextHandler from './.open-next/worker.js'

// OpenNext-internal DO classes — re-exported in case they ever get bound.
export {
  DOQueueHandler,
  DOShardedTagCache,
  BucketCachePurge,
} from './.open-next/worker.js'

const CRON_PATH = '/api/cron/check-boundaries'

export default {
  fetch(request, env, ctx) {
    return openNextHandler.fetch(request, env, ctx)
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const url = `https://internal.local${CRON_PATH}`
        const req = new Request(url, {
          method: 'POST',
          headers: { 'x-cron-secret': env.WEBHOOK_SECRET || '' },
        })
        try {
          const res = await openNextHandler.fetch(req, env, ctx)
          if (!res.ok) {
            console.error(JSON.stringify({ level: 'error', msg: 'cron self-call failed', status: res.status }))
          }
        } catch (err) {
          console.error(JSON.stringify({ level: 'error', msg: 'cron self-call threw', err: String(err) }))
        }
      })(),
    )
  },
}
