import { detectSlashCommandDraft, resolveSlashCommand } from '../lib/slashCommands'

const KNOWN = ['task', 'mytasks', 'tasks']

/**
 * The rule under test is the one that decides whether a line of chat is a command
 * or a sentence. Getting it wrong in the permissive direction swallows ordinary
 * messages; getting it wrong in the strict direction makes the feature invisible.
 */
describe('detectSlashCommandDraft', () => {
  it('opens the menu while the caret is inside a leading command token', () => {
    expect(detectSlashCommandDraft('/ta', 3)).toEqual({ query: 'ta' })
  })

  it('opens on the bare slash, so the menu lists everything', () => {
    expect(detectSlashCommandDraft('/', 1)).toEqual({ query: '' })
  })

  it('closes the menu once a space is typed', () => {
    expect(detectSlashCommandDraft('/task ', 6)).toBeNull()
    expect(detectSlashCommandDraft('/task Ship it', 13)).toBeNull()
  })

  it('never opens for a slash that is not the first character', () => {
    expect(detectSlashCommandDraft('see /docs', 9)).toBeNull()
    expect(detectSlashCommandDraft('a/b', 3)).toBeNull()
  })

  it('does not reopen when the caret moves back into an earlier word', () => {
    // `/task` is still the first token, but the caret is in the argument, so the
    // writer is composing rather than picking from a list.
    expect(detectSlashCommandDraft('/task prepare', 10)).toBeNull()
  })

  it('treats a path-looking token as ordinary text', () => {
    // The second slash ends the token, which is what keeps `/etc/passwd` out.
    expect(detectSlashCommandDraft('/etc/passwd', 11)).toBeNull()
  })

  it('is null without a caret, so a blurred field opens nothing', () => {
    expect(detectSlashCommandDraft('/task', null)).toBeNull()
  })
})

describe('resolveSlashCommand', () => {
  it('recognises a command with no argument', () => {
    expect(resolveSlashCommand('/mytasks', KNOWN)).toEqual({ name: 'mytasks', argument: '' })
  })

  it('recognises a command and hands the rest through untouched', () => {
    expect(resolveSlashCommand('/task Prepare the proposal by tomorrow 3pm', KNOWN)).toEqual({
      name: 'task',
      // Verbatim: the tasks module's quick-add grammar is the only thing that
      // interprets this, and trimming or reordering it here would be a second parser.
      argument: 'Prepare the proposal by tomorrow 3pm',
    })
  })

  it('matches the name case-insensitively', () => {
    expect(resolveSlashCommand('/TASK Ship it', KNOWN)).toEqual({ name: 'task', argument: 'Ship it' })
  })

  it('keeps later lines in the argument, so Shift+Enter detail survives', () => {
    expect(resolveSlashCommand('/task Ship it\nand tell the team', KNOWN)).toEqual({
      name: 'task',
      argument: 'Ship it\nand tell the team',
    })
  })

  /**
   * The important half. Each of these begins with a slash and none of them is a
   * command, so each must stay an ordinary message — a composer that swallowed any
   * of them would be worse than one with no commands at all.
   */
  it.each([
    '/etc/passwd is unreadable',
    '/docs/setup needs an update',
    '/unknown do the thing',
    '/',
    '/task/2026 is the wrong path',
    'see /task for details',
    'https://example.com/task',
  ])('leaves %p as ordinary text', (line) => {
    expect(resolveSlashCommand(line, KNOWN)).toBeNull()
  })

  it('refuses a command this build does not offer', () => {
    // The known set comes from whatever claimed the composer spot, so a name is only
    // a command while something is there to run it.
    expect(resolveSlashCommand('/task Ship it', [])).toBeNull()
    expect(resolveSlashCommand('/task Ship it', ['mytasks'])).toBeNull()
  })

  it('accepts a tab between the command and its argument', () => {
    expect(resolveSlashCommand('/task\tShip it', KNOWN)).toEqual({ name: 'task', argument: 'Ship it' })
  })
})
