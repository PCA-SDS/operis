type ModuleLike = { id: string }

export type HomeQuickLink = {
  href: string
  translationKey: string
  fallbackLabel: string
}

const BASE_LINKS: HomeQuickLink[] = [
  { href: '/login', translationKey: 'app.page.quickLinks.login', fallbackLabel: 'Login' },
]

/**
 * Quick links for the starter page, filtered to the modules this build
 * registers.
 *
 * `modules` is the deploy-level registry, which is the right signal here: the
 * page is unauthenticated, so there is no tenant whose entitlement could be
 * consulted. Any link added to a module-owned surface belongs in a
 * `MODULE_LINKS` entry keyed by its module id, never in `BASE_LINKS` — that is
 * what keeps the page from advertising a module the build does not ship.
 */
const MODULE_LINKS: Record<string, HomeQuickLink[]> = {}

export function buildHomeQuickLinks(modules: readonly ModuleLike[]): HomeQuickLink[] {
  const registered = new Set(modules.map((module) => module.id))
  const moduleLinks = Object.entries(MODULE_LINKS)
    .filter(([moduleId]) => registered.has(moduleId))
    .flatMap(([, links]) => links)

  return [...BASE_LINKS, ...moduleLinks]
}
