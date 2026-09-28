/**
 * Product surfaces withheld from the current release.
 *
 * These are build-level product decisions, not permissions, and ACL cannot
 * express them. The `admin` role is granted the `customers.*` wildcard in
 * `packages/core/src/modules/customers/setup.ts`, and `matchFeature` resolves
 * any `customers.deals.*` check against it, so revoking a grant withholds a
 * surface from `employee` and leaves it in place for every administrator.
 *
 * Page routes are withheld in `apps/mercato/src/modules.ts` through
 * `overrides.routes.pages`, which drops them from the route manifest and the
 * sidebar together. The flags here cover what survives inside the pages that
 * stay: sections, links and columns that point at a withheld route. Flip one
 * to `true` and its surface returns.
 */

/** Deals, the sales pipeline, and every affordance pointing at `/backend/customers/deals/*`. */
export const DEALS_IN_PRODUCT = false

/** The cross-customer task roll-up at `/backend/customer-tasks`. */
export const CUSTOMER_TASKS_IN_PRODUCT = false

/**
 * The Custom attributes section on people and companies: the create forms, the
 * add-person dialog and both detail pages. Only the section is withheld; the
 * field definitions and any stored values stay, and an edit saves stored values
 * back unchanged. A custom field marked required while this is off would still
 * be validated, with nowhere on the form to fill it in.
 */
export const CUSTOMER_CUSTOM_ATTRIBUTES_IN_PRODUCT = false
