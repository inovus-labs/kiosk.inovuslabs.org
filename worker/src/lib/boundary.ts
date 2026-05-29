import { getPayload } from 'payload'
import config from '@payload-config'

export async function hasBoundaryCrossed(sinceMs: number, nowMs: number): Promise<boolean> {
  const payload = await getPayload({ config })
  const sinceIso = new Date(sinceMs).toISOString()
  const nowIso = new Date(nowMs).toISOString()

  const result = await payload.find({
    collection: 'slides',
    limit: 1,
    depth: 0,
    pagination: false,
    where: {
      and: [
        { status: { equals: 'published' } },
        {
          or: [
            {
              and: [
                { publishAt: { greater_than: sinceIso } },
                { publishAt: { less_than_equal: nowIso } },
              ],
            },
            {
              and: [
                { expiresAt: { greater_than: sinceIso } },
                { expiresAt: { less_than_equal: nowIso } },
              ],
            },
          ],
        },
      ],
    },
  })

  return result.docs.length > 0
}
