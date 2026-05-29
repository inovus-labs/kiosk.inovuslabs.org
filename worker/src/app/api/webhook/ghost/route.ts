import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { fireRepositoryDispatch, type DispatchEnv } from '../../../../lib/github-dispatch'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return new NextResponse('ok', { status: 200 })
}

export async function POST(request: Request): Promise<Response> {
  const { env } = getCloudflareContext()
  const dispatchEnv = env as unknown as DispatchEnv & { WEBHOOK_SECRET: string }

  const url = new URL(request.url)
  if (url.searchParams.get('token') !== dispatchEnv.WEBHOOK_SECRET) {
    return new NextResponse('forbidden', { status: 403 })
  }

  const ghostEvent = request.headers.get('X-Ghost-Event') || 'unknown'

  const ghRes = await fireRepositoryDispatch(dispatchEnv, { ghost_event: ghostEvent })

  if (!ghRes.ok) {
    const detail = await ghRes.text().catch(() => '')
    return new NextResponse(
      `github dispatch failed: ${ghRes.status} ${detail.slice(0, 200)}`,
      { status: 502 },
    )
  }

  return new NextResponse(null, { status: 204 })
}
