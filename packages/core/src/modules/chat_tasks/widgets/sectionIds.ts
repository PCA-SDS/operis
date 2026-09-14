/**
 * The id chat renders this module's panel toggle from, and the one the panel body
 * checks before rendering.
 *
 * Both halves read it from here rather than repeating the literal: chat's region is
 * single-slot and shared, so a toggle whose id had drifted from the section that
 * answers to it would open an empty panel.
 *
 * It is also the command name's namespace — see `widgets/injection/chat-commands`.
 */
export const CHAT_TASKS_PANEL_SECTION_ID = 'chat_tasks.section.tasks'
