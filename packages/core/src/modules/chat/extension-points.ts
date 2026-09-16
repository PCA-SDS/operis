import {
  defineModuleExtensionPoints,
  injectionExtensionHost,
} from '@open-mercato/shared/modules/widgets/extension-points'

/**
 * Surfaces this module opens to other modules.
 *
 * Chat had none until the tasks integration needed four, and the shape of those
 * four is what keeps the dependency pointing one way: chat renders a spot and
 * another module fills it, so `chat` imports nothing from `chat_tasks` and
 * removing that module empties the spots instead of breaking a conversation.
 *
 * The call sites read their ids from here rather than repeating the literal,
 * which is what keeps the declaration bound to the code.
 */
export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'chat',
  hosts: {
    /**
     * Commands offered when the composer's text begins with `/`.
     *
     * A row action rather than a menu item: each entry needs the conversation it
     * was invoked in, and `onSelect(row, context)` is the only injected shape
     * that receives one.
     */
    composerCommands: injectionExtensionHost({
      family: 'menu',
      spotId: 'chat:composer:commands',
      supported: ['row-action'],
      /**
       * The view, not the composer.
       *
       * `MessageComposer` renders the menu but is handed a plain `commands` array —
       * it knows nothing about injection, which is what keeps it testable without a
       * widget registry. The view is where the spot is actually read, and `source`
       * has to name that file or the extension-facts generator reports the
       * declaration as unbound.
       */
      source: 'components/ConversationView.tsx',
      contextContract: 'ChatComposerCommandContext',
    }),
    /**
     * Extra entries in one message's overflow menu. The row handed to
     * `onSelect` is a `ChatMessageActionTarget`.
     */
    messageActions: injectionExtensionHost({
      family: 'menu',
      spotId: 'chat:message:actions',
      supported: ['row-action'],
      source: 'components/MessageList.tsx',
      contextContract: 'ChatMessageActionContext',
    }),
    /**
     * The body of a card row — a message with `kind: 'system'` and
     * `systemEvent: 'card'`, which carries no text of its own.
     *
     * The row exists so the transcript has a place in its own timeline for a
     * reference to something outside chat; what that reference IS belongs to
     * whichever module wrote it. Unclaimed, the transcript renders a neutral
     * "unavailable" line, so a card whose module was disabled reads as missing
     * rather than as an empty gap.
     */
    messageCard: injectionExtensionHost({
      family: 'generic',
      spotId: 'chat:message:card',
      supported: ['render-widget'],
      source: 'components/MessageList.tsx',
      contextContract: 'ChatMessageCardContext',
    }),
    /**
     * An extra section in the conversation's contextual right-hand region,
     * beside Pinned and Shared. The section's own label and icon come from a
     * `chat:conversation-panel:sections` row action, so chat can render the
     * toggle without knowing what is behind it.
     */
    conversationPanelSections: injectionExtensionHost({
      family: 'menu',
      spotId: 'chat:conversation-panel:sections',
      supported: ['row-action'],
      source: 'components/ConversationView.tsx',
      contextContract: 'ChatConversationPanelContext',
    }),
    conversationPanelSection: injectionExtensionHost({
      family: 'generic',
      spotId: 'chat:conversation-panel:section',
      supported: ['render-widget'],
      source: 'components/ConversationView.tsx',
      contextContract: 'ChatConversationPanelContext',
    }),
    /**
     * Mounted once per open conversation, unconditionally, and rendering nothing of
     * its own.
     *
     * It exists because a contributed command or message action is a callback, and a
     * callback cannot render a drawer. Something has to be already on screen to open
     * one — which is exactly why chat mounts its own space-details dialog and
     * confirm dialog once per view rather than per row. This is that place, for
     * everybody else.
     */
    conversationOverlays: injectionExtensionHost({
      family: 'generic',
      spotId: 'chat:conversation:overlays',
      supported: ['render-widget'],
      source: 'components/ConversationView.tsx',
      contextContract: 'ChatConversationOverlayContext',
    }),
  },
})

export default extensionPoints
