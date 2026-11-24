// The factory panel of the Herdr desktop app: the machine, the slots, the leases, the milestones and
// the stacks, docked on the right, and the detail of an issue, an overlay of the same mod (`props().detail`).
// It only reads: no command it runs writes, and no control of it sends anything. The facts are read by `adapters.js`, put together by `lib/` and drawn by `views/`.

import { View } from 'gpui-kit'
import { ScrollHandle, v_flex } from 'gpui-base'
import {
  checking,
  closeOverlay,
  exec,
  home,
  nextCommand,
  openOverlay,
  props,
  readTextFile,
  run,
  settings,
  terminals,
} from 'herdr'
import { createAdapters, readConfig } from './adapters.js'
import { buildGithub, buildPanel, parseStacks, pushLoad, SECTIONS } from './lib/panel.js'
import { buildDetail, parseProgress } from './lib/detail.js'
import { buildState } from './lib/state.js'
import { THEMES } from './lib/tokens.js'
import { banners } from './views/banners.js'
import { detail } from './views/detail.js'
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
    this.terminals = []
    /** `{ space, number }` in the overlay of an issue, `null` in the panel. */
    this.detail = props()?.detail ?? null
    /** The branch and the lines changed of the open issue's worktree. */
    this.worktree = null
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
      toggleTheme: (cx) => {
        this.ui.themeName = this.themeNow() === 'dark' ? 'light' : 'dark'
        localStorage.setItem('theme', JSON.stringify(this.ui.themeName))
        cx.notify()
      },
      openDetail: (space, number) => this.openDetail(space, number),
      // A file of the packet, in a pane that can only read it.
      openFile: (path) => {
        this.opened([
          'less',
          '-R',
          '--',
          path.startsWith('~/') ? `${home()}${path.slice(1)}` : path,
        ])
      },
      // An agent's last lines, in a pane that can only read them: the keys go to `watch`, never to the worker.
      watchAgent: (name, address) => {
        this.opened(['watch', '-n', '2', 'hc', 'read', address, '--lines', '40'], name)
      },
      close: () => closeOverlay(props()?.overlay),
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

  /** Opens `argv` in a pane beside the window and closes the overlay. @param {string[]} argv @param {string} [name] */
  opened(argv, name) {
    run('terminal.open', { argv, place: 'right', ...(name === undefined ? {} : { name }) })
    closeOverlay(props()?.overlay)
  }

  /** Opens the overlay of an issue: the same mod with `detail` in its props. @param {string} space @param {number} number */
  openDetail(space, number) {
    openOverlay({
      mod: 'factory',
      kind: 'dialog',
      width: 760,
      height: 0.9,
      props: { ...props(), detail: { space, number } },
    })
  }

  /**
   * A command of the panel (`herdr-app do factory.<command>`, or a key bound to it): `top` scrolls to the
   * start, `reveal:<section>` (`machine`, `slots`, `workers`, `milestones`, `stacks`, `orphans`) scrolls
   * until that section is in view, `detail:<number>` opens the overlay of that issue. They move the view
   * or open a window; nothing is sent.
   *
   * @param {string} command
   */
  command(command) {
    const [name, argument] = command.split(':')
    if (name === 'detail') {
      const number = Number(argument)
      const space = this.config.spaces.find((s) =>
        this.github?.spaces[s.name]?.raw?.issues.some((i) => i.number === number)
      )
      if (space !== undefined) this.openDetail(space.name, number)
      return
    }
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
        this.terminals = 'terminals' in agents ? agents.terminals : this.terminals
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
        await this.readWorktree()
      } finally {
        this.busy.slow = false
      }
      cx.notify()
    })
  }

  /** The open issue, as GitHub gave it, with its comments and its space. */
  openIssue() {
    const space = this.config.spaces.find((s) => s.name === this.detail?.space)
    const raw = space === undefined ? null : this.github?.spaces[space.name]?.raw
    const issue = raw?.issues.find((i) => i.number === this.detail?.number)
    if (space === undefined || raw == null || issue === undefined) return null
    return { space, issue, comments: raw.comments[issue.number] ?? [], maintainer: raw.maintainer }
  }

  /** The branch and the lines changed of the open issue's worktree, named in its `### Progress`. */
  async readWorktree() {
    const open = this.detail === null ? null : this.openIssue()
    if (open === null) return
    const path = parseProgress(open.issue.body).worktree
    if (path === null) return
    const read = await this.adapters.readWorktree(
      open.issue.number,
      path.startsWith('~/') ? `${home()}${path.slice(1)}` : path
    )
    if (!('error' in read)) this.worktree = read
  }

  /** What the overlay shows now, `null` before GitHub was read. */
  detailModel() {
    const open = this.openIssue()
    if (open === null) return null
    const at = this.config.spaces.indexOf(open.space)
    const agents = /** @type {import('./lib/agents.js').Agent[]} */ (
      this.state?.sources['agents']?.value ?? []
    ).filter((a) => a.space?.name === open.space.name)
    return buildDetail({
      issue: open.issue,
      comments: open.comments,
      maintainer: open.maintainer,
      space: {
        repo: open.space.repo,
        letter: (open.space.name[0] ?? '?').toUpperCase(),
        colour: ['space-m', 'space-f', 'space-p'][at % 3] ?? 'muted',
      },
      agents,
      terminals: this.terminals,
      stacks: this.stacks.value,
      worktree: this.worktree,
      theme: this.themeNow(),
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
    if (this.detail !== null) {
      return v_flex()
        .id('factory-detail')
        .size_full()
        .bg(ctx.c.bg)
        .text_color(ctx.c.fg)
        .font_family(MONO)
        .text_size(12.5)
        .overflow_y_scrollbar()
        .child(detail(ctx, this.detailModel()))
    }
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
