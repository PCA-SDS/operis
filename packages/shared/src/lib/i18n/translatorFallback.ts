import { resolveTranslations } from './server'
import { createFallbackTranslator, type TranslateWithFallbackFn } from './translate'

/**
 * The request translator, or an empty-dictionary fallback when translations
 * cannot be resolved (outside a request, or in a worker), so a caller building
 * an error message never fails on the translation step itself.
 */
export async function resolveTranslatorWithFallback(): Promise<TranslateWithFallbackFn> {
  try {
    const { translate } = await resolveTranslations()
    return translate
  } catch {
    return createFallbackTranslator({})
  }
}
