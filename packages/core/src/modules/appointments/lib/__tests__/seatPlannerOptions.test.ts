import { groupSeatPlannerOptions } from '../seatPlannerOptions'

describe('groupSeatPlannerOptions', () => {
  it('keeps multiple options in the same group at the same hierarchy level', () => {
    expect(groupSeatPlannerOptions([
      { groupName: 'Area', name: 'Underarms' },
      { groupName: 'Area', name: 'Half Arms' },
    ])).toEqual([
      { groupName: 'Area', names: ['Underarms', 'Half Arms'] },
    ])
  })

  it('preserves the first-seen order of distinct groups', () => {
    expect(groupSeatPlannerOptions([
      { groupName: 'Area', name: 'Underarms' },
      { groupName: 'Style', name: 'Classic' },
      { groupName: 'Area', name: 'Half Arms' },
    ])).toEqual([
      { groupName: 'Area', names: ['Underarms', 'Half Arms'] },
      { groupName: 'Style', names: ['Classic'] },
    ])
  })
})
