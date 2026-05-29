import type { CollectionConfig } from 'payload'
import { onSlideChange, onSlideDelete } from '../lib/hooks'

export const Slides: CollectionConfig = {
  slug: 'slides',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'type', 'status', 'publishAt', 'expiresAt'],
    description:
      'Custom kiosk slides (image posters and text-message billboards). Prepend to blog/podcast slides in the order shown.',
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
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: 'text',
      options: [
        { label: 'Text message (billboard)', value: 'text' },
        { label: 'Image (edge-to-edge poster)', value: 'image' },
      ],
    },
    {
      name: 'body',
      type: 'textarea',
      admin: {
        condition: (data) => data?.type === 'text',
        description: 'Optional body text shown below the headline. Keep short — kiosk is viewed from across the lobby.',
      },
    },
    {
      name: 'media',
      type: 'upload',
      relationTo: 'media',
      admin: {
        condition: (data) => data?.type === 'image',
        description: 'Portrait image at 1080×1920 looks best. Smaller images are upscaled.',
      },
    },
    {
      name: 'accent',
      type: 'text',
      defaultValue: '#6C63FF',
      admin: {
        description: 'Hex color used for billboard background and dot indicator. Example: #FF4D6D',
      },
    },
    {
      name: 'publishAt',
      type: 'date',
      required: true,
      defaultValue: () => new Date(),
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Slide goes live at or after this time. Defaults to now.',
      },
    },
    {
      name: 'expiresAt',
      type: 'date',
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Optional. Slide disappears after this time.',
      },
    },
    {
      name: 'pinnedOrder',
      type: 'number',
      admin: {
        description: 'Optional manual sort key (lower = first). Leave empty for newest-first.',
      },
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
