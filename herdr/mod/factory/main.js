// The factory panel of the Herdr desktop app: the machine, the slots, the leases, the milestones and
// the stacks, docked on the right. It only reads: no command it runs writes, and no control of it
// sends anything. The facts are read by `adapters.js`, put together by `lib/` and drawn by `views/`.

import { View } from 'gpui-kit'
import { ScrollHandle, v_flex } from 'gpui-base'
import { checking, exec, nextCommand, props, readTextFile, settings, terminals } from 'herdr'
import { createAdapters, readConfig } from './adapters.js'
import { buildGithub, buildPanel, parseStacks, pushLoad, SECTIONS } from './lib/panel.js'
import { buildState } from './lib/state.js'
import { THEMES } from './lib/tokens.js'
import { banners } from './views/banners.js'
import { header } from './views/header.js'
import { leases } from './views/leases.js'
import { machine } from './views/machine.js'
import { milestones } from './views/milestones.js'
import { orphans } from './views/orphans.js'
import { slots } from './views/slots.js'
import { stacks } from './views/stacks.js'
import { strip } from './views/strip.js'
import { MONO } from './views/ui.js'

/** What the slots, the machine, the agents and the stacks are read every, and GitHub. */
const FAST_MS = 5000
const SLOW_MS = 60_000

/** The three choices of the theme toggle. */
const THEME_CHOICES = ['dark', 'light', 'follow']

export default class Factory extends View {
  init(_props, cx) {
    this.config = readConfig(props())
    this.adapters = createAdapters({ exec, readTextFile, terminals, config: this.config })
    this.state = null
    this.github = null
    this.stacks = { value: [], at: null, stale: false, error: null }
    this.history = []
    this.seeded = false
    this.now = Date.now()
    this.busy = { fast: false, slow: false }
    this.scroll = ScrollHandle.new()
    this.order = []
    this.open = this.load('open', {})
    const stored = this.load('theme', props()?.theme ?? 'dark')
    this.ui = {
      themeName: THEME_CHOICES.includes(stored) ? stored : 'dark',
      toggle: (name, cx) => {
        if (!SECTIONS.includes(name)) return
        const was = this.panel().sections[name].open
        this.open = { ...this.open, [name]: !was }
        localStorage.setItem('open', JSON.stringify(this.open))
        cx.notify()
      },
      cycleTheme: (cx) => {
        const next =
          THEME_CHOICES[(THEME_CHOICES.indexOf(this.ui.themeName) + 1) % THEME_CHOICES.length]
        this.ui.themeName = next
        localStorage.setItem('theme', JSON.stringify(next))
        cx.notify()
      },
    }
    // `herdr-app check` runs init for real: no reads and no timers there.
    if (checking()) return
    cx.spawn(async (cx) => {
      for (;;) {
        this.command(await nextCommand())
        cx.notify()
      }
    })
    cx.timer.every(FAST_MS, (cx) => this.fast(cx))
    cx.timer.every(SLOW_MS, (cx) => this.slow(cx))
    this.fast(cx)
    this.slow(cx)
  }

  /**
   * A command of the panel (`herdr-app do factory.<command>`, or a key bound to it): `top` scrolls to the
   * start, `reveal:<section>` (`machine`, `slots`, `workers`, `milestones`, `stacks`, `orphans`) scrolls
   * until that section is in view. They move the view only.
   *
   * @param {string} command
   */
  command(command) {
    const [name, argument] = command.split(':')
    const at = name === 'top' ? 0 : name === 'reveal' ? this.order.indexOf(argument) : -1
    if (at >= 0) this.scroll.scroll_to_item(at)
  }

  /** A value kept in `localStorage`, or `fallback`. */
  load(key, fallback) {
    try {
      const text = localStorage.getItem(key)
      return text === null ? fallback : JSON.parse(text)
    } catch {
      return fallback
    }
  }

  /** The slots, the machine, the agents and the stacks. */
  fast(cx) {
    if (this.busy.fast) return
    this.busy.fast = true
    cx.spawn(async (cx) => {
      try {
        const a = this.adapters
        const [now, slots, machine, agents, stacks] = await Promise.all([
          a.now(),
          a.readSlots(),
          a.readMachine(),
          a.readAgents(),
          a.readStacks(),
        ])
        this.now = now
        this.state = buildState({ now, fetched: { slots, machine, agents }, previous: this.state })
        if (!this.seeded) {
          this.seeded = true
          this.history = await a.readHistory()
        }
        const load = this.state.sources.machine.value?.load1 ?? null
        if (!this.config.fixture) this.history = pushLoad(this.history, now, load)
        if ('error' in stacks) {
          this.stacks = { ...this.stacks, stale: true, error: stacks.error }
        } else {
          this.stacks = {
            value: parseStacks(stacks.text),
            at: stacks.at,
            stale: false,
            error: null,
          }
        }
      } finally {
        this.busy.fast = false
      }
      cx.notify()
    })
  }

  /** The milestones of each space, from GitHub. */
  slow(cx) {
    if (this.busy.slow) return
    this.busy.slow = true
    cx.spawn(async (cx) => {
      try {
        /** @type {Record<string, unknown>} */
        const reads = {}
        for (const space of this.config.spaces)
          reads[space.name] = await this.adapters.readGithub(space)
        const now = await this.adapters.now()
        this.github = buildGithub({
          now,
          spaces: this.config.spaces,
          reads,
          previous: this.github,
        })
      } finally {
        this.busy.slow = false
      }
      cx.notify()
    })
  }

  /** The theme being drawn. */
  themeNow() {
    const pick = this.ui.themeName
    if (pick === 'follow') return settings().dark === false ? 'light' : 'dark'
    return pick
  }

  /** What the panel shows now. */
  panel() {
    const state = this.state ?? buildState({ now: this.now, fetched: {} })
    // The rows of Milestones are built here, from the agents of the last fast read and the last read of GitHub.
    const github = this.github
    return buildPanel({
      now: this.now,
      state,
      github,
      stacks: this.stacks,
      history: this.history,
      config: this.config,
      theme: this.themeNow(),
      open: this.open,
    })
  }

  render() {
    const theme = this.themeNow()
    const ctx = { c: THEMES[theme], theme, dark: theme === 'dark', ui: this.ui }
    const p = this.panel()
    const s = p.sections
    const shown = banners(ctx, p.banners)
    this.order = [...shown.map(() => ''), ...SECTIONS]
    return v_flex()
      .id('factory')
      .size_full()
      .bg(ctx.c.bg)
      .text_color(ctx.c.fg)
      .font_family(MONO)
      .text_size(12.5)
      .child(header(ctx, p.header, strip(ctx, p.strip)))
      .child(
        v_flex()
          .id('factory-scroll')
          .flex_1()
          .w_full()
          .overflow_y_scrollbar()
          .track_scroll(this.scroll)
          .children([
            ...shown,
            machine(ctx, s.machine),
            slots(ctx, s.slots),
            leases(ctx, s.workers),
            milestones(ctx, s.milestones),
            stacks(ctx, s.stacks),
            orphans(ctx, s.orphans),
          ])
      )
  }
}
