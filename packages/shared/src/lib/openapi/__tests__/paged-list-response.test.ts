import { z } from 'zod'
import { createOptionalMetaPagedListResponseSchema, createPagedListResponseSchema } from '../crud'

const itemSchema = z.object({ id: z.string() })

describe('paged list response schemas', () => {
  it('requires page and pageSize by default', () => {
    const schema = createPagedListResponseSchema(itemSchema)
    expect(schema.safeParse({ items: [], total: 0, totalPages: 0 }).success).toBe(false)
    expect(schema.safeParse({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }).success).toBe(true)
  })

  it('builds the optional-meta envelope exactly like paginationMetaOptional: true', () => {
    const preset = createOptionalMetaPagedListResponseSchema(itemSchema)
    const explicit = createPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })

    expect(Object.keys(preset.shape)).toEqual(Object.keys(explicit.shape))
    for (const key of Object.keys(explicit.shape) as Array<keyof typeof explicit.shape>) {
      expect(preset.shape[key].isOptional()).toBe(explicit.shape[key].isOptional())
    }
    expect(preset.safeParse({ items: [{ id: 'a' }], total: 1, totalPages: 1 }).success).toBe(true)
    expect(preset.safeParse({ items: [{ id: 1 }], total: 1, totalPages: 1 }).success).toBe(false)
  })
})
