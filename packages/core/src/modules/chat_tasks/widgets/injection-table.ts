import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Where this module contributes UI — six spots in chat, one in tasks, one in the sidebar.
 *
 * The ids are written as **literals**, not read from the host modules'
 * `extension-points.ts`. That is deliberate and slightly uncomfortable: the runtime
 * registry imports this file, but the extension-facts generator *parses* it, and a
 * computed key is not something a parser can fold. A literal is legible to both.
 *
 * What keeps them honest is `__tests__/injectionTable.test.ts`, which asserts every
 * key here is a spot one of the two host modules actually declares — so a renamed
 * spot fails a test instead of quietly emptying a panel.
 *
 * One static object literal, no ternaries and no loops, for the same reason: a table
 * assembled conditionally publishes nothing. Every entry is inert without its host,
 * because each is keyed on a spot only that module renders.
 */
export const injectionTable: ModuleInjectionTable = {
  'chat:composer:commands': [{ widgetId: 'chat_tasks.injection.chat-commands', priority: 100 }],
  'chat:message:actions': [{ widgetId: 'chat_tasks.injection.message-actions', priority: 100 }],
  'chat:message:card': [{ widgetId: 'chat_tasks.injection.task-card', priority: 100 }],
  'chat:conversation-panel:sections': [
    { widgetId: 'chat_tasks.injection.panel-section', priority: 100 },
  ],
  'chat:conversation-panel:section': [
    { widgetId: 'chat_tasks.injection.conversation-panel', priority: 100 },
  ],
  'chat:conversation:overlays': [
    { widgetId: 'chat_tasks.injection.conversation-overlays', priority: 100 },
  ],
  'tasks:task-panel:sidebar': [{ widgetId: 'chat_tasks.injection.task-sources', priority: 80 }],
  'menu:sidebar:main': [{ widgetId: 'chat_tasks.injection.workspace-menu', priority: 90 }],
}

export default injectionTable
