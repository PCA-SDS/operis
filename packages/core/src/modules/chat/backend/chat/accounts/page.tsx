import { AccountsManager } from '@open-mercato/core/modules/chat/components/accounts/AccountsManager'

/**
 * `/backend/chat/accounts` — connecting the company's WhatsApp numbers. The
 * whole page is `AccountsManager`; this file only mounts it at its route.
 */
export default function ChatAccountsPage() {
  return <AccountsManager />
}
