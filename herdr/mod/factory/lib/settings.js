// The mod's settings: where it shows, the panel's sections (order and visibility), the alerts and the keys.
// Plain functions of their arguments: no call of the app is made here except through the functions a
// caller passes in (`createCustomize`), so vitest runs them (`test/herdr-mod-settings.test.ts`).
//
// The settings are one value, `shared("factory.settings")`, written with `setShared`: the panel, the Board
// tab and the Customize overlay are copies of the mod with different props, and `localStorage` is kept per
// set of props (`herdr/mod/findings.md`, question 12), so only `shared` gives the three one set of settings.

import { cardMessages } from './needs.js'

/** The key of the one shared value. */
export const SETTINGS_KEY = 'factory.settings'

/** The sections of the panel in the design's order; `needs` is the first. */
export const PANEL_ORDER = [
  'needs',
  'machine',
  'slots',
  'workers',
  'milestones',
  'stacks',
  'orphans',
]

/** What each section is called in Customize, and the line under it (`Customize.dc.html`). */
export const SECTION_INFO = /** @type {Record<string, [string, string]>} */ ({
  needs: ['Needs you', 'Decisions, sign-off with reports, held checks'],
  machine: ['Machine', 'Load, RAM, temperature, last 15 min'],
  slots: ['Heavy slots', 'Who runs a heavy command, who waits'],
  workers: ['Worker leases', 'The 6 workers across every master'],
  milestones: ['Milestones', 'Issues per space with their gates'],
  stacks: ['Stacks up', 'Compose projects and their owner'],
  orphans: ['Orphans', 'Processes under factory/tmp with no slot'],
})

/**
 * The alerts: the key of each in `settings.alerts`, its title and its line (`Customize.dc.html`).
 *
 * @type {[keyof Settings['alerts'], string, string][]}
 */
export const ALERTS = [
  ['needs', 'Something needs you', 'Desktop notification when an item enters Needs you'],
  ['saturated', 'Machine saturated', 'When the load stays above the core count for a minute'],
  ['held', 'Held or red gate', 'A check held by load, or a gate that turns red'],
  ['sound', 'Sound', 'A short tone with each notification'],
]

/** How long the 1-minute load stays above the core count before "Machine saturated" posts. */
export const SATURATED_MS = 60_000

/** The sound `playSound` plays with a notification: Herdr's own attention sound. */
const SOUND = 'blocked'

/** @typedef {{ panel: boolean, board: boolean, order: string[], hidden: string[], alerts: { needs: boolean, saturated: boolean, held: boolean, sound: boolean } }} Settings */

/** @returns {Settings} the defaults: both places on, the design's order, every section shown, Sound off. */
export function defaults() {
  return {
    panel: true,
    board: true,
    order: [...PANEL_ORDER],
    hidden: [],
    alerts: { needs: true, saturated: true, held: true, sound: false },
  }
}

/**
 * What a stored value reads back as. `null`, a missing field and a field of the wrong kind take their
 * default; an unknown section or alert is dropped; a section the order lacks goes at the end.
 *
 * @param {unknown} stored `shared("factory.settings")`
 * @returns {Settings}
 */
export function readSettings(stored) {
  const base = defaults()
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return base
  const value = /** @type {Record<string, unknown>} */ (stored)
  const order = Array.isArray(value['order'])
    ? /** @type {string[]} */ (value['order']).filter(
        (/** @type {string} */ k, /** @type {number} */ i, /** @type {string[]} */ all) => {
          return PANEL_ORDER.includes(k) && all.indexOf(k) === i
        }
      )
    : []
  const alerts = /** @type {Record<string, unknown>} */ (
    value['alerts'] !== null && typeof value['alerts'] === 'object' ? value['alerts'] : {}
  )
  return {
    panel: typeof value['panel'] === 'boolean' ? value['panel'] : base.panel,
    board: typeof value['board'] === 'boolean' ? value['board'] : base.board,
    order: [...order, ...PANEL_ORDER.filter((k) => !order.includes(k))],
    hidden: Array.isArray(value['hidden'])
      ? /** @type {string[]} */ (value['hidden']).filter(
          (/** @type {string} */ k, /** @type {number} */ i, /** @type {string[]} */ all) =>
            PANEL_ORDER.includes(k) && all.indexOf(k) === i
        )
      : base.hidden,
    alerts: {
      needs: typeof alerts['needs'] === 'boolean' ? alerts['needs'] : base.alerts.needs,
      saturated:
        typeof alerts['saturated'] === 'boolean' ? alerts['saturated'] : base.alerts.saturated,
      held: typeof alerts['held'] === 'boolean' ? alerts['held'] : base.alerts.held,
      sound: typeof alerts['sound'] === 'boolean' ? alerts['sound'] : base.alerts.sound,
    },
  }
}

/**
 * The order with `name` moved one place (`-1` up, `1` down); it stays where it is at an end.
 *
 * @param {Settings} settings
 * @param {string} name
 * @param {-1 | 1} by
 * @returns {Settings}
 */
export function moveSection(settings, name, by) {
  const at = settings.order.indexOf(name)
  const to = at + by
  if (at === -1 || to < 0 || to >= settings.order.length) return settings
  const order = [...settings.order]
  ;[order[at], order[to]] = /** @type {[string, string]} */ ([order[to], order[at]])
  return { ...settings, order }
}

/** @param {Settings} settings @param {string} name @returns {Settings} `name` shown if hidden, hidden if shown. */
export function toggleSection(settings, name) {
  if (!PANEL_ORDER.includes(name)) return settings
  return {
    ...settings,
    hidden: settings.hidden.includes(name)
      ? settings.hidden.filter((k) => k !== name)
      : [...settings.hidden, name],
  }
}

/** @param {Settings} settings @param {string} name @returns {Settings} one alert switched. */
export function toggleAlert(settings, name) {
  if (!(name in settings.alerts)) return settings
  const key = /** @type {keyof Settings['alerts']} */ (name)
  return { ...settings, alerts: { ...settings.alerts, [key]: !settings.alerts[key] } }
}

/**
 * The sections the panel draws, in the maintainer's order: a hidden one is gone, except "Needs you" while
 * something waits, which collapses to a count.
 *
 * @param {Settings} settings
 * @param {number} needsCount the cards of Needs you now
 * @returns {{ name: string, collapsed: boolean }[]}
 */
export function panelSections(settings, needsCount) {
  return settings.order.flatMap(
    /** @returns {{ name: string, collapsed: boolean }[]} */ (name) => {
      if (!settings.hidden.includes(name)) return [{ name, collapsed: false }]
      return name === 'needs' && needsCount > 0 ? [{ name, collapsed: true }] : []
    }
  )
}

/** @param {Settings} settings @returns {string} "5/7": the sections shown over all of them. */
export function shownCount(settings) {
  return `${settings.order.filter((k) => !settings.hidden.includes(k)).length}/${settings.order.length}`
}

/**
 * What `redSections` and `heldOrRed` read of `buildPanel(...).sections`.
 *
 * @typedef {object} SectionsLook
 * @property {{ saturated?: boolean }} [machine]
 * @property {{ spaces?: { name?: string, issues: { number?: number, id?: unknown, marks: string[] }[] }[] }} [milestones]
 * @property {{ error?: unknown }} [stacks]
 * @property {{ rows?: unknown[] }} [orphans]
 */

/**
 * The sections of a panel description that are red now: the machine saturated, a gate that is red in
 * Milestones, an orphan, and a stack list that cannot be read.
 *
 * @param {SectionsLook} sections `buildPanel(...).sections`
 * @returns {string[]}
 */
function redSections(sections) {
  /** @type {string[]} */
  const red = []
  if (sections.machine?.saturated === true) red.push('machine')
  if (
    (sections.milestones?.spaces ?? []).some((s) => s.issues.some((i) => i.marks.includes('red')))
  )
    red.push('milestones')
  if (sections.stacks?.error != null) red.push('stacks')
  if ((sections.orphans?.rows ?? []).length > 0) red.push('orphans')
  return red
}

/**
 * Whether the header turns red for a section that the maintainer hid: the docked panel has no tab of its
 * own, so the header is where the design's "lights the Factory tab" shows.
 *
 * @param {Settings} settings
 * @param {SectionsLook} sections `buildPanel(...).sections`
 */
export function headerRed(settings, sections) {
  return redSections(sections).some((name) => settings.hidden.includes(name))
}

/**
 * Posts a notification when its alert is on, and plays the sound once with it when Sound is on. Nothing
 * is posted, and no sound plays, while the alert is off; Sound never plays on its own.
 *
 * @param {object} deps
 * @param {(n: Parameters<typeof import('herdr').notify>[0]) => unknown} deps.notify
 * @param {(sound: string) => unknown} deps.playSound
 * @returns {(settings: Settings, alert: 'needs' | 'saturated' | 'held', notification: Parameters<typeof import('herdr').notify>[0]) => boolean}
 */
export function createPoster({ notify, playSound }) {
  return (settings, alert, notification) => {
    if (!settings.alerts[alert]) return false
    notify(notification)
    if (settings.alerts.sound) playSound(SOUND)
    return true
  }
}

/**
 * "Machine saturated": true once when the 1-minute load has been above the core count for a minute, and
 * not again until it has fallen to the core count or below.
 *
 * @returns {(load: number | null, cores: number, now: number) => boolean}
 */
export function createSaturation() {
  /** @type {number | null} */
  let since = null
  let posted = false
  return (load, cores, now) => {
    if (load === null || cores <= 0 || load <= cores) {
      since = null
      posted = false
      return false
    }
    since ??= now
    if (posted || now - since < SATURATED_MS) return false
    posted = true
    return true
  }
}

/**
 * The held checks and the red gates of a look: the key of each, `held:<card key>` for a card of "Needs
 * you" that is a held check and `red:<space>#<n>` (`red:<space> owner/repo#<n>` for an issue of another
 * repository of the space) for an issue of Milestones whose gate is red.
 *
 * @param {{ kind: string, key?: string }[]} cards `buildNeeds(...).cards`
 * @param {SectionsLook} sections `buildPanel(...).sections`
 * @returns {Set<string>}
 */
export function heldOrRed(cards, sections) {
  const keys = new Set()
  for (const card of cards) if (card.kind === 'held') keys.add(`held:${card.key}`)
  for (const space of sections.milestones?.spaces ?? [])
    for (const issue of space.issues)
      if (issue.marks.includes('red')) {
        // `#N` in the space's repository, `owner/repo#N` (its row's `id`) in another.
        const ref = typeof issue.id === 'string' ? issue.id : `#${issue.number}`
        keys.add(`red:${space.name}${ref.startsWith('#') ? '' : ' '}${ref}`)
      }
  return keys
}

/**
 * The keys of a look that the last look did not have. The first look has none: what was there when the
 * panel started is not new.
 *
 * @returns {(keys: Set<string>) => string[]}
 */
export function createLook() {
  /** @type {Set<string> | null} */
  let last = null
  return (keys) => {
    const fresh = last === null ? [] : [...keys].filter((k) => !last?.has(k))
    last = keys
    return fresh
  }
}

/** The keys of the panel: its id, the default letter, what it does, and the command that can replace the letter. */
const KEYS = [
  { id: 'next', letter: 'N', label: 'next pending', command: 'factory.next' },
  { id: 'sign', letter: 'S', label: 'sign off', command: null },
  { id: 'pause', letter: 'P', label: 'pause workers', command: null },
  { id: 'reserve', letter: 'R', label: 'reserve a slot', command: null },
  { id: 'log', letter: 'L', label: 'log a correction', command: 'factory.log' },
  { id: 'board', letter: 'B', label: 'open the board', command: 'factory.board' },
]

/**
 * The key map from Herdr's `keys()`. A `mod:factory` binding of a command replaces the default letter of
 * its key: the letter then does nothing, and `shown` is the key that acts. S, P and R are no command and
 * cannot be rebound.
 *
 * @param {{ section: string, keys: string, action: string }[]} bindings
 * @returns {{ id: string, letter: string, label: string, rebound: string | null, shown: string, command: string | null }[]}
 */
export function keyMap(bindings) {
  return KEYS.map((key) => {
    const bound =
      key.command === null
        ? undefined
        : bindings.find((b) => b.section === 'mod:factory' && b.action === key.command)
    return {
      id: key.id,
      letter: key.letter,
      label: key.label,
      command: key.command,
      rebound: bound?.keys ?? null,
      shown: bound?.keys ?? key.letter,
    }
  })
}

/**
 * The action a key press of the focused panel runs: the id of a key of `keyMap` whose letter is that key
 * and that no `mod:factory` binding replaced, else `null`. Modifiers make it no key of the panel.
 *
 * @param {{ key: string, ctrl?: boolean, alt?: boolean, shift?: boolean, meta?: boolean }} press
 * @param {ReturnType<typeof keyMap>} map
 * @returns {string | null}
 */
export function keyAction(press, map) {
  if (press.ctrl === true || press.alt === true || press.meta === true) return null
  const letter = press.key.toUpperCase()
  const entry = map.find((k) => k.letter === letter)
  return entry === undefined || entry.rebound !== null ? null : entry.id
}

/**
 * The card `S` signs off: the oldest sign-off card whose button would send something. A locked sign-off,
 * an invalid time form and a space with no master send nothing (`cardMessages`), and `S` is the card's
 * button, so it sends nothing either.
 *
 * @template {{ kind: string }} C
 * @param {C[]} cards `buildNeeds(...).cards`, oldest first
 * @returns {C | null}
 */
export function signOffCard(cards) {
  const card = cards.find((c) => c.kind === 'signoff')
  return card !== undefined && cardMessages(card).length > 0 ? card : null
}

/**
 * The calls of Customize's switches, through the functions a caller passes in. "Side panel" runs
 * `layout.hide` or `layout.show` of `factory`, "Board tab" `tab.new` or `tab.close`; the rest of the
 * settings go to `setShared`. With a fixture none of them is called: the change is kept in memory.
 *
 * @param {object} deps
 * @param {(name: string, args: Record<string, unknown>) => unknown} deps.run
 * @param {(key: string, value: unknown) => unknown} deps.setShared
 * @param {() => unknown[]} deps.panes each a `ModPane`
 * @param {() => unknown} deps.props the props of this copy of the mod
 * @param {() => unknown} deps.shared `shared("factory.settings")`
 * @param {boolean} deps.fixture
 */
export function createCustomize({ run, setShared, panes, props, shared, fixture }) {
  /** @type {Settings | null} */
  let memory = null
  const current = () => memory ?? readSettings(shared())
  /** @param {Settings | null} next */
  const store = (next) => {
    if (fixture) memory = next === null ? defaults() : next
    else setShared(SETTINGS_KEY, next)
  }
  return {
    settings: current,
    /** @param {(s: Settings) => Settings} change */
    change(change) {
      store(change(current()))
    },
    /** "Restore defaults": the stored value is `null`, which reads back as the defaults. */
    restore() {
      store(null)
    },
    /** @param {boolean} on */
    panel(on) {
      store({ ...current(), panel: on })
      if (!fixture) run(on ? 'layout.show' : 'layout.hide', { id: 'factory' })
    },
    /** @param {boolean} on */
    board(on) {
      if (!fixture) {
        const open = boardTabs(panes())
        if (on && open.length === 0) openBoardTab(run, props, panes)
        if (!on) for (const tab of open) run('tab.close', { id: tab, confirmed: true })
      }
      const next = current()
      if (next.board !== on) store({ ...next, board: on })
    },
  }
}

/**
 * What the mod reads of a pane of `panes()`.
 *
 * @typedef {{ mod?: string, name?: string | null, focused?: boolean, pane?: string, tab?: string }} ModPane
 */

/** The name `pane.rename` gives the pane of a Board tab the mod opened: `PaneInfo` has no `props`. */
export const BOARD_PANE = 'factory-board'

/**
 * The props a copy of the mod hands to the one it opens: its own without what only an overlay carries
 * (`overlay`, `customize`, `detail`, `log`) and without `board`, which the caller sets.
 *
 * @param {unknown} raw `props()`
 * @returns {Record<string, unknown>}
 */
export function baseProps(raw) {
  const { overlay, customize, detail, log, board, ...rest } =
    /** @type {Record<string, unknown>} */ (raw ?? {})
  void [overlay, customize, detail, log, board]
  return rest
}

/**
 * Opens a Board tab: `tab.new` with `board` in the props, then `pane.rename` of the pane it focused (found in
 * `panes()` and renamed by its id), so that `boardTabs` can tell it from any other pane of this mod.
 *
 * @param {(name: string, args: Record<string, unknown>) => unknown} run
 * @param {() => unknown} props the props of this copy of the mod
 * @param {() => unknown[]} panes `panes()`, each a `ModPane`
 */
export function openBoardTab(run, props, panes) {
  run('tab.new', { name: 'Board', mod: 'factory', props: { ...baseProps(props()), board: true } })
  // The new pane is the focused pane of this mod that no one named. When there is none (`tab.new` failed),
  // nothing is renamed: a rename without a `pane` would name whatever pane has the focus.
  const fresh = /** @type {ModPane[]} */ (panes()).find(
    (p) => p.focused === true && p.mod === 'factory' && p.name === null
  )
  if (fresh !== undefined) run('pane.rename', { pane: fresh.pane, name: BOARD_PANE })
}

/**
 * The tabs of the Board panes this mod opened: a pane of this mod that `pane.rename` named `factory-board`
 * (`PaneInfo` has `mod` and `name`, no `props`).
 *
 * @param {unknown[]} panes `panes()`, each a `ModPane`
 * @returns {string[]} the tab ids, each once
 */
export function boardTabs(panes) {
  return [
    ...new Set(
      /** @type {ModPane[]} */ (panes)
        .filter((p) => p.mod === 'factory' && p.name === BOARD_PANE)
        .map((p) => /** @type {string} */ (p.tab))
    ),
  ]
}
