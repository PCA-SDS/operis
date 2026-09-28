import { getCurrentOrganizationScope } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { parseSelectedOrganizationCookie } from '@open-mercato/core/modules/directory/utils/scopeCookies'
import { isAllOrganizationsSelection } from '@open-mercato/core/modules/directory/constants'

export function hasActiveOrganizationSelection(): boolean {
  const fromEvent = getCurrentOrganizationScope().organizationId
  if (typeof fromEvent === 'string' && fromEvent.trim().length > 0) return true

  const cookieHeader = typeof document === 'undefined' ? null : document.cookie
  const cookieValue = parseSelectedOrganizationCookie(cookieHeader)
  if (!cookieValue) return false
  return !isAllOrganizationsSelection(cookieValue);
}
