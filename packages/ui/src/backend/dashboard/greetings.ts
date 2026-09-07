import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export type GreetingSlot = 'morning' | 'afternoon' | 'evening' | 'night'

export type Greeting = {
  key: string
  text: string
}

const MORNING_START_HOUR = 5
const AFTERNOON_START_HOUR = 12
const EVENING_START_HOUR = 17
const NIGHT_START_HOUR = 22

export function resolveGreetingSlot(hour: number): GreetingSlot {
  if (!Number.isFinite(hour)) return 'morning'
  const normalized = ((Math.trunc(hour) % 24) + 24) % 24
  if (normalized >= NIGHT_START_HOUR || normalized < MORNING_START_HOUR) return 'night'
  if (normalized < AFTERNOON_START_HOUR) return 'morning'
  if (normalized < EVENING_START_HOUR) return 'afternoon'
  return 'evening'
}

// Every `key` here must exist in the app dictionaries next to `dashboard.title`;
// the `text` beside it is only the English fallback used when one is missing.
export const GREETINGS: Record<GreetingSlot, readonly Greeting[]> = {
  morning: [
    { key: 'dashboard.greetings.morning.1', text: 'Good morning, {{user}}.' },
    { key: 'dashboard.greetings.morning.2', text: 'Rise and shine, {{user}} — the day is still unwritten.' },
    { key: 'dashboard.greetings.morning.3', text: 'Morning, {{user}}. Coffee first, decisions second.' },
    { key: 'dashboard.greetings.morning.4', text: 'New day, clean slate. Good morning, {{user}}.' },
    { key: 'dashboard.greetings.morning.5', text: "Good morning, {{user}} — let's make it a good one." },
    { key: 'dashboard.greetings.morning.6', text: 'Up early, {{user}}? The quiet hours are the productive ones.' },
  ],
  afternoon: [
    { key: 'dashboard.greetings.afternoon.1', text: 'Good afternoon, {{user}}.' },
    { key: 'dashboard.greetings.afternoon.2', text: 'Afternoon, {{user}}. Halfway there and still standing.' },
    { key: 'dashboard.greetings.afternoon.3', text: 'Back at it, {{user}}? Good afternoon.' },
    { key: 'dashboard.greetings.afternoon.4', text: 'Good afternoon, {{user}} — plenty of daylight left.' },
    { key: 'dashboard.greetings.afternoon.5', text: 'Second wind, right on schedule. Afternoon, {{user}}.' },
    { key: 'dashboard.greetings.afternoon.6', text: "Good afternoon, {{user}}. Let's keep the momentum." },
  ],
  evening: [
    { key: 'dashboard.greetings.evening.1', text: 'Good evening, {{user}}.' },
    { key: 'dashboard.greetings.evening.2', text: 'Evening, {{user}}. Time to tie up the loose ends.' },
    { key: 'dashboard.greetings.evening.3', text: 'Good evening, {{user}} — the hard part is behind you.' },
    { key: 'dashboard.greetings.evening.4', text: 'Winding down, {{user}}? Good evening.' },
    { key: 'dashboard.greetings.evening.5', text: "Evening, {{user}}. Whatever's left can probably wait." },
    { key: 'dashboard.greetings.evening.6', text: 'Good evening, {{user}}. Nice work today.' },
  ],
  night: [
    { key: 'dashboard.greetings.night.1', text: "Still up, {{user}}? The dashboard doesn't sleep either." },
    { key: 'dashboard.greetings.night.2', text: 'Burning the midnight oil, {{user}}.' },
    { key: 'dashboard.greetings.night.3', text: "Late shift, {{user}}. Let's keep it short." },
    { key: 'dashboard.greetings.night.4', text: 'Quiet hours, {{user}} — the best time to think.' },
    { key: 'dashboard.greetings.night.5', text: 'Working late, {{user}}? Remember to log off eventually.' },
    { key: 'dashboard.greetings.night.6', text: 'Night owl mode, {{user}}. Welcome back.' },
  ],
}

export function pickGreeting(slot: GreetingSlot, roll: number): Greeting {
  const pool = GREETINGS[slot]
  const safeRoll = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 1) : 0
  return pool[Math.min(pool.length - 1, Math.floor(safeRoll * pool.length))]
}

export function pickGreetingForNow(): Greeting {
  return pickGreeting(resolveGreetingSlot(new Date().getHours()), Math.random())
}

export function formatGreeting(greeting: Greeting, greetedName: string, translate: TranslateFn): string {
  return translate(greeting.key, greeting.text, { user: greetedName })
}

// Deliberately never falls back to the layout context's `userLabel`: that one degrades
// to the raw user id, and greeting somebody by their UUID is worse than not greeting.
export function resolveGreetedName(
  userName: string | null | undefined,
  userEmail: string | null | undefined,
): string {
  const name = userName?.trim()
  if (name) return name
  const email = userEmail?.trim()
  if (!email) return ''
  return email.split('@')[0] ?? ''
}
