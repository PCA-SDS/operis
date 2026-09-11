import { SERVICE_MENU } from '../data/serviceMenu'
import {
  buildServiceMenuImportPlan,
  buildServiceMenuOptionKey,
  SERVICE_SCHEDULE_FIELDSET,
} from '../serviceMenuImportPlan'

describe('service menu import plan', () => {
  it('indexes every TPS product with unique SKU and handle values', () => {
    const plan = buildServiceMenuImportPlan(SERVICE_MENU)

    expect(plan.products).toHaveLength(68)
    expect(new Set(plan.products.map((product) => product.productId)).size).toBe(plan.products.length)
    expect(new Set(plan.products.map((product) => product.sku)).size).toBe(plan.products.length)
    expect(new Set(plan.products.map((product) => product.handle)).size).toBe(plan.products.length)
  })

  it('keeps duplicate option ids addressable by scoped path', () => {
    const plan = buildServiceMenuImportPlan(SERVICE_MENU)
    const polishRegularOptions = plan.optionOccurrences.filter((option) => option.optionId === 'polish-regular')

    expect(polishRegularOptions).toHaveLength(11)
    expect(plan.optionOccurrencesByKey.get(
      buildServiceMenuOptionKey('manicure-relaxing', ['polish-type', 'polish-regular']),
    )?.name).toBe('Regular Polish')
    expect(plan.optionOccurrencesByKey.get(
      buildServiceMenuOptionKey('pedicure-royal', ['polish-type', 'polish-regular']),
    )?.name).toBe('Regular Polish')
  })

  it('normalizes Regular Polish comments to option-level targets instead of the whole polish product', () => {
    const plan = buildServiceMenuImportPlan(SERVICE_MENU)
    const sourceKey = buildServiceMenuOptionKey('builder-gel', ['builder-type', 'gelish-structure'])
    const targetKey = buildServiceMenuOptionKey('polish', ['polish-type', 'type-regular'])

    expect(plan.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        constraintType: 'conflicts_with_item',
        source: { kind: 'option', optionKey: sourceKey },
        target: { kind: 'option', optionKey: targetKey },
      }),
    ]))

    expect(plan.constraints).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        constraintType: 'conflicts_with_item',
        source: { kind: 'option', optionKey: sourceKey },
        target: { kind: 'product', productId: 'polish' },
      }),
    ]))
  })

  it('normalizes repeated package Regular Polish constraints with their own source option occurrence', () => {
    const plan = buildServiceMenuImportPlan(SERVICE_MENU)
    const sourceKey = buildServiceMenuOptionKey('manicure-relaxing', ['polish-type', 'polish-regular'])

    expect(plan.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        constraintType: 'conflicts_with_item',
        source: { kind: 'option', optionKey: sourceKey },
        target: { kind: 'product', productId: 'builder-gel' },
      }),
    ]))
  })

  it('resolves legacy mutuallyExclusive option refs within the current product', () => {
    const plan = buildServiceMenuImportPlan(SERVICE_MENU)
    const womenHalf = buildServiceMenuOptionKey('wax-arms-women', ['area', 'area-half'])
    const womenFull = buildServiceMenuOptionKey('wax-arms-women', ['area', 'area-full'])
    const menFull = buildServiceMenuOptionKey('wax-arms-men', ['area', 'area-full'])

    expect(plan.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        constraintType: 'mutually_exclusive_item',
        source: { kind: 'option', optionKey: womenHalf },
        target: { kind: 'option', optionKey: womenFull },
      }),
    ]))
    expect(plan.constraints).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        constraintType: 'mutually_exclusive_item',
        source: { kind: 'option', optionKey: womenHalf },
        target: { kind: 'option', optionKey: menFull },
      }),
    ]))
  })

  it('computes service discovery metadata without replacing option-level duration and price', () => {
    const plan = buildServiceMenuImportPlan(SERVICE_MENU)
    const service = plan.productById.get('cuticle-prive-technique')

    expect(SERVICE_SCHEDULE_FIELDSET).toBe('service_schedule')
    expect(service?.duration).toBe('45 mins')
    expect(service?.durationSummaryMinutes).toBe(45)
    expect(service?.durationRange).toBeUndefined()
  })
})
