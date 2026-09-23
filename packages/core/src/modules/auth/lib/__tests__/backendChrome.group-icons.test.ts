/** @jest-environment node */

// Group headings carry an icon so the collapsed rail shows a marker where each heading stands.
// Known group ids get their declared icon; anything else ships without one and the client falls
// back to the generic group icon, so no heading is ever blank.

const mockGetNavGroupOrderOverride = jest.fn<readonly string[] | null, []>()

jest.mock('@open-mercato/shared/modules/overrides', () => ({
  getNavGroupOrderOverride: () => mockGetNavGroupOrderOverride(),
}))

const mockFindOneWithDecryption = jest.fn(async () => null)
const mockBuildAdminNav = jest.fn()

const mockEm = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) }
const mockRbacService = {
  loadAcl: jest.fn(async () => ({ isSuperAdmin: true, features: ['*'] })),
  getEffectiveFeatures: jest.fn(async () => ['*']),
  userHasAllFeatures: jest.fn(async () => true),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'em') return mockEm
      if (token === 'rbacService') return mockRbacService
      return null
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...(args as [])),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: jest.fn(async () => ({
    organizationId: null,
    scope: { tenantId: 'tenant-1', organizationId: null },
    allowedOrganizationIds: ['org-1'],
  })),
  getSelectedOrganizationFromRequest: jest.fn(() => null),
}))

jest.mock('@open-mercato/core/modules/directory/constants', () => ({
  isAllOrganizationsSelection: () => true,
}))

// Spread the real module rather than enumerating its exports: these suites
// assert navigation shape, and a partial mock breaks every time the payload
// starts reading one more thing from the registry.
jest.mock('@open-mercato/shared/security/enabledModulesRegistry', () => ({
  ...jest.requireActual('@open-mercato/shared/security/enabledModulesRegistry'),
  filterGrantsByEnabledModules: (grants: string[]) => grants,
  getEnabledModuleIds: () => ['auth', 'directory', 'customers'],
  hasEnabledModulesRegistry: () => true,
}))

const mockConvertToSectionNavGroups = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/nav', () => ({
  buildAdminNav: (...args: unknown[]) => mockBuildAdminNav(...(args as [])),
  buildSettingsSections: jest.fn(() => []),
  computeSettingsPathPrefixes: jest.fn(() => []),
  convertToSectionNavGroups: (...args: unknown[]) => mockConvertToSectionNavGroups(...(args as [])),
}))

jest.mock('@open-mercato/ui/backend/icons/lucideRegistry', () => ({
  resolveRegisteredLucideIconNode: jest.fn(() => null),
}))

jest.mock('../profile-sections', () => ({ profileSections: [], profilePathPrefixes: [] }))

jest.mock('@open-mercato/core/modules/auth/services/sidebarPreferencesService', () => ({
  applySidebarPreference: (groups: unknown) => groups,
  loadFirstRoleSidebarPreference: jest.fn(async () => null),
  findSidebarPreference: jest.fn(async () => null),
}))

import { resolveBackendChromePayload } from '../backendChrome'

function navEntry(groupId: string) {
  return {
    href: `/backend/${groupId}`,
    title: groupId,
    defaultTitle: groupId,
    groupId,
    group: groupId,
    groupDefaultName: groupId,
    priority: 10,
  }
}

async function resolvePayload() {
  return resolveBackendChromePayload({
    auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: null, roles: [] } as never,
    locale: 'en',
    modules: [],
    translate: (_key: string | undefined, fallback: string) => fallback,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetNavGroupOrderOverride.mockReturnValue(null)
  mockBuildAdminNav.mockResolvedValue([navEntry('customers.nav.group'), navEntry('zulu.app.nav.group')])
  mockConvertToSectionNavGroups.mockReturnValue([
    { id: 'settings.sections.system', label: 'System', items: [] },
    { id: 'zulu.app.settings', label: 'Zulu', items: [] },
  ])
})

describe('sidebar group icons', () => {
  it('attaches the declared icon to a known main-nav group', async () => {
    const payload = await resolvePayload()
    const customers = payload.groups.find((group) => group.id === 'customers.nav.group')
    expect(customers?.iconName).toBe('users')
  })

  it('leaves an undeclared group without an icon so the client fallback applies', async () => {
    const payload = await resolvePayload()
    const zulu = payload.groups.find((group) => group.id === 'zulu.app.nav.group')
    expect(zulu).toBeDefined()
    expect(zulu?.iconName).toBeUndefined()
    expect(zulu?.iconMarkup).toBeUndefined()
  })

  it('attaches icons to settings sections by the same ids', async () => {
    const payload = await resolvePayload()
    expect(payload.settingsSections.map((section) => [section.id, section.iconName])).toEqual([
      ['settings.sections.system', 'settings'],
      ['zulu.app.settings', undefined],
    ])
  })
})
