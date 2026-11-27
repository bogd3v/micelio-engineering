// The factory panel of the Herdr desktop app: "Needs you", the machine, the slots, the leases, the milestones
// and the stacks, docked on the right, the detail of an issue, an overlay of the same mod (`props().detail`),
// and the Board, a tab of the same mod (`props().board`).
// Its reads write nothing. Its settings (where it shows, the order and visibility of the sections, the alerts)
// are `shared("factory.settings")`, written with `setShared`, and Customize, an overlay of the same mod
// (`props().customize`), changes them (`lib/settings.js`); the side panel is shown and hidden with
// `layout.show` and `layout.hide`, the Board with `tab.new`, `pane.rename` and `tab.close`; with `fixture` in its props
// Customize keeps its changes in memory and runs none of them. It sends a line to the master of an issue's space, after the maintainer's click
// and a 10 s countdown that can be undone (`hc send`, `sendLine` below, ADR-0004), and `retry #N` to it once
// the load falls, when the maintainer armed it; it never writes to a worker's pane or to GitHub. The buttons
// of `lib/actions.js` act on the machine (the slot script, `docker compose down -v`, a process group), the
// removals after a confirmation; with `fixture` in its props nothing is sent and nothing is run.
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
  keys,
  openOverlay,
  panes,
  playSound,
  props,
  readTextFile,
  run,
  setShared,
  settings,
  shared,
  terminals,
  theme,
  window,
} from 'herdr'
import { createAdapters, readConfig } from './adapters.js'
import { createActions, createRetries } from './lib/actions.js'
import {
  buildGithub,
  buildPanel,
  formatAge,
  issueKey,
  notLive,
  pairReads,
  parseStacks,
  pushLoad,
  refOf,
  SECTIONS,
  tagsOf,
} from './lib/panel.js'
import { buildBoard, factoryShare } from './lib/board.js'
import { paceOf, readsNow } from './lib/quota.js'
import {
  answerLine,
  buildNeeds,
  cardMessages,
  createOutbox,
  emptyForm,
  emptyTimeLogForm,
  LOCKED_NOTE,
  notificationFor,
} from './lib/needs.js'
import { buildDetail, parseProgress } from './lib/detail.js'
import { CATEGORIES, correctionLine, emptyLogForm } from './lib/log.js'
import {
  baseProps,
  createCustomize,
  createLook,
  createPoster,
  createSaturation,
  headerRed,
  heldOrRed,
  keyAction,
  keyMap,
  moveSection,
  openBoardTab,
  panelSections,
  SECTION_INFO,
  ALERTS,
  SETTINGS_KEY,
  shownCount,
  signOffCard,
  toggleAlert,
  toggleSection,
} from './lib/settings.js'
import {
  createGate,
  FAST_READ_MS,
  FAST_STEP_MS,
  limited,
  readEpics,
  readFast,
  readSlow,
  SLOW_READ_MS,
  SLOW_STEP_MS,
} from './lib/reads.js'
import { buildState } from './lib/state.js'
import { stopTimer } from './lib/time.js'
import { colours } from './lib/tokens.js'
import { banners } from './views/banners.js'
import { board } from './views/board.js'
import { detail, logForm } from './views/detail.js'
import { customize } from './views/customize.js'
import { controls, header } from './views/header.js'
import { leases } from './views/leases.js'
import { footer } from './views/legend.js'
import { machine } from './views/machine.js'
import { milestones } from './views/milestones.js'
import { needsYou } from './views/needs.js'
import { orphans } from './views/orphans.js'
import { slots } from './views/slots.js'
import { stacks } from './views/stacks.js'
import { strip } from './views/strip.js'
import { MONO } from './views/ui.js'

/** @typedef {import('gpui-kit').Context} Context */
/** @typedef {import('./lib/machine.js').Machine} Machine */
/** @typedef {Parameters<typeof factoryShare>[0]} ShareInput */
/** @typedef {import('../types/views.js').DetailProps} DetailProps */
/** @typedef {import('../types/views.js').LogProps} LogProps */
/** @typedef {import('./lib/needs.js').Form} Form */
/** @typedef {import('./lib/needs.js').TimeLogForm} TimeLogForm */
/** @typedef {import('../types/views.js').FormInputs} FormInputs */

/** What the slots, the machine, the agents and the stacks are read every, and GitHub. */
const FAST_MS = 5000
const SLOW_MS = 60_000

export default class Factory
  extends /** @type {new () => import('gpui-kit').View & import('../types/views.js').FactoryState} */ (
    View
  )
{
  /**
   * @override
   * @param {unknown} _props
   * @param {Context} cx
   */
  init(_props, cx) {
    this.config = readConfig(props())
    this.adapters = createAdapters({ exec, readTextFile, terminals, config: this.config })
    this.state = null
    this.github = null
    this.stacks = { value: [], at: null, stale: false, error: null }
    this.history = []
    this.terminals = []
    /** `{ space, number, repo }` in the overlay of an issue (`repo` left out: the space's), `null` in the panel. */
    this.detail = /** @type {DetailProps | null} */ (props()?.detail ?? null)
    /** The Board tab is this mod opened with `board` in its props (`tab.new {mod, props}`). */
    this.board = props()?.board === true
    /** The Board's filters: `all` or a space's name, `all` or a lane tag. */
    this.boardFilter = { space: 'all', lane: 'all' }
    /** The milestones of each repository and `.github/project-fields.json`, for the factory's share. */
    this.share = { milestones: null, fields: null }
    /** The epic of each space as last read, for the banner of the spaces. */
    this.epics = {}
    /** The branch and the lines changed of the open issue's worktree. */
    this.worktree = null
    this.seeded = false
    this.now = Date.now()
    /** When GitHub was last read (the model's clock), for the slow pace. */
    this.githubAt = null
    /** A read that hangs or whose task was cancelled holds its gate only for its limit (`lib/reads.js`). */
    this.gates = { fast: createGate(FAST_READ_MS), slow: createGate(SLOW_READ_MS) }
    this.scroll = ScrollHandle.new()
    this.order = []
    this.open = /** @type {Record<string, boolean>} */ (this.load('open', {}))
    /** The subject of each issue's commit message, by the issue's key (`issueKey` of `lib/panel.js`). */
    this.commits = {}
    /** When the panel first saw each blocked terminal (by address): `terminals()` gives no time for it. */
    this.blockedSince = {}
    /** When the maintainer opened each issue's diff (the model's clock), by key; kept in memory only. */
    this.diffs = {}
    /** The time forms, and the text inputs of each, by the issue's key. */
    this.forms = {}
    this.formInputs = {}
    /** The forms of "Log time" on an open pull request, and their inputs, by the issue's key. */
    this.timeForms = {}
    this.timeInputs = {}
    /** True in the overlay of Customize (`props().customize`). */
    this.customizing = props()?.customize === true
    /** The panel's keyboard: it handles N, S, P, R, L and B only while it has it. */
    this.handle = cx.focus_handle()
    /** The next card `N` reveals. */
    this.nextCard = 0
    /** What Customize's switches call; with `fixture` it keeps its changes in memory and calls nothing. */
    this.customizer = createCustomize({
      run,
      setShared,
      panes,
      props: () => baseProps(props()),
      shared: () => shared(SETTINGS_KEY),
      fixture: this.config.fixture !== null,
    })
    this.post = createPoster({ notify, playSound })
    this.saturation = createSaturation()
    this.look = createLook()
    /** `{ space, number, ref }` in the overlay of the correction form (`props().log`), `null` elsewhere. */
    this.logOpen = /** @type {LogProps | null} */ (props()?.log ?? null)
    /** What the correction form holds, and its inputs: made in the overlay only, where the form is drawn. */
    this.logState =
      this.logOpen === null
        ? null
        : {
            form: emptyLogForm(this.logOpen.ref ?? this.logOpen.number),
            inputs: {
              issue: InputState.new({ placeholder: '#792' }),
              what: TextareaState.new({ placeholder: 'What was wrong, in one line.', rows: 3 }),
            },
          }
    if (this.logState !== null) {
      const { form, inputs } = this.logState
      inputs.issue.set_value(form.issue)
      inputs.issue.on('change', (_e, cx) => {
        form.issue = inputs.issue.value()
        cx.notify()
      })
      inputs.what.on('change', (_e, cx) => {
        form.what = inputs.what.value()
        cx.notify()
      })
    }
    /** The keys of the cards the maintainer has seen, `null` before the first read. */
    this.seen = null
    /** What the last send did, for one line under the cards. */
    this.sentNote = null
    /** The machine's buttons: they run the slot script, `docker compose down -v` and `kill`. */
    this.actions = createActions({
      exec,
      config: this.config,
      facts: () => this.facts(),
      disabled: this.config.fixture !== null,
    })
    /** The retries the maintainer armed, sent once when the load falls. */
    this.retries = createRetries({
      send: (target, text) => this.sendLine(target, text),
      disabled: this.config.fixture !== null,
    })
    /** What the last click of the machine's buttons said, such as "no free slot". */
    this.actionNote = null
    /** The cores and age of the orphans the maintainer asked to see, by pid. */
    this.processes = {}
    /** When each unowned stack was created, by project. */
    this.stackAges = {}
    this.outbox = createOutbox({ send: (target, text) => this.sendLine(target, text) })
    this.ui = {
      toggle: (name, cx) => {
        if (!SECTIONS.includes(name)) return
        const was =
          this.panel().sections[/** @type {import('./lib/panel.js').SectionName} */ (name)].open
        this.open = { ...this.open, [name]: !was }
        localStorage.setItem('open', JSON.stringify(this.open))
        cx.notify()
      },
      openDetail: (space, number, repo) => this.openDetail(space, number, repo),
      openBoard: () => this.openBoard(),
      openCustomize: () => this.openCustomize(),
      boardOn: true,
      customize: {
        panel: (on, cx) => {
          this.customizer.panel(on)
          cx.notify()
        },
        board: (on, cx) => {
          this.customizer.board(on)
          cx.notify()
        },
        move: (name, by, cx) => {
          this.customizer.change((s) => moveSection(s, name, by))
          cx.notify()
        },
        toggleSection: (name, cx) => {
          this.customizer.change((s) => toggleSection(s, name))
          cx.notify()
        },
        toggleAlert: (name, cx) => {
          this.customizer.change((s) => toggleAlert(s, name))
          cx.notify()
        },
        restore: (cx) => {
          this.customizer.restore()
          cx.notify()
        },
      },
      setBoardFilter: (kind, key, cx) => {
        this.boardFilter = { ...this.boardFilter, [kind]: key }
        cx.notify()
      },
      formatAge,
      lockedNote: LOCKED_NOTE,
      pending: null,
      sentNote: null,
      actionNote: null,
      confirmation: null,
      processes: {},
      togglePause: (cx) =>
        this.act(cx, () =>
          this.panel().header.pause.on ? this.actions.resume() : this.actions.pause()
        ),
      toggleReserve: (cx) =>
        this.act(cx, () =>
          this.panel().header.reserve.on ? this.actions.release() : this.actions.reserve()
        ),
      toggleRetry: (card, cx) => {
        if (this.retries.isArmed(card.key)) this.retries.cancel(card.key)
        else if (card.master !== null)
          this.retries.arm(card.key, /** @type {string} */ (card.ref), card.master)
        cx.notify()
      },
      askBringDown: (project, cx) => {
        this.actionNote = this.actions.askBringDown(project).note
        cx.notify()
      },
      askTerminate: (pid, cx) => {
        this.actionNote = this.actions.askTerminate(pid).note
        cx.notify()
      },
      cancel: (cx) => {
        this.actions.cancel()
        cx.notify()
      },
      confirm: (cx) => {
        cx.spawn(async (cx) => {
          this.actionNote = (await this.actions.confirm()).note
          this.fast(cx)
          cx.notify()
        })
        cx.notify()
      },
      showProcess: (pid, cx) => {
        if (this.processes[pid] !== undefined) {
          delete this.processes[pid]
          cx.notify()
          return
        }
        cx.spawn(async (cx) => {
          const read = await this.adapters.readProcess(pid)
          if (read !== null) this.processes[pid] = read
          cx.notify()
        })
      },
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
          `reports-${card.issue}`
        ),
      inputs: (issue) => this.formInputs[issue] ?? null,
      setForm: (issue, patch, cx) => this.setForm(issue, patch, cx),
      timeInputs: (issue) => this.timeInputs[issue] ?? null,
      setTimeForm: (issue, patch, cx) => this.setTimeForm(issue, patch, cx),
      toggleTimer: (issue, cx) => this.toggleTimer(issue, cx),
      openLog: (space, number) => this.openLog(space, number),
      openLogFromDetail: () => {
        const open = this.openIssue()
        this.openLog(
          this.detail?.space ?? null,
          this.detail?.number ?? null,
          open === null ? null : refOf(open.space, open.pair, open.issue.number)
        )
      },
      logForm: {
        inputs: this.logState?.inputs ?? null,
        choose: (category, cx) => {
          if (this.logState !== null) this.logState.form.category = category
          cx.notify()
        },
        send: (cx) => this.startLogSend(cx),
      },
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
      close: () => closeOverlay(/** @type {string} */ (props()?.overlay)),
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

  /** What the machine's buttons check before a removal and when it is confirmed. */
  facts() {
    const agents = /** @type {import('./lib/agents.js').Agent[]} */ (
      this.state?.sources['agents']?.value ?? []
    )
    const slots = /** @type {import('./lib/slots.js').Slots | null} */ (
      this.state?.sources['slots']?.value ?? null
    )
    return {
      agents,
      leases: slots?.leases.leases ?? [],
      orphans: slots?.orphans ?? [],
      stacks: this.stacks.value,
      tags: tagsOf(this.config.spaces),
    }
  }

  /**
   * A click of the slot script's buttons: runs it (nothing, with a fixture), shows what it said and reads the
   * slots again.
   *
   * @param {Context} cx
   * @param {() => Promise<{ note: string | null }>} action
   */
  act(cx, action) {
    cx.spawn(async (cx) => {
      this.actionNote = (await action()).note
      this.fast(cx)
      cx.notify()
    })
  }

  /** Opens `argv` in a pane beside the window, which stays open. @param {string[]} argv @param {string} [name] */
  pane(argv, name) {
    run('terminal.open', { argv, place: 'right', ...(name === undefined ? {} : { name }) })
  }

  /**
   * Opens the diff of an issue's worktree against its merge base with `origin/main` in a pane that only
   * reads, and counts the minutes of the time form from now on.
   *
   * @param {{ number: number, issue: number | string, worktree: string | null, lane?: string }} card
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
      `diff-${card.issue}`
    )
    if (this.diffs[card.issue] === undefined) this.diffs[card.issue] = this.now
    if (this.formInputs[card.issue] === undefined && card.lane !== 'express') {
      this.makeForm(card.issue)
    }
  }

  /** The inputs of an issue's time form; made where an event handler runs, never in `render`. @param {number | string} number the issue's key */
  makeForm(number) {
    this.forms[number] = emptyForm()
    const readMin = InputState.new({ placeholder: 'min' })
    const handMin = InputState.new({ placeholder: 'min' })
    const remark = InputState.new({ placeholder: 'the admin page, headed Chromium' })
    readMin.on('change', (_e, cx) => {
      ;/** @type {Form} */ (this.forms[number]).readMin = readMin.value().trim()
      cx.notify()
    })
    handMin.on('change', (_e, cx) => {
      ;/** @type {Form} */ (this.forms[number]).handMin = handMin.value().trim()
      cx.notify()
    })
    remark.on('change', (_e, cx) => {
      ;/** @type {Form} */ (this.forms[number]).remark = remark.value()
      cx.notify()
    })
    this.formInputs[number] = { readMin, handMin, remark }
  }

  /**
   * The form of "Log time" on an open pull request. Its inputs are made when it first opens (where an
   * event handler runs, never in `render`).
   *
   * @param {number | string} number the issue's key @param {Record<string, unknown>} patch @param {Context} cx
   */
  setTimeForm(number, patch, cx) {
    const form = (this.timeForms[number] ??= emptyTimeLogForm())
    if (patch['open'] === true && this.timeInputs[number] === undefined) {
      const readMin = InputState.new({ placeholder: 'min' })
      const handMin = InputState.new({ placeholder: 'min' })
      const remark = InputState.new({ placeholder: 'the admin page, headed Chromium' })
      readMin.on('change', (_e, cx) => {
        ;/** @type {TimeLogForm} */ (this.timeForms[number]).readMin = readMin.value().trim()
        cx.notify()
      })
      handMin.on('change', (_e, cx) => {
        ;/** @type {TimeLogForm} */ (this.timeForms[number]).handMin = handMin.value().trim()
        cx.notify()
      })
      remark.on('change', (_e, cx) => {
        ;/** @type {TimeLogForm} */ (this.timeForms[number]).remark = remark.value()
        cx.notify()
      })
      this.timeInputs[number] = { readMin, handMin, remark }
    }
    Object.assign(form, patch)
    if (patch['read'] === 'none') {
      form.readMin = ''
      this.timeInputs[number]?.readMin.set_value('')
    }
    cx.notify()
  }

  /** Starts the hands-on timer, or stops it and adds its minutes to the field. @param {number | string} number the issue's key @param {Context} cx */
  toggleTimer(number, cx) {
    const form = this.timeForms[number]
    if (form === undefined) return
    if (form.timerAt === null) {
      form.timerAt = this.now
    } else {
      form.handMin = stopTimer(form.handMin, form.timerAt, this.now)
      form.timerAt = null
      this.timeInputs[number]?.handMin.set_value(form.handMin)
    }
    cx.notify()
  }

  /** @param {number | string} number the issue's key @param {Record<string, unknown>} patch @param {Context} cx */
  setForm(number, patch, cx) {
    const form = this.forms[number]
    if (form === undefined) return
    Object.assign(form, patch)
    if (patch['read'] === 'report') {
      form.readMin = ''
      ;/** @type {FormInputs} */ (this.formInputs[number]).readMin.set_value('')
    } else if (patch['read'] === 'diff') {
      form.readMin = null
    }
    cx.notify()
  }

  /** Every second: the countdown, the tracked minutes of an open form. @param {Context} cx */
  tick(cx) {
    if (this.config.fixture === null) this.now = Date.now()
    const sent = this.outbox.tick(Date.now())
    if (sent !== null)
      this.sentNote = `Sent to the master: ${sent.map((m) => m.text.split('\n')[0]).join(' · ')}`
    for (const [number, form] of Object.entries(this.forms)) {
      const at = this.diffs[number]
      if (form.readMin !== null || at === undefined) continue
      const tracked = String(Math.max(1, Math.floor((this.now - at) / 60_000)))
      const input = /** @type {FormInputs} */ (this.formInputs[number]).readMin
      if (input.value() !== tracked) input.set_value(tracked)
    }
    cx.notify()
  }

  /**
   * Starts the 10 s countdown of one click: a card of Needs you (`cardMessages`) or the decision of the
   * overlay. Nothing is sent before it ends, and a click while another countdown runs does nothing.
   *
   * @param {import('../types/views.js').SendTarget} card
   * @param {Context} cx
   */
  startSend(card, cx) {
    this.sentNote = null
    if (card.options !== undefined || card.question !== undefined) {
      const option = this.ui.answer.option
      if (option === null || card.master === null) return
      const ref = card.ref ?? `#${card.number}`
      const text = answerLine(ref, option, this.ui.answer.note?.value() ?? '')
      this.outbox.start(Date.now(), `answer ${ref}`, [{ target: card.master, text }], 'answer')
    } else {
      const messages = cardMessages(card)
      const label =
        card.kind === 'batch'
          ? 'the shared sign-off'
          : card.kind === 'time'
            ? `time note ${card.ref}`
            : `sign-off ${card.ref}`
      this.outbox.start(Date.now(), label, messages, card.key)
    }
    cx.notify()
  }

  /**
   * The master of the space of the correction form: the space whose milestone holds the issue it names
   * (`#N` in a pair of the space's repository, `owner/repo#N` in a pair of that repository), else the
   * space it was opened from, else the first.
   */
  logTarget() {
    const { number, repo } = correctionLine(
      /** @type {NonNullable<typeof this.logState>} */ (this.logState).form,
      this.now
    )
    const space =
      this.config.spaces.find((s) =>
        pairReads(s, this.github?.spaces[s.name]).some(
          ({ pair, raw }) =>
            pair.repo === (repo ?? s.repo) && raw.issues.some((i) => i.number === number)
        )
      ) ??
      this.config.spaces.find((s) => s.name === this.logOpen?.space) ??
      this.config.spaces[0]
    const agents = /** @type {import('./lib/agents.js').Agent[]} */ (
      this.state?.sources['agents']?.value ?? []
    )
    const master = agents.find((a) => a.space?.name === space?.name && a.role === 'master')
    return { masterName: space?.name ?? 'the', master: master?.address ?? null }
  }

  /** What the correction form shows now. */
  logModel() {
    const form = /** @type {NonNullable<typeof this.logState>} */ (this.logState).form
    return { categories: CATEGORIES, form, ...correctionLine(form, this.now), ...this.logTarget() }
  }

  /** Starts the 10 s countdown of `log #N | <what> | <category>`, for the master of the issue's space. @param {Context} cx */
  startLogSend(cx) {
    this.sentNote = null
    const { send, number, repo, master } = this.logModel()
    if (send !== null && master !== null) {
      this.outbox.start(
        Date.now(),
        `correction ${repo ?? ''}#${number}`,
        [{ target: master, text: send }],
        'log'
      )
    }
    cx.notify()
  }

  /**
   * Opens the correction form: this mod with `log` in its props.
   *
   * @param {string | null} space @param {number | null} number
   * @param {string | null} [ref] the issue's reference, `owner/repo#N` for an issue of another repository of the space
   */
  openLog(space, number, ref = null) {
    openOverlay({
      mod: 'factory',
      kind: 'dialog',
      width: 380,
      height: 0.9,
      props: { ...props(), log: { space, number, ...(ref === null ? {} : { ref }) } },
    })
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

  /**
   * Posts a notification for each card that was not there at the last look, and one for each held check or
   * red gate that the last look did not have, each when its alert is on (`lib/settings.js`).
   */
  notifyNew() {
    if (!this.isPanel() || this.config.fixture !== null || this.github === null) return
    const settings = this.customizer.settings()
    const { cards } = this.needs()
    const keys = new Set(cards.map((c) => c.key))
    if (this.seen !== null) {
      for (const card of cards) {
        if (this.seen.has(card.key)) continue
        this.post(settings, 'needs', notificationFor(card))
      }
    }
    this.seen = keys
    for (const key of this.look(heldOrRed(cards, this.panel().sections))) {
      this.post(settings, 'held', {
        title: 'Held or red gate',
        body: key.startsWith('held:') ? 'A check was held.' : `A gate turned red: ${key.slice(4)}`,
        level: /** @type {const} */ ('warning'),
        action: { name: 'factory.reveal:needs' },
      })
    }
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
      armed: this.retries.armed(),
      cores:
        /** @type {Machine | null | undefined} */ (this.state?.sources['machine']?.value)?.cores ??
        0,
      timeForms: this.timeForms,
      theme: this.themeNow(),
      agentsNote: notLive(this.state?.sources['agents']),
    })
  }

  /** Opens `argv` in a pane beside the window and closes the overlay. @param {string[]} argv @param {string} [name] */
  opened(argv, name) {
    run('terminal.open', { argv, place: 'right', ...(name === undefined ? {} : { name }) })
    closeOverlay(/** @type {string} */ (props()?.overlay))
  }

  /** Opens Customize: this mod with `customize` in its props. */
  openCustomize() {
    openOverlay({
      mod: 'factory',
      kind: 'dialog',
      width: 420,
      height: 0.9,
      props: { ...baseProps(props()), customize: true },
    })
  }

  /** What Customize shows now. */
  customizeModel() {
    const s = this.customizer.settings()
    const map = keyMap(keys())
    return {
      shown: shownCount(s),
      side: this.config.side,
      panel: s.panel,
      board: s.board,
      sections: s.order.map((name, i) => ({
        name,
        title: /** @type {[string, string]} */ (SECTION_INFO[name])[0],
        desc: /** @type {[string, string]} */ (SECTION_INFO[name])[1],
        on: !s.hidden.includes(name),
        first: i === 0,
        last: i === s.order.length - 1,
      })),
      alerts: ALERTS.map(([name, title, desc]) => ({
        name,
        title,
        desc,
        on: s.alerts[name],
      })),
      keys: map,
      note: this.config.fixture !== null ? '> fixture: kept in memory' : null,
    }
  }

  /** Whether this copy is the docked panel: the Board, the overlays and the shot's copies are not. */
  isPanel() {
    return this.detail === null && this.logOpen === null && !this.board && !this.customizing
  }

  /**
   * A key of the focused panel. N, L and B are the commands `factory.next`, `factory.log` and
   * `factory.board` too; S, P and R are keys only, the click of a button by hand.
   *
   * @param {{ key: string, modifiers?: Partial<import('gpui-kit').Modifiers> }} event
   * @param {Context} cx
   */
  keyDown(event, cx) {
    const m = event.modifiers ?? {}
    const action = keyAction(
      { key: event.key, ctrl: m['control'], alt: m['alt'], meta: m['platform'] },
      keyMap(keys())
    )
    if (action === null) return
    if (action === 'next') this.revealNext()
    else if (action === 'log') this.openLog(null, null)
    else if (action === 'board') this.openBoard()
    else if (action === 'pause') this.ui.togglePause(cx)
    else if (action === 'reserve') this.ui.toggleReserve(cx)
    else if (action === 'sign') {
      const card = signOffCard(this.needs().cards)
      if (card !== null) this.startSend(card, cx)
    }
  }

  /** Scrolls to the next card of Needs you, the first after the last. */
  revealNext() {
    const count = this.needs().cards.length
    if (count === 0) return
    this.nextCard = this.nextCard % count
    const at = this.order.indexOf(`card-${this.nextCard}`)
    if (at >= 0) this.scroll.scroll_to_item(at)
    this.nextCard = (this.nextCard + 1) % count
  }

  /** Opens the Board as a tab of its own: this mod with `board` in its props. */
  openBoard() {
    if (!this.customizer.settings().board) return
    openBoardTab(run, props, panes)
  }

  /**
   * Opens the overlay of an issue: the same mod with `detail` in its props.
   *
   * @param {string} space @param {number} number
   * @param {string} [repo] the repository of the issue's pair, when it is not the space's
   */
  openDetail(space, number, repo) {
    openOverlay({
      mod: 'factory',
      kind: 'dialog',
      width: 760,
      height: 0.9,
      props: { ...props(), detail: { space, number, ...(repo === undefined ? {} : { repo }) } },
    })
  }

  /**
   * A command of the panel (`herdr-app do factory.<command>`, or a key bound to it): `top` scrolls to the
   * start, `next` the next card of Needs you, `board` opens the Board tab, `customize` opens Customize, `focus` gives the
   * panel the keyboard (`pane.go`), `reveal:<section>` (`needs`, `card-<n>` for the nth card of Needs you, `machine`, `slots`, `workers`, `milestones`, `stacks`, `orphans`) scrolls
   * until that section is in view, `detail:<number>` opens the overlay of that issue, `log` or `log:<number>` the correction form. They move the view
   * or open a window; nothing is sent.
   *
   * @param {string} command
   */
  command(command) {
    const [name, argument] = command.split(':')
    if (name === 'focus') {
      this.handle.focus()
      return
    }
    if (name === 'next') return this.revealNext()
    if (name === 'board') return this.openBoard()
    if (name === 'customize') return this.openCustomize()
    if (name === 'log') {
      const number = Number(argument)
      const space = this.config.spaces.find((s) =>
        this.github?.spaces[s.name]?.raw?.issues.some((i) => i.number === number)
      )
      this.openLog(space?.name ?? null, Number.isNaN(number) ? null : number)
      return
    }
    if (name === 'detail') {
      const number = Number(argument)
      const space = this.config.spaces.find((s) =>
        this.github?.spaces[s.name]?.raw?.issues.some((i) => i.number === number)
      )
      if (space !== undefined) this.openDetail(space.name, number)
      return
    }
    const at =
      name === 'top'
        ? 0
        : name === 'reveal'
          ? /** @type {(string | undefined)[]} */ (this.order).indexOf(argument)
          : -1
    if (at >= 0) this.scroll.scroll_to_item(at)
  }

  /**
   * A value kept in `localStorage`, or `fallback`.
   *
   * @param {string} key
   * @param {unknown} fallback
   * @returns {unknown}
   */
  load(key, fallback) {
    try {
      const text = localStorage.getItem(key)
      return text === null ? fallback : JSON.parse(text)
    } catch {
      return fallback
    }
  }

  /** The slots, the machine, the agents and the stacks. @param {Context} cx */
  fast(cx) {
    const generation = this.gates.fast.start(Date.now())
    if (generation === null) return
    const current = () => this.gates.fast.isCurrent(generation)
    cx.spawn(async (cx) => {
      const sleep = (/** @type {number} */ ms) => cx.sleep(ms)
      try {
        const a = this.adapters
        const read = await readFast(a, { sleep })
        // A read past its limit was replaced by a newer one: its late result is dropped.
        if (!current()) return
        const { slots, machine, agents, stacks } = read
        const now = read.now ?? Date.now()
        this.now = now
        this.terminals =
          'terminals' in agents
            ? /** @type {import('herdr').TerminalRow[]} */ (agents.terminals)
            : this.terminals
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
          // Each step has the same limit; one that does not answer seeds nothing and the read goes on.
          /** @type {<T>(name: string, run: () => Promise<T>) => Promise<T | { error: string }>} */
          const seed = (name, run) => limited(FAST_STEP_MS, name, run, sleep)
          const history = await seed('readHistory', () => a.readHistory())
          const diffs = await seed('readDiffs', () => a.readDiffs())
          const formsRead = await seed('readForms', () => a.readForms())
          if (!current()) return
          this.history = Array.isArray(history) ? history : []
          // A fixture says which diffs were opened, since nobody clicks in a recording.
          // Their keys are those of `issueKey`: a number, or `owner/repo#N`.
          const key = (/** @type {string} */ k) => (/^\d+$/.test(k) ? Number(k) : k)
          for (const [number, minutes] of Object.entries('error' in diffs ? {} : diffs)) {
            this.diffs[number] = now - Number(minutes) * 60_000
            this.makeForm(key(number))
          }
          const forms = 'error' in formsRead ? { time: {}, log: null } : formsRead
          for (const [number, patch] of Object.entries(forms.time)) {
            this.setTimeForm(key(number), { open: true, ...patch }, cx)
            const form = this.timeForms[number]
            ;/** @type {FormInputs} */ (this.timeInputs[number]).readMin.set_value(
              /** @type {TimeLogForm} */ (form).readMin
            )
            ;/** @type {FormInputs} */ (this.timeInputs[number]).handMin.set_value(
              /** @type {TimeLogForm} */ (form).handMin
            )
            ;/** @type {FormInputs} */ (this.timeInputs[number]).remark.set_value(
              /** @type {TimeLogForm} */ (form).remark
            )
          }
          if (this.logState !== null && forms.log !== null) {
            const { form, inputs } = this.logState
            Object.assign(form, forms.log)
            inputs.issue.set_value(form.issue)
            inputs.what.set_value(form.what)
          }
        }
        const load = /** @type {Machine | null} */ (this.state.sources.machine.value)?.load1 ?? null
        const cores = /** @type {Machine | null} */ (this.state.sources.machine.value)?.cores ?? 0
        if (this.isPanel() && this.config.fixture === null && this.saturation(load, cores, now)) {
          this.post(this.customizer.settings(), 'saturated', {
            title: 'Machine saturated',
            body: `Load ${load?.toFixed(0)} / ${cores} threads for a minute.`,
            level: /** @type {const} */ ('warning'),
            action: { name: 'factory.reveal:machine' },
          })
        }
        const sent = this.retries.check(load, cores)
        if (sent.length > 0) this.sentNote = `Sent to the master: ${sent.join(' · ')}`
        if (!this.config.fixture) this.history = pushLoad(this.history, now, load)
        if ('error' in stacks) {
          this.stacks = {
            ...this.stacks,
            stale: true,
            error: /** @type {string} */ (stacks.error),
          }
        } else {
          this.stacks = {
            value: parseStacks(stacks.text),
            at: stacks.at,
            stale: false,
            error: null,
          }
        }
        await this.readStackAges(sleep, current)
        this.retries.keep(new Set(this.needs().cards.map((c) => c.key)))
      } finally {
        this.gates.fast.end(generation)
      }
      cx.notify()
    })
  }

  /**
   * The age of each stack nobody owns, read once; a stack that is gone is forgotten. A read that does
   * not answer in its limit leaves the stack with no age.
   *
   * @param {(ms: number) => Promise<unknown>} sleep
   * @param {() => boolean} current whether the read that asks is still the newest
   */
  async readStackAges(sleep, current) {
    const rows = this.panel().sections.stacks.rows.filter((r) => r.removable)
    const names = new Set(rows.map((r) => r.name))
    for (const name of Object.keys(this.stackAges))
      if (!names.has(name)) delete this.stackAges[name]
    for (const name of names) {
      if (this.stackAges[name] !== undefined) continue
      const at = await limited(
        FAST_STEP_MS,
        'readStackAge',
        () => this.adapters.readStackAge(name),
        sleep
      )
      if (!current()) return
      if (typeof at === 'number') this.stackAges[name] = at
    }
  }

  /**
   * The milestones of each space, from GitHub, unless the pace of the quota or a hidden window says not to
   * (`readsNow` of `lib/quota.js`): a skipped read is not a failure, and the local reads go on.
   *
   * @param {Context} cx
   */
  slow(cx) {
    cx.spawn(async (cx) => {
      const sleep = (/** @type {number} */ ms) => cx.sleep(ms)
      const clock = await limited(SLOW_STEP_MS, 'now', () => this.adapters.now(), sleep)
      const now = typeof clock === 'number' ? clock : Date.now()
      const remote =
        this.config.fixture !== null ||
        readsNow({
          pace: paceOf(this.adapters.quota(), now),
          lastAt: this.githubAt,
          now,
          visible: window()?.visible,
        })
      // The pace comes first: a read it skips takes no gate, since it asks GitHub for nothing.
      const generation = remote ? this.gates.slow.start(Date.now()) : 0
      if (generation === null) return
      const current = () => !remote || this.gates.slow.isCurrent(generation)
      try {
        /** @type {Record<string, unknown>} */
        let reads = {}
        let at = now
        if (remote) {
          this.githubAt = now
          const read = await readSlow(this.adapters, this.config.spaces, { sleep })
          reads = read.reads
          at = read.now ?? now
        }
        if (!current()) return
        // A skipped read has no reads: the last ones stay and their ages are counted again from now.
        this.github = buildGithub({
          now: at,
          spaces: this.config.spaces,
          reads,
          previous: this.github,
        })
        await this.readShare(remote, sleep, current)
        // Only the panel draws the banner of the spaces.
        const epics = await readEpics(this.adapters, this.config.spaces, {
          sleep,
          now: at,
          remote: remote && this.isPanel(),
          previous: this.epics,
        })
        if (current()) this.epics = epics
        await this.readWorktree(sleep, current)
        await this.readCommits(sleep, current)
        if (!current()) return
        this.notifyNew()
      } finally {
        this.gates.slow.end(generation)
      }
      cx.notify()
    })
  }

  /** The milestones of each repository (when `remote`) and the project fields; a failed read keeps the last one. */
  async readShare(
    /** @type {boolean} */ remote,
    /** @type {(ms: number) => Promise<unknown>} */ sleep,
    /** @type {() => boolean} */ current
  ) {
    const [milestones, fields] = await Promise.all([
      remote
        ? limited(
            SLOW_STEP_MS,
            'readMilestones',
            () => this.adapters.readMilestones(this.config.spaces),
            sleep
          )
        : { error: 'not read' },
      limited(SLOW_STEP_MS, 'readProjectFields', () => this.adapters.readProjectFields(), sleep),
    ])
    if (!current()) return
    this.share = {
      milestones:
        'byRepo' in milestones
          ? /** @type {ShareInput['milestones']} */ (milestones.byRepo)
          : this.share.milestones,
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

  /** The subject of each open issue's commit message, from the packet its `### Progress` names, by key. */
  async readCommits(
    /** @type {(ms: number) => Promise<unknown>} */ sleep,
    /** @type {() => boolean} */ current
  ) {
    for (const space of this.config.spaces) {
      for (const { pair, raw } of pairReads(space, this.github?.spaces[space.name])) {
        for (const issue of raw.issues) {
          if (issue.state === 'closed') continue
          const packet = parseProgress(issue.body).packet
          if (packet === null) continue
          const dir = packet.startsWith('~/') ? `${home()}${packet.slice(1)}` : packet
          const key = issueKey(space, pair, issue.number)
          const subject = await limited(
            SLOW_STEP_MS,
            'readCommit',
            () => this.adapters.readCommit(issue.number, dir, pair.tag),
            sleep
          )
          if (!current()) return
          if (subject === null) delete this.commits[key]
          else if (typeof subject === 'string') this.commits[key] = subject
        }
      }
    }
  }

  /** The open issue, as GitHub gave it, with its comments, its space and its pair. */
  openIssue() {
    const space = this.config.spaces.find((s) => s.name === this.detail?.space)
    if (space === undefined) return null
    const repo = this.detail?.repo ?? space.repo
    for (const { pair, raw } of pairReads(space, this.github?.spaces[space.name])) {
      if (pair.repo !== repo) continue
      const issue = raw.issues.find((i) => i.number === this.detail?.number)
      if (issue === undefined) continue
      const comments = raw.comments[issue.number] ?? []
      return { space, pair, issue, comments, maintainer: raw.maintainer }
    }
    return null
  }

  /** The branch and the lines changed of the open issue's worktree, named in its `### Progress`. */
  async readWorktree(
    /** @type {(ms: number) => Promise<unknown>} */ sleep,
    /** @type {() => boolean} */ current
  ) {
    const open = this.detail === null ? null : this.openIssue()
    if (open === null) return
    const path = parseProgress(open.issue.body).worktree
    if (path === null) return
    const read = await limited(
      SLOW_STEP_MS,
      'readWorktree',
      () =>
        this.adapters.readWorktree(
          open.issue.number,
          path.startsWith('~/') ? `${home()}${path.slice(1)}` : path,
          open.pair.tag
        ),
      sleep
    )
    if (!current()) return
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
        repo: open.pair.repo,
        letter: (open.space.name[0] ?? '?').toUpperCase(),
        colour: ['space-m', 'space-f', 'space-p'][at % 3] ?? 'muted',
        name: open.space.name,
        tag: open.pair.tag,
        ref: refOf(open.space, open.pair, open.issue.number),
        tags: tagsOf(this.config.spaces),
      },
      now: this.now,
      agents,
      terminals: this.terminals,
      stacks: this.stacks.value,
      worktree: this.worktree,
      theme: this.themeNow(),
    })
  }

  /** The app's appearance now: the mod has no pick of its own. @returns {'dark' | 'light'} */
  themeNow() {
    return settings().dark === false ? 'light' : 'dark'
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
      stackAges: this.stackAges,
      history: this.history,
      config: this.config,
      theme: this.themeNow(),
      open: this.open,
      quota: this.adapters.quota(),
      milestones: this.share.milestones,
      epics: this.epics,
    })
  }

  render() {
    const appearance = this.themeNow()
    const settings = this.customizer.settings()
    this.ui.boardOn = settings.board
    this.ui.pending = this.outbox.state(Date.now())
    this.ui.sentNote = this.sentNote
    this.ui.actionNote = this.actionNote
    this.ui.confirmation = this.actions.pending()
    this.ui.processes = this.processes
    const ctx = {
      c: colours(theme(), appearance === 'dark'),
      theme: appearance,
      dark: appearance === 'dark',
      ui: this.ui,
    }
    if (this.customizing) {
      return v_flex()
        .id('factory-customize')
        .size_full()
        .bg(ctx.c.bg)
        .text_color(ctx.c.fg)
        .font_family(MONO)
        .text_size(12.5)
        .overflow_y_scrollbar()
        .child(customize(ctx, this.customizeModel()))
    }
    if (this.logOpen !== null) {
      return v_flex()
        .id('factory-log')
        .size_full()
        .bg(ctx.c.bg)
        .text_color(ctx.c.fg)
        .font_family(MONO)
        .text_size(12)
        .overflow_y_scrollbar()
        .child(logForm(ctx, this.logModel()))
    }
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
    const needsNow = this.needs()
    const header_ = { ...p.header, red: headerRed(settings, s) }
    const shown = banners(ctx, p.banners, controls(ctx, p.header))
    const needs = needsYou(ctx, needsNow, settings.hidden.includes('needs'))
    /** @type {Record<string, import('gpui-kit').NativeElement[]>} */
    const drawn = {
      needs: needs.items,
      machine: [machine(ctx, s.machine)],
      slots: [slots(ctx, s.slots)],
      workers: [leases(ctx, s.workers)],
      milestones: [milestones(ctx, s.milestones)],
      stacks: [stacks(ctx, s.stacks)],
      orphans: [orphans(ctx, s.orphans)],
    }
    const chosen = panelSections(settings, needsNow.count)
    this.order = [
      ...shown.map(() => ''),
      ...chosen.flatMap(({ name }) =>
        name === 'needs'
          ? needs.keys
          : /** @type {import('gpui-kit').NativeElement[]} */ (drawn[name]).map(() => name)
      ),
    ]
    return v_flex()
      .id('factory')
      .size_full()
      .bg(ctx.c.bg)
      .text_color(ctx.c.fg)
      .font_family(MONO)
      .text_size(12.5)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.keyDown(e, cx))
      .on_mouse_down('left', () => this.handle.focus())
      .child(header(ctx, header_, strip(ctx, p.strip)))
      .child(
        v_flex()
          .id('factory-scroll')
          .flex_1()
          .w_full()
          .overflow_y_scrollbar()
          .track_scroll(this.scroll)
          .children([
            ...shown,
            ...chosen.flatMap(
              ({ name }) => /** @type {import('gpui-kit').NativeElement[]} */ (drawn[name])
            ),
            footer(ctx, keyMap(keys())),
          ])
      )
  }
}
