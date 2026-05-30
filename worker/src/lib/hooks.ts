import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { fireRepositoryDispatch, type DispatchEnv } from './github-dispatch'

type SlideDoc = {
  status?: 'draft' | 'published'
  publishAt?: string | Date
  title?: string
}

function shouldFireOnChange(doc: SlideDoc, previousDoc?: SlideDoc): boolean {
  if (doc.status === 'draft' && previousDoc?.status !== 'published') return false

  // Skip if publishAt is in the future: the cron handler fires the build at the
  // boundary, so dispatching now would just produce a build that omits this slide.
  if (doc.status === 'published' && doc.publishAt) {
    const publishMs = new Date(doc.publishAt).getTime()
    if (publishMs > Date.now() + 60_000) return false
  }

  return true
}

async function dispatch(eventDetail: string, title?: string): Promise<void> {
  const { env } = getCloudflareContext()
  const dispatchEnv = env as unknown as DispatchEnv & { CMS_DISPATCH_EVENT_TYPE: string }
  await fireRepositoryDispatch(dispatchEnv, dispatchEnv.CMS_DISPATCH_EVENT_TYPE, {
    source: 'payload',
    event: eventDetail,
    title,
  })
}

export const onSlideChange: CollectionAfterChangeHook = async ({ doc, previousDoc, operation }) => {
  if (!shouldFireOnChange(doc as SlideDoc, previousDoc as SlideDoc)) return doc
  await dispatch(`slide.${operation}`, (doc as SlideDoc).title)
  return doc
}

export const onSlideDelete: CollectionAfterDeleteHook = async ({ doc }) => {
  if ((doc as SlideDoc).status !== 'published') return doc
  await dispatch('slide.delete', (doc as SlideDoc).title)
  return doc
}
