import type { CollectionConfig } from 'payload'
import { onSlideChange, onSlideDelete } from '../lib/hooks'

export const Slides: CollectionConfig = {
  slug: 'slides',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'type', 'status', 'publishAt', 'expiresAt', 'pinnedOrder'],
  },
  access: {
    read: ({ req }) => {
      if (req.user) return true
      const nowPlus90s = new Date(Date.now() + 90_000).toISOString()
      const nowIso = new Date().toISOString()
      return {
        and: [
          { status: { equals: 'published' } },
          { publishAt: { less_than_equal: nowPlus90s } },
          {
            or: [
              { expiresAt: { exists: false } },
              { expiresAt: { greater_than: nowIso } },
            ],
          },
        ],
      }
    },
    create: ({ req }) => !!req.user,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => !!req.user,
  },
  hooks: {
    afterChange: [onSlideChange],
    afterDelete: [onSlideDelete],
  },
  fields: [
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: 'text',
      options: [
        { label: 'Text', value: 'text' },
        { label: 'Image', value: 'image' },
      ],
    },
    {
      name: 'title',
      type: 'text',
      admin: { condition: (data) => data?.type === 'text' },
    },
    {
      name: 'body',
      type: 'textarea',
      admin: { condition: (data) => data?.type === 'text' },
    },
    {
      name: 'media',
      type: 'upload',
      relationTo: 'media',
      admin: { condition: (data) => data?.type === 'image' },
    },
    {
      name: 'publishAt',
      type: 'date',
      required: true,
      defaultValue: () => new Date(),
      admin: { date: { pickerAppearance: 'dayAndTime' } },
    },
    {
      name: 'expiresAt',
      type: 'date',
      admin: { date: { pickerAppearance: 'dayAndTime' } },
    },
    {
      name: 'pinnedOrder',
      type: 'number',
      admin: { description: 'Lower = shown first. Leave empty for newest-first.' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
      ],
    },
    {
      name: 'createdByName',
      type: 'text',
      admin: { readOnly: true, position: 'sidebar' },
      hooks: {
        beforeChange: [
          ({ req, value, operation }) => {
            if (operation === 'create' && req.user) {
              return (req.user as { name?: string; email?: string }).name || req.user.email
            }
            return value
          },
        ],
      },
    },
  ],
}
