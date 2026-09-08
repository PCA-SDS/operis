# SPEC: Resource Area Types — User-Defined Area Classification

## Status

- [ ] Approved
- [ ] In Progress
- [ ] Implemented

## Overview

Transform `area_type` from a hardcoded text enum into a first-class user-managed entity `ResourcesResourceAreaType`, mirroring the existing `ResourcesResourceType` pattern. This allows users to create custom area type labels (e.g., "Parking Lot", "Outdoor Court", "Lab") with custom icons/colors instead of being limited to the fixed set: campus, building, floor, zone, room, section, other.

---

## Context & Problem

Currently, `ResourcesResourceArea.areaType` is a plain `text` column with a hardcoded default of `'other'`. The UI renders it as uppercase labels via a static translation map, but the API accepts any non-empty string — an inconsistency where the DB is open but the UI is closed.

**Problems:**
- Users cannot add custom area types (e.g., "Parking Lot", "Outdoor Court", "Lab")
- Type list is baked into code — requires a code change to add/rename
- No icon/color customization for area type classification
- No RBAC gating on "who can manage area types"

**Reference:** `ResourcesResourceType` is the canonical CRUD reference for this module. The `area_type` pattern should follow it exactly.

---

## Design

### Data Model

Replace `area_type text` with a FK reference to a new `ResourcesResourceAreaType` entity:

```typescript
// ResourcesResourceArea entity change
@Property({ name: 'area_type_id', type: 'uuid', nullable: true })
areaTypeId?: string | null  // FK to ResourcesResourceAreaType.id

// Drop: @Property({ name: 'area_type', type: 'text', default: 'other' })
```

**New entity: `ResourcesResourceAreaType`**

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | gen_random_uuid() |
| tenant_id | uuid | Required |
| organization_id | uuid | Required |
| name | text | Required |
| description | text nullable | Optional |
| appearance_icon | text nullable | Emoji or icon name |
| appearance_color | text nullable | Hex color `#RRGGBB` |
| is_active | boolean | default: true |
| created_at | timestamptz | Auto |
| updated_at | timestamptz | Auto |
| deleted_at | timestamptz | Soft delete |

**Existing entity: `ResourcesResourceArea`**
- Remove `areaType: string` column (migration drops it)
- Add `areaTypeId?: string | null` FK column
- Keep `parent_area_id` (hierarchical areas remain)
- Keep all other fields unchanged

### API Design

**New endpoint: `/api/resources/area-types`**

| Method | Auth | Feature | Description |
|--------|------|---------|-------------|
| GET | requireAuth | resources.view | List area types (paged, searchable) |
| POST | requireAuth | resources.manage_resources | Create area type |
| PUT | requireAuth | resources.manage_resources | Update area type |
| DELETE | requireAuth | resources.manage_resources | Delete area type |

Query params for GET: `page`, `pageSize`, `search`, `ids`, `sortField`, `sortDir`, `withAreaCounts`

Response shape: `{ items: [...], total, totalPages }` — same as resource-types.

### ACL Features

Add to `acl.ts`:

```typescript
{ id: 'resources.area_types.manage', title: 'Manage area types', dependsOn: ['resources.areas.view'] }
```

### Events

Add to `events.ts`:

```typescript
{ id: 'resources.area_type.created', label: 'Area Type Created', entity: 'area_type', category: 'crud' },
{ id: 'resources.area_type.updated', label: 'Area Type Updated', entity: 'area_type', category: 'crud' },
{ id: 'resources.area_type.deleted', label: 'Area Type Deleted', entity: 'area_type', category: 'crud' },
```

### Search Index

Add search config for `resources:resources_resource_area_type` in `search.ts`.

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `data/entities.ts` | Add `ResourcesResourceAreaType` entity class |
| `data/validators.ts` | Add `resourcesResourceAreaTypeCreateSchema`, `updateSchema` |
| `api/area-types.ts` | CRUD route factory (GET/POST/PUT/DELETE) |
| `api/areaTypeCounts.ts` | Hook to attach `areaCount` to list items (analogous to `resourceTypeCounts.ts`) |
| `commands/area-types.ts` | Create/Update/Delete command handlers with undo/redo |
| `commands/index.ts` | Add `./area-types` import |
| `lib/crud.ts` | Add `resourcesResourceAreaTypeCrudEvents` |
| `components/AreaTypeCrudForm.tsx` | Reusable form component (mirrors `ResourceTypeCrudForm`) |
| `backend/resources/area-types/page.tsx` | List page (mirrors resource-types/page.tsx) |
| `backend/resources/area-types/page.meta.ts` | Page metadata |
| `backend/resources/area-types/create/page.tsx` | Create page |
| `backend/resources/area-types/create/page.meta.ts` | Page metadata |
| `backend/resources/area-types/[id]/edit/page.tsx` | Edit page |
| `backend/resources/area-types/[id]/edit/page.meta.ts` | Page metadata |
| `migrations/MigrationYYYYMMDDHHMMSS_area_types.ts` | Create `resources_resource_area_types` table |
| `i18n/en.json` | Add area type translations |
| `translations.ts` | Add `'resources:resources_resource_area_type': ['name', 'description']` |
| `extension-points.ts` | Add `areaTypesTable` data table extension point |

### Modified Files

| File | Change |
|------|--------|
| `data/entities.ts` | Add `areaTypeId` FK to `ResourcesResourceArea`, remove `areaType` column |
| `data/validators.ts` | Update area create/update schemas: replace `areaType: z.string()` with `areaTypeId: z.string().uuid().nullable()` |
| `api/areas.ts` | Replace `area_type` in list fields with `area_type_id`; update response, filtering, sorting |
| `commands/areas.ts` | Replace `areaType` snapshot field with `areaTypeId`; update create/update logic |
| `backend/resources/areas/page.tsx` | Replace hardcoded type dropdown with dynamic selector fetched from `/api/resources/area-types`; update column rendering |
| `backend/resources/areas/[id]/edit/page.tsx` | Replace hardcoded type select with dynamic area type selector |
| `backend/resources/areas/create/page.tsx` | Replace hardcoded type select with dynamic area type selector |
| `backend/resources/resources/page.tsx` | Update area type display if needed |
| `components/ResourceAreaCrudForm.tsx` | Update form to use dynamic area type selector instead of static enum |
| `setup.ts` | Add `resources.area_types.manage` to `defaultRoleFeatures` admin role |
| `acl.ts` | Add `resources.area_types.manage` feature |
| `events.ts` | Add area type CRUD events |
| `lib/crud.ts` | Export `resourcesResourceAreaTypeCrudEvents` |
| `search.ts` | Update area search to reference area_type by name; add area type search config |
| `migrations/Migration20260903015613_resources.ts` | Update to drop `area_type` column, add `area_type_id` FK column |

---

## Migration Strategy

1. **Add new table** `resources_resource_area_types` with all defaults
2. **Seed default area types** in `setup.ts` `seedDefaults`: campus, building, floor, zone, room, section, other (same names as current enum values, preserving backward compat for any existing data)
3. **Add FK column** `area_type_id` to `resources_resource_areas` (nullable initially)
4. **Backfill** existing areas: for each area with `area_type`, find/create matching area type by name, set `area_type_id`
5. **Drop** `area_type` column (after backfill confirmed)
6. **Update** all code references from `area_type` string to `area_type_id` FK

---

## Implementation Order

### Phase 1: Backend Foundation

1. Add `ResourcesResourceAreaType` entity to `data/entities.ts`
2. Add validators to `data/validators.ts`
3. Create `api/area-types.ts` CRUD route
4. Create `api/areaTypeCounts.ts` hook
5. Create `commands/area-types.ts` with undo/redo
6. Add to `commands/index.ts`
7. Add to `lib/crud.ts`
8. Add events to `events.ts`
9. Add ACL feature to `acl.ts`
10. Add to `setup.ts` defaultRoleFeatures
11. Run `yarn generate` for entity IDs
12. Run `yarn db:generate` for migration
13. Run `yarn db:migrate` to apply (user approves)
14. Add search config to `search.ts`
15. Add to `translations.ts`

### Phase 2: UI — Area Type Management Pages

16. Create `components/AreaTypeCrudForm.tsx`
17. Create `backend/resources/area-types/page.tsx` (list)
18. Create `backend/resources/area-types/page.meta.ts`
19. Create `backend/resources/area-types/create/page.tsx`
20. Create `backend/resources/area-types/create/page.meta.ts`
21. Create `backend/resources/area-types/[id]/edit/page.tsx`
22. Create `backend/resources/area-types/[id]/edit/page.meta.ts`
23. Add area types to `extension-points.ts`
24. Add i18n keys

### Phase 3: Migrate ResourceArea to Use FK

25. Modify `ResourcesResourceArea` entity: remove `areaType`, add `areaTypeId` FK
26. Update `data/validators.ts` (area schemas)
27. Update `api/areas.ts` (fields, filtering, sorting, response)
28. Update `commands/areas.ts` (snapshot, create, update)
29. Update `ResourceAreaCrudForm.tsx` (replace static enum with dynamic selector)
30. Update area list/edit/create pages
31. Run `yarn db:generate` for migration
32. Run `yarn db:migrate` to apply (user approves)
33. Update search.ts area references

### Phase 4: Cleanup

34. Remove `RESOURCE_AREA_TYPES` constant from validators if unused
35. Remove hardcoded type translation keys from area pages
36. Run `yarn generate` to update all generated files
37. Run full validation: `yarn build:packages && yarn typecheck && yarn lint`

---

## Acceptance Criteria

- [ ] Users can CRUD area types via `/backend/resources/area-types`
- [ ] Each area type has: name, description, icon, color, is_active
- [ ] Resource areas reference area types via FK, not hardcoded string
- [ ] Area type dropdown in area forms is populated dynamically from API
- [ ] Default area types (campus, building, floor, zone, room, section, other) are seeded on tenant setup
- [ ] RBAC: `resources.area_types.manage` feature gates area type management
- [ ] Search indexes area types by name
- [ ] Undo/redo works for area type CRUD
- [ ] Deleting an area type is blocked if any areas reference it
- [ ] All migrations are generated and reviewable
- [ ] `yarn build:packages && yarn typecheck && yarn lint` passes

---

## Validation Commands

```bash
yarn generate
yarn db:generate
yarn build:packages
yarn typecheck
yarn lint
yarn test
```

---

## Dependencies

- `ResourcesResourceType` pattern (source of truth for implementation)
- `dictionaries` module (used for capacity unit selectors)
- `@open-mercato/ui` — CrudForm, DataTable, AppearanceSelector

---

## Risk & Mitigations

| Risk | Mitigation |
|------|-----------|
| Existing `area_type` data migration | Backfill via migration SQL; validate counts match before dropping column |
| Areas referencing deleted area types | FK is nullable; deleted area types leave `area_type_id = null` on areas |
| Search index stale after area type rename | Search re-indexes on area CRUD events (already wired) |
| Breaking existing area forms | Area CRUD form gets new dynamic selector; defaults to first available type |
