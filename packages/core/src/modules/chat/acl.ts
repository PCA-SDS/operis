/**
 * Two features, because there are only two things a person can do here: read
 * their own conversations, and write. Anything finer would be a permission with
 * no screen behind it.
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
]

export default features
