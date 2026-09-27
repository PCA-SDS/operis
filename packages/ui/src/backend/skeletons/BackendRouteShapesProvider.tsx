"use client"

import * as React from 'react'
import { resolveBackendRouteShape, type BackendRouteShape } from './backendRouteShapes'

const BackendRouteShapesContext = React.createContext<readonly BackendRouteShape[]>([])

export function BackendRouteShapesProvider({
  shapes,
  children,
}: {
  shapes: readonly BackendRouteShape[]
  children: React.ReactNode
}) {
  return <BackendRouteShapesContext.Provider value={shapes}>{children}</BackendRouteShapesContext.Provider>
}

export function useBackendRouteShape(pathname: string): BackendRouteShape | null {
  const shapes = React.useContext(BackendRouteShapesContext)
  return React.useMemo(() => resolveBackendRouteShape(shapes, pathname), [shapes, pathname])
}
