// The factory panel of the Herdr desktop app: "Needs you", the machine, the slots, the leases, the milestones
// and the stacks, docked on the right, the detail of an issue, an overlay of the same mod (`props().detail`),
// and the Board, a tab of the same mod (`props().board`).
// Its reads write nothing. The only thing it sends is a line to the master of an issue's space, after the
// maintainer's click and a 10 s countdown that can be undone (`hc send`, `sendLine` below, ADR-0004); it
// never writes to a worker's pane or to GitHub, and with `fixture` in its props it sends nothing at all.
// The facts are read by `adapters.js`, put together by `lib/` and drawn by `views/`.

import { View } from 'gpui-kit'
import { InputState, ScrollHandle, TextareaState, v_flex } from 'gpui-base'
import {
  checking,
  closeOverlay,
  exec,
  hc,
  home,
  nextCommand,
  notify,
  openOverlay,
  props,
  readTextFile,
  run,
  settings,
  terminals,
} from 'herdr'
import { createAdapters, readConfig } from './adapters.js'
import { buildGithub, buildPanel, formatAge, parseStacks, pushLoad, SECTIONS } from './lib/panel.js'
import { buildBoard, factoryShare } from './lib/board.js'
import {
  answerLine,
  buildNeeds,
  cardMessages,
  createOutbox,
  emptyForm,
  LOCKED_NOTE,
  notificationFor,
} from './lib/needs.js'
import { buildDetail, parseProgress } from './lib/detail.js'
import { buildState } from './lib/state.js'
import { THEMES } from './lib/tokens.js'
import { banners } from './views/banners.js'
import { board } from './views/board.js'
import { detail } from './views/detail.js'
import { header } from './views/header.js'
import { leases } from './views/leases.js'
import { machine } from './views/machine.js'
import { milestones } from './views/milestones.js'
import { needsYou } from './views/needs.js'
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
    /** The Board tab is this mod opened with `board` in its props (`tab.new {mod, props}`). */
    this.board = props()?.board === true
    /** The Board's filters: `all` or a space's name, `all` or a lane tag. */
    this.boardFilter = { space: 'all', lane: 'all' }
    /** The milestones of each repository and `.github/project-fields.json`, for the factory's share. */
    this.share = { milestones: null, fields: null }
    /** The branch and the lines changed of the open issue's worktree. */
    this.worktree = null
    this.seeded = false
    this.now = Date.now()
    this.busy = { fast: false, slow: false }
    this.scroll = ScrollHandle.new()
    this.order = []
    this.open = this.load('open', {})
    /** The subject of each issue's commit message, by number. */
    this.commits = {}
    /** When the panel first saw each blocked terminal (by address): `terminals()` gives no time for it. */
    this.blockedSince = {}
    /** When the maintainer opened each issue's diff (the model's clock), by number; kept in memory only. */
    this.diffs = {}
    /** The time forms, and the text inputs of each, by issue number. */
    this.forms = {}
    this.formInputs = {}
    /** The keys of the cards the maintainer has seen, `null` before the first read. */
    this.seen = null
    /** What the last send did, for one line under the cards. */
    this.sentNote = null
    this.outbox = createOutbox({ send: (target, text) => this.sendLine(target, text) })
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
      openBoard: () => this.openBoard(),
      setBoardFilter: (kind, key, cx) => {
        this.boardFilter = { ...this.boardFilter, [kind]: key }
        cx.notify()
      },
      formatAge,
      lockedNote: LOCKED_NOTE,
      pending: null,
      sentNote: null,
      // "Go to master": focuses its pane.
      goTo: (address) => run('pane.focus', { terminal: address }),
      // The worktree's diff against its merge base, in a pane that only reads; it unlocks the sign-off.
      openDiff: (card) => this.openDiff(card),
      readDiffs: (card, cx) => {
        for (const item of card.items) if (!item.read) this.openDiff(item)
        cx.notify()
      },
      // The gate reports are comments of the issue.
      openReports: (card) =>
        this.pane(
          [
            'sh',
            '-c',
            'gh issue view "$1" --repo "$2" --comments | less -R',
            'reports',
            String(card.number),
            card.repo,
          ],
          `reports-${card.number}`
        ),
      inputs: (number) => this.formInputs[number] ?? null,
      setForm: (number, patch, cx) => this.setForm(number, patch, cx),
      send: (card, cx) => this.startSend(card, cx),
      undo: (cx) => {
        this.outbox.undo()
        cx.notify()
      },
      answer: {
        option: null,
        note:
          this.detail === null
            ? null
            : TextareaState.new({ placeholder: 'Then finish round 2.', rows: 3 }),
        choose: (letter, cx) => {
          this.ui.answer.option = letter
          cx.notify()
        },
      },
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
    cx.timer.every(1000, (cx) => this.tick(cx))
    cx.timer.every(FAST_MS, (cx) => this.fast(cx))
    cx.timer.every(SLOW_MS, (cx) => this.slow(cx))
    this.fast(cx)
    this.slow(cx)
  }

  /** Opens `argv` in a pane beside the window, which stays open. @param {string[]} argv @param {string} [name] */
  pane(argv, name) {
    run('terminal.open', { argv, place: 'right', ...(name === undefined ? {} : { name }) })
  }

  /**
   * Opens the diff of an issue's worktree against its merge base with `origin/main` in a pane that only
   * reads, and counts the minutes of the time form from now on.
   *
   * @param {{ number: number, worktree: string | null, lane?: string }} card
   */
  openDiff(card) {
    if (card.worktree === null) return
    const path = card.worktree.startsWith('~/')
      ? `${home()}${card.worktree.slice(1)}`
      : card.worktree
    this.pane(
      [
        'sh',
        '-c',
        'cd "$1" && git diff --color=always "$(git merge-base HEAD origin/main)" | less -R',
        'diff',
        path,
      ],
      `diff-${card.number}`
    )
    if (this.diffs[card.number] === undefined) this.diffs[card.number] = this.now
    if (this.formInputs[card.number] === undefined && card.lane !== 'express') {
      this.makeForm(card.number)
    }
  }

  /** The inputs of an issue's time form; made where an event handler runs, never in `render`. @param {number} number */
  makeForm(number) {
    this.forms[number] = emptyForm()
    const readMin = InputState.new({ placeholder: 'min' })
    const handMin = InputState.new({ placeholder: 'min' })
    const remark = InputState.new({ placeholder: 'the admin page, headed Chromium' })
    readMin.on('change', (_e, cx) => {
      this.forms[number].readMin = readMin.value().trim()
      cx.notify()
    })
    handMin.on('change', (_e, cx) => {
      this.forms[number].handMin = handMin.value().trim()
      cx.notify()
    })
    remark.on('change', (_e, cx) => {
      this.forms[number].remark = remark.value()
      cx.notify()
    })
    this.formInputs[number] = { readMin, handMin, remark }
  }

  /** @param {number} number @param {Record<string, unknown>} patch @param {any} cx */
  setForm(number, patch, cx) {
    const form = this.forms[number]
    if (form === undefined) return
    Object.assign(form, patch)
    if (patch['read'] === 'report') {
      form.readMin = ''
      this.formInputs[number].readMin.set_value('')
    } else if (patch['read'] === 'diff') {
      form.readMin = null
    }
    cx.notify()
  }

  /** Every second: the countdown, the tracked minutes of an open form. @param {any} cx */
  tick(cx) {
    const sent = this.outbox.tick(Date.now())
    if (sent !== null)
      this.sentNote = `Sent to the master: ${sent.map((m) => m.text.split('\n')[0]).join(' · ')}`
    for (const [number, form] of Object.entries(this.forms)) {
      const at = this.diffs[number]
      if (form.readMin !== null || at === undefined) continue
      const tracked = String(Math.max(1, Math.floor((this.now - at) / 60_000)))
      const input = this.formInputs[number].readMin
      if (input.value() !== tracked) input.set_value(tracked)
    }
    cx.notify()
  }

  /**
   * Starts the 10 s countdown of one click: a card of Needs you (`cardMessages`) or the decision of the
   * overlay. Nothing is sent before it ends, and a click while another countdown runs does nothing.
   *
   * @param {any} card
   * @param {any} cx
   */
  startSend(card, cx) {
    this.sentNote = null
    if (card.options !== undefined || card.question !== undefined) {
      const option = this.ui.answer.option
      if (option === null || card.master === null) return
      const text = answerLine(card.number, option, this.ui.answer.note?.value() ?? '')
      this.outbox.start(
        Date.now(),
        `answer #${card.number}`,
        [{ target: card.master, text }],
        'answer'
      )
    } else {
      const messages = cardMessages(card)
      const label = card.kind === 'batch' ? 'the shared sign-off' : `sign-off #${card.number}`
      this.outbox.start(Date.now(), label, messages, card.key)
    }
    cx.notify()
  }

  /**
   * The one call that sends: `hc send <master> <text>`, bare (no `HC_TERMINAL_ID`), to the master of the
   * issue's space. A run that reads recordings (`fixture`) sends nothing.
   *
   * @param {string} target
   * @param {string} text
   */
  sendLine(target, text) {
    if (this.config.fixture !== null) {
      this.sentNote = 'Fixture: nothing was sent.'
      return
    }
    void this.deliver(target, text)
  }

  /** @param {string} target @param {string} text */
  async deliver(target, text) {
    try {
      const run = await hc(['send', target, text])
      if (run.code !== 0) this.sentNote = `Not sent: ${run.stderr.trim() || `hc exit ${run.code}`}`
    } catch (error) {
      this.sentNote = `Not sent: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  /** Posts a notification for each card that was not there at the last look. */
  notifyNew() {
    if (this.detail !== null || this.board || this.config.fixture !== null || this.github === null)
      return
    const { cards } = this.needs()
    const keys = new Set(cards.map((c) => c.key))
    if (this.seen !== null) {
      for (const card of cards) {
        if (this.seen.has(card.key)) continue
        notify(notificationFor(card))
      }
    }
    this.seen = keys
  }

  /** The cards of "Needs you" now. */
  needs() {
    const agents = /** @type {import('./lib/agents.js').Agent[]} */ (
      this.state?.sources['agents']?.value ?? []
    )
    return buildNeeds({
      now: this.now,
      config: this.config,
      github: this.github,
      agents,
      blockedSince: this.blockedSince,
      diffs: this.diffs,
      commits: this.commits,
      forms: this.forms,
      theme: this.themeNow(),
    })
  }

  /** Opens `argv` in a pane beside the window and closes the overlay. @param {string[]} argv @param {string} [name] */
  opened(argv, name) {
    run('terminal.open', { argv, place: 'right', ...(name === undefined ? {} : { name }) })
    closeOverlay(props()?.overlay)
  }

  /** Opens the Board as a tab of its own: this mod with `board` in its props. */
  openBoard() {
    run('tab.new', { name: 'Board', mod: 'factory', props: { ...props(), board: true } })
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
   * start, `reveal:<section>` (`needs`, `card-<n>` for the nth card of Needs you, `machine`, `slots`, `workers`, `milestones`, `stacks`, `orphans`) scrolls
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
        const live = /** @type {import('./lib/agents.js').Agent[]} */ (
          this.state.sources['agents']?.value ?? []
        )
        for (const a of live) {
          if (a.needsYou) this.blockedSince[a.address] ??= now
          else delete this.blockedSince[a.address]
        }
        if (!this.seeded) {
          this.seeded = true
          this.history = await a.readHistory()
          // A fixture says which diffs were opened, since nobody clicks in a recording.
          for (const [number, minutes] of Object.entries(await a.readDiffs())) {
            this.diffs[number] = now - Number(minutes) * 60_000
            this.makeForm(Number(number))
          }
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
        await this.readShare()
        await this.readWorktree()
        await this.readCommits()
        this.notifyNew()
      } finally {
        this.busy.slow = false
      }
      cx.notify()
    })
  }

  /** The milestones of each repository and the project fields; a failed read keeps the last one. */
  async readShare() {
    const [milestones, fields] = await Promise.all([
      this.adapters.readMilestones(this.config.spaces),
      this.adapters.readProjectFields(),
    ])
    this.share = {
      milestones: 'byRepo' in milestones ? milestones.byRepo : this.share.milestones,
      fields: 'fields' in fields ? fields.fields : this.share.fields,
    }
  }

  /** What the Board shows now. */
  boardModel() {
    const state = this.state ?? buildState({ now: this.now, fetched: {} })
    const { milestones, fields } = this.share
    return buildBoard({
      now: this.now,
      state,
      github: this.github,
      config: this.config,
      share:
        milestones === null || fields === null
          ? null
          : factoryShare({ fields, milestones, spaces: this.config.spaces }),
      filter: this.boardFilter,
      theme: this.themeNow(),
    })
  }

  /** The subject of each open issue's commit message, from the packet its `### Progress` names. */
  async readCommits() {
    for (const space of this.config.spaces) {
      for (const issue of this.github?.spaces[space.name]?.raw?.issues ?? []) {
        if (issue.state === 'closed') continue
        const packet = parseProgress(issue.body).packet
        if (packet === null) continue
        const dir = packet.startsWith('~/') ? `${home()}${packet.slice(1)}` : packet
        const subject = await this.adapters.readCommit(issue.number, dir)
        if (subject === null) delete this.commits[issue.number]
        else this.commits[issue.number] = subject
      }
    }
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
        name: open.space.name,
      },
      now: this.now,
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
    this.ui.pending = this.outbox.state(Date.now())
    this.ui.sentNote = this.sentNote
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
    if (this.board) {
      return v_flex()
        .id('factory-board')
        .size_full()
        .bg(ctx.c.bg)
        .text_color(ctx.c.fg)
        .font_family(MONO)
        .text_size(12.5)
        .overflow_y_scrollbar()
        .child(board(ctx, this.boardModel()))
    }
    const p = this.panel()
    const s = p.sections
    const shown = banners(ctx, p.banners)
    const needs = needsYou(ctx, this.needs())
    this.order = [...shown.map(() => ''), ...needs.keys, ...SECTIONS]
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
            ...needs.items,
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
