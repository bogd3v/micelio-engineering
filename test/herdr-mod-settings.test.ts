import { describe, expect, it } from 'vitest'
import {
  baseProps,
  BOARD_PANE,
  boardTabs,
  createCustomize,
  createLook,
  createPoster,
  createSaturation,
  defaults,
  headerRed,
  heldOrRed,
  keyAction,
  keyMap,
  moveSection,
  openBoardTab,
  PANEL_ORDER,
  panelSections,
  readSettings,
  SATURATED_MS,
  SETTINGS_KEY,
  shownCount,
  signOffCard,
  toggleAlert,
  toggleSection,
  // @ts-expect-error a plain JavaScript module of the mod, with no declarations
} from '../herdr/mod/factory/lib/settings.js'

/** The pane `tab.new` just opened and focused, as `PaneInfo` gives it (no `props`). */
const NEW_PANE = {
  pane: 'p9',
  terminal: null,
  mod: 'factory',
  tab: 't9',
  title: 'factory',
  name: null,
  focused: true,
}

const names = (list: { name: string }[]) => list.map((s) => s.name)

/** The functions of the app that Customize calls, as recorders. */
function stubs(
  over: { fixture?: boolean; stored?: unknown; panes?: unknown[]; props?: unknown } = {}
) {
  const calls: [string, ...unknown[]][] = []
  let stored: unknown = over.stored ?? null
  const customizer = createCustomize({
    run: (name: string, args: unknown) => calls.push(['run', name, args]),
    setShared: (key: string, value: unknown) => {
      calls.push(['setShared', key, value])
      stored = value
    },
    panes: () => over.panes ?? [],
    props: () => over.props ?? { spaces: [], side: 'right' },
    shared: () => stored,
    fixture: over.fixture ?? false,
  })
  return { calls, customizer }
}

describe('the settings of the panel', () => {
  it("moving a section changes the panel's order, and hiding it removes it", () => {
    const up = moveSection(defaults(), 'machine', -1)
    expect(names(panelSections(up, 0))).toEqual([
      'machine',
      'needs',
      'slots',
      'workers',
      'milestones',
      'stacks',
      'orphans',
    ])
    expect(up.order.slice(0, 3)).toEqual(['machine', 'needs', 'slots'])
    // The first cannot go up and the last cannot go down.
    expect(moveSection(defaults(), 'needs', -1)).toEqual(defaults())
    expect(moveSection(defaults(), 'orphans', 1)).toEqual(defaults())
    const down = moveSection(up, 'machine', 1)
    expect(down.order).toEqual(PANEL_ORDER)
    const hidden = toggleSection(up, 'slots')
    expect(names(panelSections(hidden, 0))).toEqual([
      'machine',
      'needs',
      'workers',
      'milestones',
      'stacks',
      'orphans',
    ])
    expect(names(panelSections(toggleSection(hidden, 'slots'), 0))).toContain('slots')
    expect(shownCount(hidden)).toBe('6/7')
    expect(shownCount(defaults())).toBe('7/7')
  })

  it('Needs you hidden with something waiting is a count, not gone', () => {
    const hidden = toggleSection(defaults(), 'needs')
    expect(panelSections(hidden, 3)[0]).toEqual({ name: 'needs', collapsed: true })
    expect(panelSections(hidden, 0).some((s: { name: string }) => s.name === 'needs')).toBe(false)
    expect(panelSections(defaults(), 3)[0]).toEqual({ name: 'needs', collapsed: false })
    // Another section hidden is gone whatever waits.
    expect(names(panelSections(toggleSection(defaults(), 'machine'), 3))).not.toContain('machine')
  })

  it('a hidden section that turns red still turns the header red', () => {
    const red = { machine: { saturated: true }, orphans: { rows: [] }, stacks: { error: null } }
    const calm = { machine: { saturated: false }, orphans: { rows: [] }, stacks: { error: null } }
    expect(headerRed(toggleSection(defaults(), 'machine'), red)).toBe(true)
    // A shown red section draws itself red; the header does not repeat it.
    expect(headerRed(defaults(), red)).toBe(false)
    expect(headerRed(toggleSection(defaults(), 'machine'), calm)).toBe(false)
    const gate = {
      machine: { saturated: false },
      milestones: { spaces: [{ issues: [{ marks: ['passed', 'red'] }] }] },
    }
    expect(headerRed(toggleSection(defaults(), 'milestones'), gate)).toBe(true)
    const orphan = { orphans: { rows: [{ pid: 1 }] } }
    expect(headerRed(toggleSection(defaults(), 'orphans'), orphan)).toBe(true)
  })

  it('an alert that is off posts no notification, and Sound plays once with each one posted', () => {
    const notifications: unknown[] = []
    const sounds: string[] = []
    const post = createPoster({
      notify: (n: unknown) => notifications.push(n),
      playSound: (s: string) => sounds.push(s),
    })
    const note = { title: 'Needs you' }
    // Sound off: a notification, no sound.
    expect(post(defaults(), 'needs', note)).toBe(true)
    expect(notifications).toHaveLength(1)
    expect(sounds).toEqual([])
    // The alert off: nothing at all, Sound or not.
    const sound = toggleAlert(defaults(), 'sound')
    expect(post(toggleAlert(sound, 'needs'), 'needs', note)).toBe(false)
    expect(notifications).toHaveLength(1)
    expect(sounds).toEqual([])
    // Sound on: once with each notification posted, and a different alert posts on its own.
    expect(post(sound, 'needs', note)).toBe(true)
    expect(post(sound, 'held', note)).toBe(true)
    expect(notifications).toHaveLength(3)
    expect(sounds).toHaveLength(2)
    // Sound never plays on its own.
    expect(post(toggleAlert(toggleAlert(sound, 'held'), 'saturated'), 'held', note)).toBe(false)
    expect(post(toggleAlert(sound, 'saturated'), 'saturated', note)).toBe(false)
    expect(sounds).toHaveLength(2)
  })

  it('a saturated minute and a new held or red gate each post one notification', () => {
    const saturated = createSaturation()
    const T = 1_000_000
    expect(saturated(40, 32, T)).toBe(false)
    expect(saturated(41, 32, T + SATURATED_MS - 1)).toBe(false)
    expect(saturated(41, 32, T + SATURATED_MS)).toBe(true)
    // Once: not again while it stays above.
    expect(saturated(41, 32, T + 2 * SATURATED_MS)).toBe(false)
    // A dip to the core count resets it, and another minute posts again.
    expect(saturated(32, 32, T + 3 * SATURATED_MS)).toBe(false)
    expect(saturated(50, 32, T + 4 * SATURATED_MS)).toBe(false)
    expect(saturated(50, 32, T + 5 * SATURATED_MS)).toBe(true)
    // A load that was never read, or no cores, is no saturation.
    const none = createSaturation()
    expect(none(null, 32, T)).toBe(false)
    expect(none(50, 0, T + 2 * SATURATED_MS)).toBe(false)

    const sections = (marks: string[]) => ({
      milestones: { spaces: [{ name: 'a', issues: [{ number: 7, marks }] }] },
    })
    const look = createLook()
    const held = { kind: 'held', key: 'held:a#7:G3' }
    // The first look posts none: what was there at the start is not new.
    expect(look(heldOrRed([held], sections(['passed', 'red'])))).toEqual([])
    expect(look(heldOrRed([held], sections(['passed', 'red'])))).toEqual([])
    expect(
      look(heldOrRed([held, { kind: 'held', key: 'held:a#8:G3' }], sections(['passed'])))
    ).toEqual(['held:held:a#8:G3'])
    expect(look(heldOrRed([], sections(['passed', 'red'])))).toEqual(['red:a#7'])
    // A card that is not a held check is not one.
    expect(heldOrRed([{ kind: 'signoff', key: 'k' }], sections([]))).toEqual(new Set())
  })

  it('a stored value reads back as the settings saved, an unknown field takes its default, and null is the defaults', () => {
    expect(readSettings(null)).toEqual(defaults())
    expect(readSettings(undefined)).toEqual(defaults())
    expect(readSettings('nonsense')).toEqual(defaults())
    expect(readSettings([])).toEqual(defaults())
    let saved = moveSection(defaults(), 'orphans', -1)
    saved = toggleSection(toggleAlert(saved, 'sound'), 'stacks')
    saved = { ...saved, panel: false, board: false }
    expect(readSettings(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
    // A missing field, a field of the wrong kind and an unknown one take their default.
    expect(readSettings({ panel: false })).toEqual({ ...defaults(), panel: false })
    expect(readSettings({ board: 'yes', alerts: { sound: 1, held: false, other: true } })).toEqual({
      ...defaults(),
      alerts: { ...defaults().alerts, held: false },
    })
    // An unknown or repeated section is dropped, and one the order lacks goes last.
    const odd = readSettings({
      order: ['stacks', 'nope', 'stacks', 'needs'],
      hidden: ['nope', 'slots'],
    })
    expect(odd.order).toEqual([
      'stacks',
      'needs',
      'machine',
      'slots',
      'workers',
      'milestones',
      'orphans',
    ])
    expect(odd.hidden).toEqual(['slots'])
  })

  it('S on a locked sign-off sends nothing', () => {
    const locked = { kind: 'signoff', locked: true, lines: null, master: 'tfix-master' }
    const open = {
      kind: 'signoff',
      locked: false,
      lines: 'approved, sign off #9',
      master: 'tfix-master',
    }
    const none = { kind: 'signoff', locked: false, lines: 'approved, sign off #9', master: null }
    expect(signOffCard([locked])).toBeNull()
    // The oldest sign-off decides: S signs off what that card's button would, never a later one.
    expect(signOffCard([locked, open])).toBeNull()
    expect(signOffCard([none])).toBeNull()
    expect(signOffCard([{ kind: 'decision' }])).toBeNull()
    expect(signOffCard([])).toBeNull()
    expect(signOffCard([{ kind: 'decision' }, open])).toBe(open)
  })

  it('a mod:factory binding replaces the default letter of N, L and B, and S, P and R are no command', () => {
    const map = keyMap([])
    const letters = map.map((k: { letter: string; shown: string }) => `${k.letter}${k.shown}`)
    expect(letters).toEqual(['NN', 'SS', 'PP', 'RR', 'LL', 'BB'])
    expect(keyAction({ key: 'n' }, map)).toBe('next')
    expect(keyAction({ key: 'S' }, map)).toBe('sign')
    expect(keyAction({ key: 'p' }, map)).toBe('pause')
    expect(keyAction({ key: 'r' }, map)).toBe('reserve')
    expect(keyAction({ key: 'l' }, map)).toBe('log')
    expect(keyAction({ key: 'b' }, map)).toBe('board')
    expect(keyAction({ key: 'x' }, map)).toBeNull()
    expect(keyAction({ key: 'n', ctrl: true }, map)).toBeNull()
    const rebound = keyMap([
      { section: 'mod:factory', keys: 'alt-n', action: 'factory.next' },
      { section: 'mod:factory', keys: 'alt-l', action: 'factory.log' },
      { section: 'mod:factory', keys: 'alt-b', action: 'factory.board' },
      // S, P and R are no command: a binding of one is not read, and the letter stays.
      { section: 'mod:factory', keys: 'alt-s', action: 'factory.sign' },
      { section: 'mod:factory', keys: 'alt-p', action: 'factory.pause' },
      { section: 'mod:factory', keys: 'alt-r', action: 'factory.reserve' },
      // Another section's binding of the command does not count.
      { section: 'global', keys: 'alt-x', action: 'factory.next' },
    ])
    const shown = Object.fromEntries(
      rebound.map((k: { id: string; shown: string }) => [k.id, k.shown])
    )
    expect(shown).toEqual({
      next: 'alt-n',
      sign: 'S',
      pause: 'P',
      reserve: 'R',
      log: 'alt-l',
      board: 'alt-b',
    })
    // The letter of a rebound key does nothing; the others still act.
    expect(keyAction({ key: 'n' }, rebound)).toBeNull()
    expect(keyAction({ key: 'l' }, rebound)).toBeNull()
    expect(keyAction({ key: 'b' }, rebound)).toBeNull()
    expect(keyAction({ key: 's' }, rebound)).toBe('sign')
    expect(keyAction({ key: 'p' }, rebound)).toBe('pause')
    expect(keyAction({ key: 'r' }, rebound)).toBe('reserve')
  })

  it('the side panel switch runs layout.hide or layout.show of factory, and the Board switch tab.new or tab.close, and nothing else', () => {
    const { calls, customizer } = stubs({
      panes: [
        { pane: 'p1', tab: 'tab-a', mod: 'factory', name: BOARD_PANE, terminal: null },
        { pane: 'p2', tab: 'tab-a', mod: 'factory', name: BOARD_PANE, terminal: null },
        { pane: 'p3', tab: 'tab-b', mod: 'factory', name: null, terminal: null },
        { pane: 'p4', tab: 'tab-c', mod: 'files', name: BOARD_PANE, terminal: null },
        { pane: 'p5', tab: 'tab-d', name: BOARD_PANE, terminal: 't1' },
      ],
    })
    customizer.panel(false)
    customizer.panel(true)
    customizer.board(false)
    expect(calls).toEqual([
      ['setShared', SETTINGS_KEY, { ...defaults(), panel: false }],
      ['run', 'layout.hide', { id: 'factory' }],
      ['setShared', SETTINGS_KEY, defaults()],
      ['run', 'layout.show', { id: 'factory' }],
      ['run', 'tab.close', { id: 'tab-a', confirmed: true }],
      ['setShared', SETTINGS_KEY, { ...defaults(), board: false }],
    ])
    // Switched on with a Board tab open: no second tab. With none open: one, with `board` in its props.
    const open = stubs({
      stored: { board: false },
      panes: [{ pane: 'p1', tab: 'tab-a', mod: 'factory', name: BOARD_PANE, terminal: null }],
    })
    open.customizer.board(true)
    expect(open.calls.map((c) => c[1])).toEqual([SETTINGS_KEY])
    const shut = stubs({ stored: { board: false }, panes: [NEW_PANE] })
    shut.customizer.board(true)
    expect(shut.calls).toEqual([
      [
        'run',
        'tab.new',
        { name: 'Board', mod: 'factory', props: { spaces: [], side: 'right', board: true } },
      ],
      ['run', 'pane.rename', { pane: 'p9', name: BOARD_PANE }],
      ['setShared', SETTINGS_KEY, defaults()],
    ])
    // Order, visibility, alerts and Restore go to setShared and nothing else; Restore stores null.
    const rest = stubs()
    rest.customizer.change((s: ReturnType<typeof defaults>) => moveSection(s, 'machine', -1))
    rest.customizer.change((s: ReturnType<typeof defaults>) => toggleSection(s, 'orphans'))
    rest.customizer.change((s: ReturnType<typeof defaults>) => toggleAlert(s, 'sound'))
    rest.customizer.restore()
    expect(rest.calls.map((c) => c[0])).toEqual([
      'setShared',
      'setShared',
      'setShared',
      'setShared',
    ])
    expect(rest.calls[3]).toEqual(['setShared', SETTINGS_KEY, null])
    expect(rest.customizer.settings()).toEqual(defaults())

    // B2: the Board tab does not carry what only the Customize overlay's copy has.
    const overlay = stubs({
      stored: { board: false },
      panes: [NEW_PANE],
      props: {
        spaces: [],
        customize: true,
        overlay: 'o1',
        detail: { number: 1 },
        log: {},
        board: false,
      },
    })
    overlay.customizer.board(true)
    expect(overlay.calls[0]).toEqual([
      'run',
      'tab.new',
      { name: 'Board', mod: 'factory', props: { spaces: [], board: true } },
    ])
    const opened: unknown[][] = []
    openBoardTab(
      (name: string, args: unknown) => opened.push([name, args]),
      () => ({ customize: true, spaces: [] }),
      () => [NEW_PANE]
    )
    expect(opened).toEqual([
      ['tab.new', { name: 'Board', mod: 'factory', props: { spaces: [], board: true } }],
      ['pane.rename', { pane: 'p9', name: BOARD_PANE }],
    ])
    // S1: the new pane is the focused, unnamed pane of this mod, renamed by its id. With none, nothing is
    // renamed (a rename with no pane would name whatever has the focus), and a Board switched on again later
    // finds no tab of ours to close.
    const nothing = (panes: unknown[]) => {
      const calls: unknown[][] = []
      openBoardTab(
        (name: string, args: unknown) => calls.push([name, args]),
        () => ({}),
        () => panes
      )
      return calls.map((c) => c[0])
    }
    expect(nothing([])).toEqual(['tab.new'])
    expect(nothing([{ ...NEW_PANE, focused: false }])).toEqual(['tab.new'])
    expect(nothing([{ ...NEW_PANE, name: 'mine' }])).toEqual(['tab.new'])
    expect(nothing([{ ...NEW_PANE, mod: undefined, terminal: 't1' }])).toEqual(['tab.new'])
    expect(nothing([NEW_PANE])).toEqual(['tab.new', 'pane.rename'])
    expect(baseProps(null)).toEqual({})
    // A Board pane is the pane of this mod that pane.rename named; an unnamed pane of this mod is the docked panel.
    expect(boardTabs([{ pane: 'p', tab: 't', mod: 'factory', name: null }])).toEqual([])
  })

  it('with a fixture, Customize stores nothing and runs nothing', () => {
    const { calls, customizer } = stubs({
      fixture: true,
      panes: [{ pane: 'p1', tab: 'tab-a', mod: 'factory', name: BOARD_PANE, terminal: null }],
    })
    customizer.panel(false)
    customizer.board(false)
    customizer.change((s: ReturnType<typeof defaults>) => toggleAlert(s, 'sound'))
    customizer.change((s: ReturnType<typeof defaults>) => moveSection(s, 'orphans', -1))
    // It shows the change, in memory.
    const shown = customizer.settings()
    expect(shown.panel).toBe(false)
    expect(shown.board).toBe(false)
    expect(shown.alerts.sound).toBe(true)
    expect(shown.order.indexOf('orphans')).toBe(5)
    customizer.restore()
    expect(customizer.settings()).toEqual(defaults())
    expect(calls).toEqual([])
  })
})
