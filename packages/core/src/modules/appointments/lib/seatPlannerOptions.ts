export type SeatPlannerOption = {
  groupName: string | null
  name: string
}

export type SeatPlannerOptionGroup = {
  groupName: string | null
  names: string[]
}

export function groupSeatPlannerOptions(options: SeatPlannerOption[]): SeatPlannerOptionGroup[] {
  const groups: SeatPlannerOptionGroup[] = []
  const groupIndexes = new Map<string, number>()

  for (const option of options) {
    const key = option.groupName ?? ''
    const existingIndex = groupIndexes.get(key)
    if (existingIndex !== undefined) {
      groups[existingIndex].names.push(option.name)
      continue
    }

    groupIndexes.set(key, groups.length)
    groups.push({ groupName: option.groupName, names: [option.name] })
  }

  return groups
}
