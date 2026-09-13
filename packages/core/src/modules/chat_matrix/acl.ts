/**
 * One feature, and it is an operator concern.
 *
 * Nothing here grants access to a conversation: chat access is membership, not
 * privilege, and this module must not become a way around that. The only thing
 * a person can do with these tables is look at transport health — which room a
 * conversation maps to, whether provisioning failed, how far behind the sync
 * cursor is.
 */
export const features = [
  {
    id: 'chat_matrix.view',
    title: 'Inspect Matrix chat transport health',
    module: 'chat_matrix',
  },
]

export default features
