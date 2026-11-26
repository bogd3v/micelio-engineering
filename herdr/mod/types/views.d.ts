// The types that several files of the mod share: what a view is given (`ViewContext`), the panel's
// own state and calls (`Ui`), the models and fields of `main.js`, and `exec` as `adapters.js` and
// `lib/actions.js` call it. Declarations only.

import type { ExecResult, TerminalRow } from 'herdr'
import type { Context, ClickHandler, FocusHandle } from 'gpui-kit'
import type { InputState, ScrollHandle, TextareaState } from 'gpui-base'
import type { createAdapters, readConfig } from '../factory/adapters.js'
import type { createActions, createRetries } from '../factory/lib/actions.js'
import type { createGate } from '../factory/lib/reads.js'
import type {
  createCustomize,
  createLook,
  createPoster,
  createSaturation,
} from '../factory/lib/settings.js'
import type { createOutbox, Form, TimeLogForm } from '../factory/lib/needs.js'
import type { buildState } from '../factory/lib/state.js'
import type { factoryShare } from '../factory/lib/board.js'
import type { Github } from '../factory/lib/panel.js'
import type { Confirmation } from '../factory/lib/actions.js'
import type { buildBoard } from '../factory/lib/board.js'
import type { buildDetail } from '../factory/lib/detail.js'
import type { correctionLine, LogForm } from '../factory/lib/log.js'
import type { Card, ExpressItem } from '../factory/lib/needs.js'
import type { buildPanel } from '../factory/lib/panel.js'

export type { ClickHandler, Context }

export type PanelModel = ReturnType<typeof buildPanel>
export type PanelSections = PanelModel['sections']
export type BoardModel = ReturnType<typeof buildBoard>
export type DetailModel = ReturnType<typeof buildDetail>
export type DecisionModel = NonNullable<DetailModel['decision']>

/** What the correction form shows (`logModel` of `main.js`). */
export type LogModel = ReturnType<typeof correctionLine> & {
  categories: readonly string[]
  form: LogForm
  masterName: string
  master: string | null
}

/** A card whose button sends something, or the decision of the overlay. */
export type SendTarget = Partial<Card> & {
  master: string | null
  question?: string
}

/** `exec` as the mod calls it: always with the arguments, so a stand-in may require them. */
export type Exec = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number }
) => Promise<ExecResult>

/** The countdown of one click, as the outbox gives it. */
export interface Pending {
  label: string
  key: string
  secondsLeft: number
  fraction: number
}

/** The inputs of a time form. */
export interface FormInputs {
  readMin: InputState
  handMin: InputState
  remark: InputState
}

/** The inputs of the correction form. */
export interface LogInputs {
  issue: InputState
  what: TextareaState
}

/** The cores and age of an orphan the maintainer asked to see. */
export interface ProcessRead {
  cores: number
  ageMs: number
}

/** What `openDiff` reads of a card or of an item of the shared sign-off. */
export interface DiffTarget {
  number: number
  issue: number | string
  worktree: string | null
  lane?: string
}

/** The panel's own state and what a click calls. */
export interface Ui {
  toggle(name: string, cx: Context): void
  openDetail(space: string, number: number, repo?: string): void
  openBoard(): void
  openCustomize(): void
  boardOn: boolean
  customize: {
    panel(on: boolean, cx: Context): void
    board(on: boolean, cx: Context): void
    move(name: string, by: -1 | 1, cx: Context): void
    toggleSection(name: string, cx: Context): void
    toggleAlert(name: string, cx: Context): void
    restore(cx: Context): void
  }
  setBoardFilter(kind: 'space' | 'lane', key: string, cx: Context): void
  formatAge(ms: number | null): string
  lockedNote: string
  pending: Pending | null
  sentNote: string | null
  actionNote: string | null
  confirmation: Confirmation | null
  processes: Record<number, ProcessRead>
  togglePause(cx: Context): void
  toggleReserve(cx: Context): void
  toggleRetry(card: Card, cx: Context): void
  askBringDown(project: string, cx: Context): void
  askTerminate(pid: number, cx: Context): void
  cancel(cx: Context): void
  confirm(cx: Context): void
  showProcess(pid: number, cx: Context): void
  goTo(address: string | null): void
  openDiff(card: DiffTarget): void
  readDiffs(card: { items: ExpressItem[] }, cx: Context): void
  openReports(card: { number: number; issue: number | string; repo: string }): void
  inputs(issue: number | string): FormInputs | null
  setForm(issue: number | string, patch: Record<string, unknown>, cx: Context): void
  timeInputs(issue: number | string): FormInputs | null
  setTimeForm(issue: number | string, patch: Record<string, unknown>, cx: Context): void
  toggleTimer(issue: number | string, cx: Context): void
  openLog(space: string | null, number: number | null): void
  openLogFromDetail(): void
  logForm: {
    inputs: LogInputs | null
    choose(category: string, cx: Context): void
    send(cx: Context): void
  }
  send(card: SendTarget, cx: Context): void
  undo(cx: Context): void
  answer: {
    option: string | null
    note: TextareaState | null
    choose(letter: string, cx: Context): void
  }
  openFile(path: string): void
  watchAgent(name: string, address: string): void
  close(cx?: Context): void
}

/** What every view is given. */
export interface ViewContext {
  /** The colours to draw with, by the names of `design/tokens.json`. */
  c: Record<string, string>
  theme: 'dark' | 'light'
  dark: boolean
  ui: Ui
}

type ShareInput = Parameters<typeof factoryShare>[0]

/** The `detail` prop: the overlay of an issue. */
export interface DetailProps {
  space: string
  number: number
  repo?: string
}

/** The `log` prop: the overlay of the correction form. */
export interface LogProps {
  space?: string | null
  number: number | null
  ref?: string
}

/**
 * The fields of the mod's view, assigned in `init` of `main.js`, which documents each. They are declared
 * on the type of its base class: assigned outside a constructor, each would else also be `undefined`.
 */
export interface FactoryState {
  config: ReturnType<typeof readConfig>
  adapters: ReturnType<typeof createAdapters>
  state: ReturnType<typeof buildState> | null
  github: Github | null
  stacks: {
    value: { name: string; status: string }[]
    at: string | null
    stale: boolean
    error: string | null
  }
  history: { at: number; load: number }[]
  terminals: TerminalRow[]
  detail: DetailProps | null
  board: boolean
  boardFilter: { space: string; lane: string }
  share: { milestones: ShareInput['milestones'] | null; fields: ShareInput['fields'] | null }
  worktree: { branch?: string; added?: number; removed?: number; error?: string } | null
  seeded: boolean
  now: number
  githubAt: number | null
  gates: { fast: ReturnType<typeof createGate>; slow: ReturnType<typeof createGate> }
  scroll: ScrollHandle
  order: string[]
  open: Record<string, boolean>
  commits: Record<string, string>
  blockedSince: Record<string, number>
  diffs: Record<string, number>
  forms: Record<string, Form>
  formInputs: Record<string, FormInputs>
  timeForms: Record<string, TimeLogForm>
  timeInputs: Record<string, FormInputs>
  customizing: boolean
  handle: FocusHandle
  nextCard: number
  customizer: ReturnType<typeof createCustomize>
  post: ReturnType<typeof createPoster>
  saturation: ReturnType<typeof createSaturation>
  look: ReturnType<typeof createLook>
  logOpen: LogProps | null
  logState: { form: LogForm; inputs: LogInputs } | null
  seen: Set<string> | null
  sentNote: string | null
  actions: ReturnType<typeof createActions>
  retries: ReturnType<typeof createRetries>
  actionNote: string | null
  processes: Record<number, ProcessRead>
  stackAges: Record<string, number>
  outbox: ReturnType<typeof createOutbox>
  ui: Ui
}
