import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { ChatMessagingAccountDto } from '../../data/types'

/** Every status the page can show, each through its own key so the tooling sees it. */
export function accountStatusLabel(t: TranslateFn, status: ChatMessagingAccountDto['status']): string {
  switch (status) {
    case 'connected':
      return t('chat.accounts.status.connected', 'Connected')
    case 'connecting':
      return t('chat.accounts.status.connecting', 'Connecting…')
    case 'disconnected':
      return t('chat.accounts.status.disconnected', 'Disconnected')
    case 'failed':
      return t('chat.accounts.status.failed', "Couldn't connect")
    default:
      return t('chat.accounts.status.pending', 'Not connected')
  }
}

export function accountStatusVariant(status: ChatMessagingAccountDto['status']): StatusBadgeVariant {
  switch (status) {
    case 'connected':
      return 'success'
    case 'connecting':
      return 'info'
    case 'disconnected':
      return 'warning'
    case 'failed':
      return 'error'
    default:
      return 'neutral'
  }
}

/** Why a login failed or an account dropped, in words a manager can act on. */
export function accountReasonText(t: TranslateFn, reason: string | null): string | null {
  switch (reason) {
    case null:
      return null
    case 'timeout':
      return t('chat.accounts.reason.timeout', 'The code expired before it was scanned. Try again.')
    case 'cancelled':
      return t('chat.accounts.reason.cancelled', 'Connecting was cancelled.')
    case 'invalid_phone_number':
      return t('chat.accounts.reason.invalidPhoneNumber', "WhatsApp didn't accept that phone number.")
    case 'rate_limited':
      return t(
        'chat.accounts.reason.rateLimited',
        'WhatsApp is limiting login attempts for this number. Wait a few minutes, then try again.',
      )
    case 'logged_out':
      return t(
        'chat.accounts.reason.loggedOut',
        'The link was removed on the phone, or the phone was offline for too long. Connect it again.',
      )
    case 'bad_credentials':
      return t('chat.accounts.reason.badCredentials', 'WhatsApp ended the session. Connect it again.')
    case 'unsupported_step':
      return t(
        'chat.accounts.reason.unsupportedStep',
        'WhatsApp asked for a step Operis cannot show. Try the other way of connecting.',
      )
    case 'network_unavailable':
    case 'no_connector':
      return t('chat.accounts.reason.unavailable', "WhatsApp isn't set up on this server.")
    case 'bridge_unreachable':
      return t('chat.accounts.reason.unreachable', "WhatsApp couldn't be reached. Try again in a moment.")
    case 'already_connected_elsewhere':
      return t('chat.accounts.reason.elsewhere', 'This number is already connected to another account.')
    default:
      return t('chat.accounts.reason.error', 'Something went wrong. Try again.')
  }
}
