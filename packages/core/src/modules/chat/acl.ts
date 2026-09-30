/**
 * Reading your own conversations and writing are the two things everyone does.
 * The two account features gate settings screens, not conversations — anything
 * finer would be a permission with no screen behind it.
 *
 * Note what is deliberately absent: no `chat.manage` that reads other people's
 * conversations. Access is membership, not privilege — a role cannot be granted
 * a way into a conversation it is not part of.
 */
export const features = [
  { id: 'chat.view', title: 'Use chat and read own conversations', module: 'chat' },
  {
    id: 'chat.send',
    title: 'Start conversations and send messages',
    module: 'chat',
    dependsOn: ['chat.view'],
  },
  /**
   * Connecting the company's WhatsApp and choosing who handles its chats. It
   * grants no way into a conversation: the chats reach the team chosen here, and
   * whoever holds this sees only the ones they are in.
   */
  {
    id: 'chat.accounts.manage',
    title: 'Connect and manage company messaging accounts',
    module: 'chat',
    dependsOn: ['chat.view'],
  },
  /** Connecting one's own WhatsApp, whose chats stay private unless moved to the company. */
  {
    id: 'chat.accounts.connect_own',
    title: 'Connect own messaging account',
    module: 'chat',
    dependsOn: ['chat.view'],
  },
]

export default features
