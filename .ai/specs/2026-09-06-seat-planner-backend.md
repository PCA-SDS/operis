# SPEC: Seat Planner - Resource Assignment System

## Overview

Seat planner cho phép staff đặt appointment services vào specific resources (seats, rooms, equipment) với thời gian cụ thể. Hệ thống tích hợp với Planner availability để validate bookings và hiển thị timeline.

**Parent Feature:** [Appointments Module](./)
**Status:** Planning
**Priority:** High

---

## Goals

1. **Generic Assignment System** - `ResourcesAssignment` có thể dùng cho mọi module (appointments, WMS, tasks)
2. **Availability Integration** - Validate bookings dựa trên Planner availability rules
3. **Conflict Detection** - Ngăn chặn double-booking resource
4. **Draft/Confirm Workflow** - Staff có thể preview trước khi confirm
5. **UI Timeline** - Resource availability tab hiển thị cả availability rules VÀ bookings

---

## Data Model

### 1. ResourcesAssignment Entity

**Table:** `resources_assignments`

```typescript
// File: packages/core/src/modules/resources/data/entities.ts

@Entity({ tableName: 'resources_assignments' })
@Index({ name: 'ra_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'ra_resource_time_idx', properties: ['resourceId', 'startsAt', 'endsAt'] })
@Index({ name: 'ra_source_idx', properties: ['sourceModule', 'sourceEntityType', 'sourceEntityId'] })
@Index({ name: 'ra_source_entity_idx', properties: ['sourceEntityId'] })
export class ResourcesAssignment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  // === GENERIC SOURCE IDENTIFICATION ===
  // sourceModule: 'appointment' | 'wms' | 'tasks' | ...
  // sourceEntityType: 'appointment_line' | 'shipment' | 'task' | ...
  // sourceEntityId: UUID của entity cụ thể
  @Property({ name: 'source_module', type: 'text' })
  sourceModule!: string

  @Property({ name: 'source_entity_type', type: 'text' })
  sourceEntityType!: string

  @Property({ name: 'source_entity_id', type: 'uuid' })
  sourceEntityId!: string

  // === RESOURCE & TIMING ===
  @Property({ name: 'resource_id', type: 'uuid' })
  resourceId!: string

  @Property({ name: 'state', type: 'text' })
  state!: 'draft' | 'confirmed'

  @Property({ name: 'starts_at', type: Date })
  startsAt!: Date

  @Property({ name: 'ends_at', type: Date })
  endsAt!: Date

  // === STAFF ASSIGNMENT (generic - references staff module) ===
  @Property({ name: 'assigned_member_id', type: 'uuid', nullable: true })
  assignedMemberId?: string | null

  @Property({ name: 'title', type: 'text', nullable: true })
  title?: string | null

  // === AUDIT ===
  @Property({ name: 'cancelled_at', type: Date, nullable: true })
  cancelledAt?: Date | null

  @Property({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
```

**Source Module Conventions:**

| Module | sourceModule | sourceEntityType | Notes |
|--------|--------------|------------------|-------|
| Appointments | `appointment` | `appointment_line` | Each line gets its own assignment |
| WMS | `wms` | `shipment` | Future extension |
| Tasks | `tasks` | `task` | Future extension |

### 2. ResourcesBlock Entity

**Table:** `resources_blocks`

```typescript
// File: packages/core/src/modules/resources/data/entities.ts

@Entity({ tableName: 'resources_blocks' })
@Index({ name: 'rb_resource_time_idx', properties: ['resourceId', 'startsAt', 'endsAt'] })
export class ResourcesBlock {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'resource_id', type: 'uuid' })
  resourceId!: string

  @Property({ name: 'starts_at', type: Date })
  startsAt!: Date

  @Property({ name: 'ends_at', type: Date })
  endsAt!: Date

  @Property({ name: 'reason', type: 'text', nullable: true })
  reason?: string | null

  @Property({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
```

**Use Cases:**
- Resource đang bảo trì
- Resource hỏng
- Resource tạm thời không sử dụng được

---

## Service Layer

### 1. ResourceAssignmentService

**File:** `packages/core/src/modules/resources/lib/resourceAssignmentService.ts`

```typescript
export interface AssignmentUpsertParams {
  // Identity
  tenantId: string
  organizationId: string
  sourceModule: string
  sourceEntityType: string
  sourceEntityId: string

  // Assignment details
  resourceId: string
  startsAt: Date
  endsAt: Date
  assignedMemberId?: string | null
  title?: string

  // Audit
  userId?: string | null
}

export interface AssignmentWorkspace {
  resource: {
    id: string
    name: string
    code?: string | null
    areaName?: string | null
    typeName?: string | null
    typeColor?: string | null
  }
  existingAssignment?: {
    id: string
    state: 'draft' | 'confirmed'
    startsAt: string
    endsAt: string
    assignedMemberId?: string | null
    assignedMemberName?: string | null
    title?: string | null
  }
}

export interface ConflictCheckOptions {
  excludeAssignmentId?: string
  excludeSourceEntityIds?: string[]
}

export class ResourceAssignmentService {

  // === WORKSPACE ===
  getWorkspace(params: {
    tenantId: string
    organizationId: string
    sourceModule: string
    sourceEntityType: string
    sourceEntityId: string
    resourceId?: string
  }): Promise<{
    resources: ResourcesResource[]
    assignments: ResourcesAssignment[]
    availabilityWindows: AvailabilityWindow[]
  }>

  // === DRAFT OPERATIONS ===
  async upsertDraft(params: AssignmentUpsertParams): Promise<ResourcesAssignment>

  async clearDraft(params: {
    tenantId: string
    sourceModule: string
    sourceEntityType: string
    sourceEntityId: string
  }): Promise<void>

  // === CONFIRM OPERATIONS ===
  async confirmDrafts(params: {
    tenantId: string
    organizationId: string
    sourceModule: string
    sourceEntityType: string
    sourceEntityId: string
    userId?: string | null
  }): Promise<ResourcesAssignment[]>

  async cancelAssignment(params: {
    tenantId: string
    assignmentId: string
  }): Promise<void>

  // === STAFF ===
  async updateAssignmentStaff(params: {
    tenantId: string
    assignmentId: string
    assignedMemberId: string | null
  }): Promise<ResourcesAssignment>

  // === CONFLICT CHECKS ===
  async assertNoBlocks(resourceId: string, startsAt: Date, endsAt: Date): Promise<void>
  async assertNoConfirmedConflicts(resourceId: string, startsAt: Date, endsAt: Date, options?: ConflictCheckOptions): Promise<void>
  async assertWithinAvailability(resourceId: string, startsAt: Date, endsAt: Date): Promise<void>
}
```

### 2. Conflict Detection Logic

```typescript
// Priority order: 1. Block → 2. Availability → 3. Confirmed Assignment

async validateAssignment(params: {
  resourceId: string
  startsAt: Date
  endsAt: Date
  excludeAssignmentId?: string
  excludeSourceEntityIds?: string[]
}): Promise<void> {
  // 1. Check resource exists & is active
  const resource = await this.em.findOne(ResourcesResource, {
    id: params.resourceId,
    isActive: true
  })
  if (!resource) throw new NotFoundException('Resource not found or inactive')

  // 2. Check blocks
  await this.assertNoBlocks(params.resourceId, params.startsAt, params.endsAt)

  // 3. Check availability rules (from Planner module)
  await this.assertWithinAvailability(params.resourceId, params.startsAt, params.endsAt)

  // 4. Check confirmed conflicts (exclude same sourceEntityId for chaining)
  await this.assertNoConfirmedConflicts(
    params.resourceId,
    params.startsAt,
    params.endsAt,
    { excludeAssignmentId: params.excludeAssignmentId, excludeSourceEntityIds: params.excludeSourceEntityIds }
  )
}
```

### 3. Draft vs Confirmed State Machine

```
┌─────────────────────────────────────────────────────────────────────┐
│                         STATE TRANSITIONS                             │
│                                                                      │
│  [upsertDraft] ──► DRAFT ◄────────────┐                            │
│       │               │               │                            │
│       │               │               │                            │
│       │               ▼               │                            │
│       │        [upsertDraft again]    │                            │
│       │               │               │                            │
│       │               ▼               │                            │
│       │        [clearDraft] ──► DELETED (cancelled_at = now)       │
│       │               │                                            │
│       │               ▼                                            │
│       └──────► [confirmDrafts] ──► CONFIRMED                       │
│                         │                                          │
│                         ▼                                          │
│                  [cancelAssignment] ──► CANCELLED                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Business Rules:**

| Rule | Description |
|------|-------------|
| **Draft Override** | Draft assignment overrides CONFIRMED của cùng sourceEntityId |
| **Chaining** | Multiple services cùng booking có thể overlap (exclude same sourceEntityId) |
| **Staff Overlap** | Staff assignments CÓ THỂ overlap (business decision) |
| **Auto-cancel** | Khi upsert draft → auto-cancel old confirmed của same sourceEntityId |
| **Confirm** | Chuyển tất cả drafts → confirmed, cancel old confirmeds |

---

## API Design

### 1. Appointments Module Endpoints

**Base Path:** `/api/appointments/:appointmentId`

| Method | Path | Description | Permission |
|--------|------|-------------|------------|
| GET | `/seat-planner` | Get seat planner workspace | `appointments.view` |
| PUT | `/lines/:lineId/draft` | Upsert draft assignment | `appointments.manage` |
| DELETE | `/lines/:lineId/draft` | Clear draft assignment | `appointments.manage` |
| PATCH | `/assignments/:assignmentId/staff` | Update staff assignment | `appointments.manage` |
| POST | `/confirm-drafts` | Confirm all drafts | `appointments.manage` |

### 2. GET /api/appointments/:id/seat-planner

**Response:**

```typescript
type SeatPlannerWorkspace = {
  appointment: {
    id: string
    customerName: string
    requestedStartAt: string
    status: {
      code: string
      label: string
    }
  }
  lines: Array<{
    id: string
    productTitle: string
    durationMinutes: number
    currentAssignment?: {
      id: string
      state: 'draft' | 'confirmed'
      resourceId: string
      resourceName: string
      startsAt: string
      endsAt: string
      assignedMemberId?: string | null
      assignedMemberName?: string | null
    }
  }>
  resources: Array<{
    id: string
    name: string
    code?: string | null
    areaName?: string | null
    typeName?: string | null
    typeColor?: string | null
  }>
  availabilityWindows: Array<{
    start: string
    end: string
    isAvailable: boolean
  }>
}
```

### 3. PUT /api/appointments/:id/lines/:lineId/draft

**Request:**

```typescript
type UpsertDraftRequest = {
  resourceId: string
  startsAt: string    // ISO datetime
  endsAt: string      // ISO datetime
  assignedMemberId?: string | null
}
```

**Response:**

```typescript
type UpsertDraftResponse = {
  id: string
  state: 'draft'
  resourceId: string
  startsAt: string
  endsAt: string
  assignedMemberId?: string | null
}
```

**Errors:**

| Code | HTTP | Message |
|------|------|---------|
| `RESOURCE_NOT_FOUND` | 404 | Resource not found |
| `RESOURCE_INACTIVE` | 400 | Resource is not active |
| `RESOURCE_BLOCKED` | 409 | Resource is blocked for this time |
| `OUTSIDE_AVAILABILITY` | 409 | Outside resource availability hours |
| `CONFLICT` | 409 | Resource already booked for this time |
| `INVALID_TIME` | 400 | End time must be after start time |

### 4. Resources Module - Booked Events Endpoint

**GET** `/api/resources/resources/:id/assignments`

```typescript
type LoadAssignmentsRequest = {
  start: string   // ISO date
  end: string     // ISO date
}

type LoadAssignmentsResponse = {
  items: Array<{
    id: string
    sourceModule: string
    sourceEntityType: string
    sourceEntityId: string
    state: 'draft' | 'confirmed'
    startsAt: string
    endsAt: string
    title?: string | null
    assignedMemberId?: string | null
    assignedMemberName?: string | null
  }>
}
```

---

## ACL Features

**File:** `packages/core/src/modules/appointments/acl.ts`

```typescript
export const features = [
  // ... existing features
  {
    id: 'appointments.seat_planner.view',
    title: 'View seat planner',
    module: 'appointments',
    dependsOn: ['appointments.view'],
  },
  {
    id: 'appointments.seat_planner.manage',
    title: 'Manage seat assignments',
    module: 'appointments',
    dependsOn: ['appointments.seat_planner.view', 'appointments.manage'],
  },
]
```

**Default Role Features (setup.ts):**

```typescript
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['appointments.*'],
    employee: ['appointments.view', 'appointments.seat_planner.view', 'appointments.seat_planner.manage'],
  },
}
```

---

## UI Integration

### 1. Appointments - Seat Planner Page

**Path:** `/backend/appointments/:id/seat-planner`

**Components:**
- `SeatPlannerTimeline` - Timeline view showing resources and assignments
- `ResourceSelector` - Dropdown to select resource
- `TimeSlotPicker` - Time slot selection with availability indicators
- `StaffSelector` - Optional staff assignment
- `ConfirmButton` - Confirm all drafts

### 2. Resources - Availability Tab Enhancement

**File:** `packages/core/src/modules/resources/backend/resources/resources/[id]/page.tsx`

**Changes:**

```typescript
// 1. Add loadBookedEvents function
const loadBookedEvents = React.useCallback(async (range: ScheduleRange) => {
  const response = await apiCall<{ items: AvailabilityBookedEvent[] }>(
    `/api/resources/resources/${resourceId}/assignments?start=${range.start}&end=${range.end}`
  )
  return response.items.map(item => ({
    id: item.id,
    title: item.title ?? 'Booked',
    startsAt: new Date(item.startsAt),
    endsAt: new Date(item.endsAt),
  }))
}, [resourceId])

// 2. Enhance buildScheduleItems
const buildScheduleItems = React.useCallback<AvailabilityScheduleItemBuilder>(
  ({ availabilityRules, bookedEvents, translate }) => {
    const availabilityItems = buildResourceScheduleItems({
      availabilityRules,
      bookedEvents,  // ← Pass booked events
      isAvailableByDefault: false,
      translate,
    })
    return availabilityItems
  },
  []
)

// 3. Pass loadBookedEvents to AvailabilityRulesEditor
<AvailabilityRulesEditor
  subjectType="resource"
  subjectId={resourceId ?? ''}
  loadBookedEvents={loadBookedEvents}  // ← ADD THIS
  buildScheduleItems={buildScheduleItems}
  // ...
/>
```

**Enhanced buildResourceScheduleItems:**

```typescript
export function buildResourceScheduleItems(params: {
  availabilityRules: ResourceAvailabilityRule[]
  bookedEvents: AvailabilityBookedEvent[]  // ← ADDED
  isAvailableByDefault: boolean
  translate: (key: string, fallback?: string) => string
}): ScheduleItem[] {
  const items: ScheduleItem[] = []

  // Convert availability rules
  for (const rule of params.availabilityRules) {
    // ... existing logic
    items.push({
      id: rule.id,
      kind: availabilityKind,
      title,
      startsAt: windowTime.start,
      endsAt: windowTime.end,
      metadata: { rule: { ...rule, exdates } },
    })
  }

  // Convert booked events  // ← ADDED
  for (const event of params.bookedEvents) {
    items.push({
      id: event.id,
      kind: 'appointment' as const,  // Distinct from availability/unavailability
      title: event.title,
      startsAt: event.startsAt instanceof Date ? event.startsAt : new Date(event.startsAt),
      endsAt: event.endsAt instanceof Date ? event.endsAt : new Date(event.endsAt),
      metadata: { event },
    })
  }

  return items
}
```

---

## Implementation Phases

### Phase 1: Entity & Migration

**Files:**
- `packages/core/src/modules/resources/data/entities.ts` - Add `ResourcesAssignment`, `ResourcesBlock`
- `packages/core/src/modules/resources/migrations/` - Create migration
- `packages/core/src/modules/resources/migrations/.snapshot-open-mercato.json` - Update snapshot
- `#generated/entities.ids.generated.ts` - Run `yarn generate`

**Deliverables:**
- [ ] `ResourcesAssignment` entity with all fields
- [ ] `ResourcesBlock` entity with all fields
- [ ] Database migration files
- [ ] Updated entity ID registry

### Phase 2: Core Service

**Files:**
- `packages/core/src/modules/resources/lib/resourceAssignmentService.ts` - Main service
- `packages/core/src/modules/resources/lib/assignmentConflict.ts` - Conflict detection
- `packages/core/src/modules/resources/lib/availabilityMerge.ts` - Already exists, integrate

**Deliverables:**
- [ ] `ResourceAssignmentService` class
- [ ] Conflict detection with Planner availability integration
- [ ] Block checking
- [ ] Draft/Confirm state management
- [ ] Unit tests

### Phase 3: Appointments Module

**Files:**
- `packages/core/src/modules/appointments/lib/seatPlannerService.ts` - Appointments wrapper
- `packages/core/src/modules/appointments/api/[id]/seat-planner/` - API routes
- `packages/core/src/modules/appointments/acl.ts` - Add features
- `packages/core/src/modules/appointments/setup.ts` - Update defaults
- `packages/core/src/modules/appointments/events.ts` - Add events

**Deliverables:**
- [ ] `SeatPlannerService` class wrapping `ResourceAssignmentService`
- [ ] API endpoints (GET, PUT, DELETE, PATCH, POST)
- [ ] ACL features added
- [ ] Events for assignment changes
- [ ] Integration tests

### Phase 4: UI - Seat Planner Page

**Files:**
- `packages/core/src/modules/appointments/backend/appointments/[id]/seat-planner/page.tsx` - New page
- `packages/core/src/modules/appointments/components/seat-planner/` - Components
- `packages/core/src/modules/appointments/i18n/` - Translations

**Deliverables:**
- [ ] Seat planner timeline UI
- [ ] Resource selection with availability
- [ ] Time slot picker
- [ ] Staff assignment
- [ ] Draft/Confirm workflow

### Phase 5: UI - Resource Availability Enhancement

**Files:**
- `packages/core/src/modules/resources/backend/resources/resources/[id]/page.tsx` - Enhance
- `packages/core/src/modules/resources/lib/resourceSchedule.ts` - Enhance
- `packages/core/src/modules/resources/api/resources/[id]/assignments.ts` - New endpoint

**Deliverables:**
- [ ] Load assignments API endpoint
- [ ] `loadBookedEvents` integration
- [ ] Enhanced timeline with bookings

---

## Dependencies

| Module | Purpose |
|--------|---------|
| `resources` | Entity storage, conflict detection |
| `planner` | Availability rules via `getMergedAvailabilityWindows()` |
| `staff` | Member/employee lookup |
| `appointments` | Source data (lines, products) |

**Optional Integration (via events):**
- `notifications` - Notify staff of assignments
- `audit_logs` - Log assignment changes

---

## Error Handling

| Error Type | HTTP | User Message | Technical Detail |
|------------|------|--------------|------------------|
| Resource not found | 404 | Resource not found or inactive | Log warning |
| Resource blocked | 409 | This resource is blocked for the selected time | Show blocked reason if available |
| Outside availability | 409 | Outside resource's working hours | Show available hours |
| Booking conflict | 409 | Resource is already booked for this time | Show conflicting booking |
| Invalid time | 400 | End time must be after start time | Validation error |

---

## Acceptance Criteria

1. **Assignment Creation**
   - [ ] Staff can assign a service to a resource for a specific time
   - [ ] System validates against availability rules
   - [ ] System prevents double-booking
   - [ ] Draft state allows preview before confirming

2. **Conflict Detection**
   - [ ] Blocked resources cannot be booked
   - [ ] Bookings outside availability hours are rejected
   - [ ] Confirmed bookings conflict with each other
   - [ ] Draft bookings do not conflict (for chaining)

3. **State Management**
   - [ ] Draft assignments can be updated
   - [ ] Draft assignments can be cleared
   - [ ] Draft assignments can be confirmed
   - [ ] Old confirmed assignments are cancelled when overwritten

4. **UI**
   - [ ] Seat planner shows resources and existing assignments
   - [ ] Availability tab shows bookings alongside availability rules
   - [ ] Timeline visualizes availability and bookings distinctly

5. **Integration**
   - [ ] Appointments module uses generic assignment service
   - [ ] Other modules can use the same system
   - [ ] Planner availability rules are respected
