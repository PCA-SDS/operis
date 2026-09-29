import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * What to call the network an outsider is on.
 *
 * One explicit call per known network rather than a key built from the label,
 * so every string is visible to the translation tooling. Brand names read the
 * same in every locale; the fallback does not.
 */
export function networkLabel(t: TranslateFn, network: string | null | undefined): string {
  switch (network) {
    case 'whatsapp':
      return t('chat.external.network.whatsapp', 'WhatsApp')
    case 'telegram':
      return t('chat.external.network.telegram', 'Telegram')
    case 'signal':
      return t('chat.external.network.signal', 'Signal')
    case 'matrix':
      return t('chat.external.network.matrix', 'Matrix')
    default:
      return t('chat.external.network.other', 'external network')
  }
}
