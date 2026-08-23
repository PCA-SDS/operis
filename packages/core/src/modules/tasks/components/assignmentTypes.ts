import type { TaskAssignmentTargetKind } from '../data/types'

/** One role audience on a create/update request. */
export type TaskAssignmentTargetInput = {
  kind: TaskAssignmentTargetKind
  roleId?: string | null
}
