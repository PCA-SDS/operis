"use client"

import * as React from 'react'
import type { SectionNavGroup } from '../section-page/types'
import type { NavGroup } from './model'

export type BackendNavigationMode = 'main' | 'settings' | 'profile'

/**
 * The shell's resolved navigation, published once so the module switcher in
 * the topbar and the module sidebar beside the page read the same model.
 *
 * Everything here is already RBAC- and entitlement-filtered by the server
 * (`/api/auth/admin/nav`); nothing that reads it decides access. The page
 * routes still enforce their own guards.
 */
export type BackendNavigation = {
  isReady: boolean
  mode: BackendNavigationMode
  moduleGroups: NavGroup[]
  activeGroup: NavGroup | null
  settings: { title: string; sections: SectionNavGroup[] }
  profile: { title: string; sections: SectionNavGroup[] }
  /**
   * The current route's declared nav group (`pageGroupKey`), published by the
   * page frame. It decides the active module only when the URL sits under no
   * nav link — a hidden detail route such as `/…/people-v2/[id]`.
   */
  setRouteGroupHint: (groupId: string | null) => void
}

const BackendNavigationContext = React.createContext<BackendNavigation | null>(null)

export function BackendNavigationProvider({
  value,
  children,
}: {
  value: BackendNavigation
  children: React.ReactNode
}) {
  return <BackendNavigationContext.Provider value={value}>{children}</BackendNavigationContext.Provider>
}

export function useBackendNavigation(): BackendNavigation | null {
  return React.useContext(BackendNavigationContext)
}
