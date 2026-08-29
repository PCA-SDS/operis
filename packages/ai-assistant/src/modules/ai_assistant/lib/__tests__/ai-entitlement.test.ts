/** @jest-environment node */
/**
 * The per-tenant AI assistant switch, at the point it is enforced.
 *
 * The toggle is only worth having if a tool actually disappears; these pin the
 * predicate every listing and execution site shares, including the two failure
 * modes that would make it dangerous — narrowing when it should not, and a
 * resolution outage disarming the whole product's AI.
 */
import { isToolAiAllowed, resolveAiDisabledModuleIds } from '../ai-entitlement'
import { getToolRegistry } from '../tool-registry'
import type { McpToolDefinition } from '../types'
import { z } from 'zod'

function registerTool(name: string, moduleId?: string): void {
  const tool = {
    name,
    description: name,
    inputSchema: z.object({}),
    requiredFeatures: [],
    handler: async () => ({}),
  } as unknown as McpToolDefinition
  getToolRegistry().registerTool(tool, moduleId ? { moduleId } : undefined)
}

function makeContainer(rows: unknown): { resolve: (name: string) => unknown } {
  return {
    resolve: (name: string) => {
      if (name !== 'tenantModuleService') throw new Error(`unexpected token ${name}`)
      if (rows instanceof Error) throw rows
      return { getAiDisabledModuleIds: async () => rows }
    },
  }
}

describe('AI assistant entitlement', () => {
  beforeEach(() => {
    getToolRegistry().clear()
  })

  describe('isToolAiAllowed', () => {
    it('drops a tool whose module has its assistant switched off', () => {
      registerTool('customers_search', 'customers')

      expect(isToolAiAllowed('customers_search', new Set(['customers']))).toBe(false)
    })

    it('keeps a tool whose module still has its assistant', () => {
      registerTool('tasks_search', 'tasks')

      expect(isToolAiAllowed('tasks_search', new Set(['customers']))).toBe(true)
    })

    it('keeps a tool that belongs to no module', () => {
      registerTool('context_whoami')

      // Built-ins are not any module's assistant, so no per-module switch
      // governs them.
      expect(isToolAiAllowed('context_whoami', new Set(['customers']))).toBe(true)
    })

    it('keeps everything when nothing is disabled', () => {
      registerTool('customers_search', 'customers')

      expect(isToolAiAllowed('customers_search', new Set())).toBe(true)
      expect(isToolAiAllowed('customers_search', undefined)).toBe(true)
    })
  })

  describe('resolveAiDisabledModuleIds', () => {
    it('returns the modules the service reports as AI-disabled', async () => {
      const container = makeContainer(['customers'])

      const disabled = await resolveAiDisabledModuleIds(container as never, 'tenant-1')

      expect(Array.from(disabled)).toEqual(['customers'])
    })

    it('narrows nothing without a tenant', async () => {
      const container = makeContainer(['customers'])

      await expect(resolveAiDisabledModuleIds(container as never, null)).resolves.toEqual(new Set())
    })

    it('narrows nothing when resolution fails', async () => {
      const container = makeContainer(new Error('directory unavailable'))

      // Fail-open is deliberate here and only here: this switch removes an
      // affordance inside a module the tenant keeps, so an outage in the
      // directory service must not silently disarm every AI tool in the
      // product. Entitlement itself stays fail-closed upstream in RbacService.
      await expect(resolveAiDisabledModuleIds(container as never, 'tenant-1')).resolves.toEqual(new Set())
    })
  })
})
