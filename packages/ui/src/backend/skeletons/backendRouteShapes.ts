import type { BackendLoadingSkeleton, ModuleRouteMetadata } from '@open-mercato/shared/modules/registry'

/**
 * What the backend's route-level loading state knows about a route before the
 * server has matched it: whether the page sits beside its module's sidebar,
 * the skeleton it declared, and, for a page no nav link leads to, the module
 * and parent link that place it. The layout builds these from the route
 * metadata it already reads, most specific pattern first, so the loading state
 * frames and fills the page the way the page itself will.
 */
export type BackendRouteShape = {
  pattern: string
  moduleSidebar?: false
  skeleton?: BackendLoadingSkeleton
  group?: string
  parentHref?: string
}

function segments(path: string): string[] {
  const clean = (path.split(/[?#]/)[0] ?? '').replace(/\/+$/, '')
  return clean.split('/').filter(Boolean)
}

/** The server's route matching (`matchRoutePattern`), reduced to a yes or no. */
export function matchesRoutePattern(pattern: string, pathname: string): boolean {
  const patternSegments = segments(pattern)
  const pathSegments = segments(pathname)
  for (let index = 0; index < patternSegments.length; index++) {
    const segment = patternSegments[index]!
    if (segment.startsWith('[[...')) return true
    if (segment.startsWith('[...')) return index < pathSegments.length
    if (index >= pathSegments.length) return false
    if (segment.startsWith('[')) continue
    if (segment.toLowerCase() !== pathSegments[index]!.toLowerCase()) return false
  }
  return patternSegments.length === pathSegments.length
}

/** The first shape whose pattern matches; the layout sorts them most specific first. */
export function resolveBackendRouteShape(
  shapes: readonly BackendRouteShape[],
  pathname: string,
): BackendRouteShape | null {
  return shapes.find((shape) => matchesRoutePattern(shape.pattern, pathname)) ?? null
}

/**
 * Whether a shape tells the loading state anything beyond the defaults (a
 * module sidebar, no skeleton, a module found from the URL).
 */
function isInformative(shape: BackendRouteShape): boolean {
  return Boolean(shape.moduleSidebar === false || shape.skeleton || shape.group || shape.parentHref)
}

/**
 * Drops the shapes that carry nothing, except where one is needed to stop a
 * broader pattern after it from claiming its URLs: without `/people/create`,
 * `/people/[id]` would match the create page and draw a record there.
 */
function compactBackendRouteShapes(shapes: readonly BackendRouteShape[]): BackendRouteShape[] {
  return shapes.filter((shape, index) =>
    isInformative(shape)
    || shapes.slice(index + 1).some((later) => isInformative(later) && matchesRoutePattern(later.pattern, shape.pattern)),
  )
}

export type BackendRouteShapeSource = Pick<
  ModuleRouteMetadata,
  'pattern' | 'path' | 'moduleSidebar' | 'loadingSkeleton' | 'navHidden' | 'group' | 'groupKey' | 'breadcrumb'
>

/**
 * The shapes for a list of routes sorted most specific first. A page that a
 * nav link leads to is placed in its module by that link, so only hidden and
 * parameterised pages carry their module and parent link, exactly as the
 * catch-all hands them to `BackendModuleFrame`.
 */
export function buildBackendRouteShapes(routes: readonly BackendRouteShapeSource[]): BackendRouteShape[] {
  const shapes = routes.flatMap((route): BackendRouteShape[] => {
    const pattern = route.pattern ?? route.path
    if (!pattern) return []
    const shape: BackendRouteShape = { pattern }
    if (route.moduleSidebar === false) shape.moduleSidebar = false
    if (route.loadingSkeleton) shape.skeleton = route.loadingSkeleton
    if (route.navHidden || pattern.includes('[')) {
      const group = route.groupKey ?? route.group
      if (group) shape.group = group
      const parentHref = [...(route.breadcrumb ?? [])].reverse().find((item) => item.href)?.href
      if (parentHref) shape.parentHref = parentHref
    }
    return [shape]
  })
  return compactBackendRouteShapes(shapes)
}
