"use client"

import * as React from 'react'
import { Check, Languages } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { Input } from '@open-mercato/ui/primitives/input'
import { ISO_639_1, getIso639Label } from '@open-mercato/shared/lib/i18n/iso639'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

/**
 * The languages offered first.
 *
 * Not the interface locales: those are the languages the product is translated
 * INTO, which is a different question from the languages colleagues write to
 * each other in. French and Vietnamese have no interface translation and are
 * exactly the pairings this feature exists for, so they lead. Every other
 * ISO-639-1 language stays reachable by typing.
 */
const SUGGESTED = ['en', 'fr', 'vi', 'es', 'de', 'pl', 'ko'] as const

export type TranslateControlProps = {
  /** The language this reader reads chat in. */
  locale: string
  onLocaleChange: (locale: string) => void
  /**
   * What this deployment can translate into. Every language stays choosable;
   * the ones outside this are marked, so a reader learns before pressing rather
   * than after every press fails.
   */
  translatableLocales?: readonly string[]
  /** Whether the whole conversation is currently being shown translated. */
  active: boolean
  onToggle: (next: boolean) => void
  busy?: boolean
  disabled?: boolean
}

/**
 * Translate the conversation, and choose the language to translate into.
 *
 * One control rather than two: choosing a language is only ever done in order to
 * read something in it, so the choice lives where the reading happens instead of
 * in a settings screen nobody would find. The choice is remembered as this
 * person's chat language, so it is made once rather than per conversation.
 */
export function TranslateControl({
  locale,
  onLocaleChange,
  translatableLocales,
  active,
  onToggle,
  busy,
  disabled,
}: TranslateControlProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [filter, setFilter] = React.useState('')

  const options = React.useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) {
      return SUGGESTED.map((code) => ({ code, label: getIso639Label(code) ?? code }))
    }
    return ISO_639_1.filter(
      (entry) =>
        entry.label.toLowerCase().includes(needle) || entry.code.startsWith(needle),
    ).slice(0, 8)
  }, [filter])

  React.useEffect(() => {
    if (!open) setFilter('')
  }, [open])

  const label = getIso639Label(locale) ?? locale.toUpperCase()
  // An empty list means no engine is configured at all; marking all 183 as
  // unsupported would be noise on a deployment where the control is moot.
  const canTranslate = (code: string) =>
    !translatableLocales || translatableLocales.length === 0 || translatableLocales.includes(code)

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled || busy}
        // No `aria-pressed`. The label already carries the state, and the two
        // together announce "Show originals, pressed" — which reads as the
        // inverse of what is true.
        aria-live="polite"
        className={cn('gap-1.5', active ? 'text-primary' : 'text-muted-foreground')}
        onClick={() => onToggle(!active)}
      >
        <Languages className="size-4" aria-hidden="true" />
        <span>
          {busy
            ? t('chat.translation.translating', 'Translating…')
            : active
              ? t('chat.translation.showOriginals', 'Show originals')
              : t('chat.translation.translateAll', 'Translate')}
        </span>
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="px-1.5 text-muted-foreground"
            // Named with the current choice. "Choose translation language"
            // alone never told a screen-reader user what they are reading in,
            // and the code beside it is `aria-hidden` decoration.
            aria-label={t('chat.translation.chooseLanguageNamed', 'Reading chat in {language}. Choose another.', {
              language: label,
            })}
          >
            {/* The current language is shown rather than a chevron: the reader
                needs to know what "Translate" will produce before pressing it. */}
            <span className="text-xs font-medium uppercase">{locale}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-64 p-2"
          // Radix renders this as a dialog, and an unnamed dialog is announced
          // as just that. The heading below is the name a reader needs.
          aria-label={t('chat.translation.readIn', 'Read chat in')}
        >
          <p className="px-1 pb-2 text-overline font-semibold uppercase tracking-widest text-muted-foreground">
            {t('chat.translation.readIn', 'Read chat in')}
          </p>
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t('chat.translation.searchLanguage', 'Search languages…')}
            aria-label={t('chat.translation.searchLanguage', 'Search languages…')}
            className="mb-2 h-8"
          />
          <ul className="max-h-60 overflow-y-auto" role="listbox" aria-label={t('chat.translation.readIn', 'Read chat in')}>
            {options.length === 0 ? (
              <li className="px-2 py-2 text-xs text-muted-foreground">
                {t('chat.translation.noLanguage', 'No language matches that.')}
              </li>
            ) : (
              options.map((option) => (
                <li key={option.code} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.code === locale}
                    onClick={() => {
                      onLocaleChange(option.code)
                      setOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors',
                      'hover:bg-surface-muted focus-visible:shadow-focus',
                      option.code === locale ? 'font-medium text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <Check
                      className={cn('size-3.5 shrink-0', option.code === locale ? 'opacity-100' : 'opacity-0')}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                      {canTranslate(option.code) ? null : (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {t('chat.translation.notTranslatable', '(not translated here)')}
                        </span>
                      )}
                    </span>
                    {/* Sighted readers use the code to tell near-identical
                        language names apart. Spoken aloud it just runs into the
                        name -- "Englishen" -- so it is decoration here. */}
                    <span
                      className="shrink-0 text-xs uppercase text-muted-foreground"
                      aria-hidden="true"
                    >
                      {option.code}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
          <p className="px-1 pt-2 text-xs text-muted-foreground">
            {t(
              'chat.translation.localeHint',
              'Separate from your interface language.',
            )}
          </p>
        </PopoverContent>
      </Popover>
    </div>
  )
}
