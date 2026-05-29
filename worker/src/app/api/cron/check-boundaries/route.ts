import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { hasBoundaryCrossed } from '../../../../lib/boundary'
import { fireRepositoryDispatch, type DispatchEnv } from '../../../../lib/github-dispatch'

export const dynamic = 'force-dynamic'

// Hourly cron + 5 min grace for jitter / clock skew.
const WINDOW_MS = 65 * 60_000

export async function POST(request: Request): Promise<Response> {
  const { env } = getCloudflareContext()
  const dispatchEnv = env as unknown as DispatchEnv & { WEBHOOK_SECRET: string }

  if (request.headers.get('x-cron-secret') !== dispatchEnv.WEBHOOK_SECRET) {
    return new NextResponse('forbidden', { status: 403 })
  }

  const now = Date.now()
  const since = now - WINDOW_MS

  const crossed = await hasBoundaryCrossed(since, now)
  if (!crossed) {
    return NextResponse.json({ ok: true, dispatched: false })
  }

  const ghRes = await fireRepositoryDispatch(dispatchEnv, { source: 'cron-boundary' })
  if (!ghRes.ok) {
    const detail = await ghRes.text().catch(() => '')
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'cron dispatch failed',
        status: ghRes.status,
        detail: detail.slice(0, 200),
      }),
    )
    return NextResponse.json({ ok: false, status: ghRes.status }, { status: 502 })
  }

  return NextResponse.json({ ok: true, dispatched: true })
}
