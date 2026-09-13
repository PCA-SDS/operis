export const metadata = {
  id: 'translate_ctranslate2',
  title: 'CTranslate2 Translation Engine',
  description:
    'Self-hosted machine translation via a CTranslate2 service running M2M100. Registers a TranslationProvider used by chat to translate messages on demand, so message text never leaves the deployment. Inert unless TRANSLATION_SERVICE_URL is set.',
  category: 'Communication' as const,
}

export { createCTranslate2Provider, PROVIDER_ID } from './lib/adapter'
export type { CTranslate2Options } from './lib/adapter'
