// "Needs you": what waits for the maintainer, oldest first, as plain data, and the lines a click sends
// to a master. A function of its arguments: the time, the facts and what the maintainer did (which
// diffs were opened, what the forms hold) are given by the caller. Nothing here calls `hc`: the
// caller's `send` does, and only through the outbox, which waits 10 s and can be undone.
//
// The lines are the forms of `herdr/master.md`, "Lines from the mod", character for character.

import { armedNote, retryLabel } from './actions.js'
import { catFile } from './cat.js'
import { fromBody, parseGates, saidOf } from './gates.js'
import { parseDecision } from './decision.js'
import { parseProgress } from './detail.js'
import { issueAt, issueKey, milestoneRows, onPair, pairReads, refOf } from './panel.js'
import {
  SEND_DELAY_MS,
  refText,
  hasTimeNote,
  minutesSince,
  timeLine,
  timeMessage,
  timerLabel,
  toMs,
} from './time.js'

/** The colour of a space's badge, by its position in the layout's props (as `panel.js`). */
const SPACE_COLOURS = ['space-m', 'space-f', 'space-p']

export { parseDecision }

/** What the locked sign-off says under its buttons. */
export const LOCKED_NOTE = 'Time form and sign-off unlock after the diff.'

/** What the sign-off says under its buttons when the issue's Progress names no worktree. */
export const NO_WORKTREE_NOTE = "Open diff needs the worktree in the issue's Progress."

/**
 * One line to send, and the terminal it goes to.
 *
 * @typedef {{ target: string, text: string }} Message
 *
 * @typedef {{ name: string, letter: string, colour: string }} SpaceBadge a space as a card names it
 *
 * @typedef {{ role: string, state: string, file: string | null }} CardCat the cat of a card
 */

/**
 * An express issue that waits for the shared sign-off.
 *
 * @typedef {object} ExpressItem
 * @property {number} number
 * @property {string} ref
 * @property {number | string} issue its key (`issueKey` of `panel.js`)
 * @property {string} repo
 * @property {string} title
 * @property {import('./gates.js').Gates['lane']} lane
 * @property {SpaceBadge} space
 * @property {string | null} master
 * @property {boolean} read its diff was opened
 * @property {number} at
 * @property {string} label
 * @property {string | null} worktree
 */

/**
 * The time form as a card draws it: a sign-off's or a "Log time" one.
 *
 * @typedef {object} CardForm
 * @property {'none' | 'diff' | 'report'} read
 * @property {string | null} [readMin]
 * @property {'none' | 'stack' | 'test'} hand
 * @property {string} handMin
 * @property {string} remark
 * @property {boolean} showHands
 * @property {string | null} error
 * @property {boolean} [open] "Log time" only
 * @property {number | null} [timerAt] "Log time" only
 * @property {string} [timer] "Log time" only
 * @property {number | null} [tracked] a sign-off only
 */

/**
 * A card of "Needs you". Every kind has the first nine fields; the others are those of its kind.
 *
 * @typedef {object} Card
 * @property {string} key
 * @property {'master' | 'time' | 'decision' | 'held' | 'signoff' | 'batch'} kind
 * @property {number} at since when it waits, milliseconds since the epoch
 * @property {number} age
 * @property {SpaceBadge} space
 * @property {string | null} master the master's address
 * @property {CardCat} cat
 * @property {string} head
 * @property {string} text
 * @property {boolean} [dim] it comes from a stale agents source
 * @property {number} [number]
 * @property {string} [ref]
 * @property {number | string} [issue]
 * @property {string} [repo]
 * @property {import('./gates.js').Gates['lane']} [lane]
 * @property {number} [pull] `time`
 * @property {CardForm | null} [form] `time` and `signoff`
 * @property {string | null} [lines] `time` and `signoff`: what the button sends
 * @property {string | null} [posted] `time`
 * @property {{ letter: string, text: string }[]} [options] `decision`
 * @property {boolean} [armed] `held`
 * @property {string} [retryLabel] `held`
 * @property {string | null} [armedNote] `held`
 * @property {string | null} [worktree] `signoff`
 * @property {string | null} [review] `signoff`
 * @property {string | null} [verify] `signoff`
 * @property {string} [laneText] `signoff`
 * @property {string | null} [commit] `signoff`
 * @property {boolean} [locked] `signoff`
 * @property {string} [lockedNote] `signoff`
 * @property {ExpressItem[]} [items] `batch`
 * @property {number} [unread] `batch`
 * @property {number} [readCount] `batch`
 * @property {Message[]} [messages] `batch`
 */

/** @param {string} text @returns {string} */
const oneLine = (text) => text.replaceAll(/\s+/g, ' ').trim()

/**
 * Why the master chose the lane: the lines of its last Gate 1 comment that are not the headline or the
 * `lane:` line.
 *
 * @param {import('./gates.js').Comment[]} comments
 * @param {string} maintainer
 * @returns {string}
 */
function laneWhy(comments, maintainer) {
  const gate1 = comments
    .filter((c) => c.user?.login === maintainer && fromBody(c, saidOf)?.gate === 1)
    .toSorted((a, b) => (toMs(a.created_at) ?? 0) - (toMs(b.created_at) ?? 0))
    .at(-1)
  return gate1 === undefined ? '' : (fromBody(gate1, whyOf) ?? '')
}

/**
 * The lines of a Gate 1 comment under its headline, but for the `lane:` line, as one line.
 *
 * @param {string} body
 * @returns {string}
 */
function whyOf(body) {
  return oneLine(
    body
      .split(/\r?\n/)
      .slice(1)
      .filter((l) => l.trim() !== '' && !/^\s*(?:[-*]\s+)?lane:/i.test(l))
      .join(' ')
  )
}

/**
 * The check an issue holds: the last line `held | <date> | #N | <gate> | <reason>` of the maintainer's login
 * (`herdr/master.md`, "A held check"; `owner/repo#N` for an issue of another repository of the space),
 * unless a later gate comment of the same gate reports the rerun.
 *
 * @param {import('./gates.js').Comment[]} comments
 * @param {string} maintainer
 * @param {number} number the issue's number: a line that names another one is not this issue's
 * @returns {{ gate: number, reason: string, at: number } | null}
 */
export function parseHeld(comments, maintainer, number) {
  const own = comments
    .filter((c) => c.user?.login === maintainer)
    .toSorted(
      (a, b) => (toMs(a.created_at) ?? 0) - (toMs(b.created_at) ?? 0) || (a.id ?? 0) - (b.id ?? 0)
    )
  /** @type {{ gate: number, reason: string, at: number } | null} */
  let held = null
  for (const comment of own) {
    const line = fromBody(comment, heldLineOf)
    if (line !== null) {
      held =
        line.number === number
          ? { gate: line.gate, reason: line.reason, at: toMs(comment.created_at) ?? 0 }
          : null
      continue
    }
    if (held !== null && fromBody(comment, saidOf)?.gate === held.gate) held = null
  }
  return held
}

/**
 * The first `held |` line of a comment, wherever it is in the body.
 *
 * @param {string} body
 * @returns {{ number: number, gate: number, reason: string } | null}
 */
function heldLineOf(body) {
  const line = /^held \| [^|]*\| (?:[\w.-]+\/[\w.-]+)?#(\d+) \| G([2-6]) \| (.+)$/m.exec(body)
  return line === null
    ? null
    : {
        number: Number(line[1]),
        gate: Number(line[2]),
        reason: /** @type {string} */ (line[3]).trim(),
      }
}

/**
 * The sign-off line of one issue, with its time line when it has one.
 *
 * @param {number | string} issue the number of an issue of the space's repository, or its reference (`refOf` of `panel.js`)
 * @param {string | null} [time] a line `time: …`
 * @returns {string}
 */
export function signOffMessage(issue, time = null) {
  return `approved, sign off ${refText(issue)}${time === null ? '' : `\n${time}`}`
}

/**
 * The messages of a shared sign-off, one for each master (each gets only the numbers of its own
 * space, `G5.3`; a card holds one space's issues, so it is one message). Only an issue that is
 * `express` and whose diff was read is named, by its reference (`#N`, or `owner/repo#N` for an issue of
 * another repository of the space).
 *
 * @param {{ number: number, ref?: string, lane: string, read: boolean, master: string | null }[]} items
 * @returns {{ target: string, text: string }[]}
 */
function sharedMessages(items) {
  /** @type {Map<string, string[]>} */
  const byMaster = new Map()
  for (const item of items) {
    if (item.lane !== 'express' || !item.read || item.master === null) continue
    byMaster.set(item.master, [...(byMaster.get(item.master) ?? []), item.ref ?? `#${item.number}`])
  }
  return [...byMaster].map(([target, refs]) => ({
    target,
    text: `approved, sign off ${refs.join(' ')}`,
  }))
}

/**
 * The answer to a decision: `answer #N: <option>[ — <note>]` (`answer owner/repo#N: …` for an issue of
 * another repository of the space).
 *
 * @param {number | string} issue the number of an issue of the space's repository, or its reference
 * @param {string} option the letter
 * @param {string} [note]
 * @returns {string}
 */
export function answerLine(issue, option, note = '') {
  const text = oneLine(note)
  return `answer ${refText(issue)}: ${option}${text === '' ? '' : ` — ${text}`}`
}

/**
 * What the time form holds when the maintainer has not touched it.
 *
 * @typedef {object} Form
 * @property {'diff' | 'report'} read
 * @property {string | null} readMin `null`: the minutes since the diff was opened
 * @property {'none' | 'stack' | 'test'} hand
 * @property {string} handMin
 * @property {string} remark
 */

/** @returns {Form} */
export const emptyForm = () => ({
  read: 'diff',
  readMin: null,
  hand: 'none',
  handMin: '',
  remark: '',
})

/**
 * What the form of "Log time" on an open pull request holds when the maintainer has not touched it.
 *
 * @typedef {object} TimeLogForm
 * @property {boolean} open
 * @property {'none' | 'diff' | 'report'} read `none` is "Noted": it was read before
 * @property {string} readMin
 * @property {'none' | 'stack' | 'test'} hand
 * @property {string} handMin
 * @property {string} remark
 * @property {number | null} timerAt when the hands-on timer started
 */

/** @returns {TimeLogForm} */
export const emptyTimeLogForm = () => ({
  open: false,
  read: 'none',
  readMin: '',
  hand: 'none',
  handMin: '',
  remark: '',
  timerAt: null,
})

/**
 * The cards of "Needs you".
 *
 * @param {object} input
 * @param {number} input.now milliseconds since the epoch
 * @param {{ spaces: import('./panel.js').SpaceName[] }} input.config a space with only its name has its master's card and no issue
 * @param {import('./panel.js').Github | null} input.github
 * @param {import('./agents.js').Agent[]} input.agents
 * @param {Record<string, number>} [input.blockedSince] when the panel first saw each blocked terminal (by address)
 * @param {Record<string, number>} [input.diffs] when the maintainer opened each issue's diff, by its key (`issueKey` of `panel.js`: the number in the space's repository, `owner/repo#N` in another)
 * @param {Record<string, string>} [input.commits] the subject of each issue's commit message, by its key
 * @param {Record<string, Partial<Form>>} [input.forms] the time forms, by key
 * @param {Record<string, boolean>} [input.armed] the retries the maintainer armed, by card key
 * @param {number} [input.cores] the machine's thread count, for the load a retry waits for
 * @param {Record<string, unknown>} [input.timeForms] the forms of "Log time", each a `Partial<TimeLogForm>`, by key
 * @param {'dark' | 'light'} [input.theme]
 * @param {string | null} [input.agentsNote] the note of a stale agents source (`notLive` of `panel.js`): the cards that come from the agents are dimmed
 */
export function buildNeeds({
  now,
  config,
  github,
  agents,
  blockedSince = {},
  diffs = {},
  commits = {},
  forms = {},
  armed = {},
  cores = 0,
  timeForms = {},
  theme = 'dark',
  agentsNote = null,
}) {
  /** @type {Card[]} */
  const cards = []
  /** @type {ExpressItem[]} */
  const express = []
  ;/** @type {import('./panel.js').SpaceConfig[]} */ (config.spaces).forEach((space, at) => {
    const badge = {
      name: space.name,
      letter: (space.name[0] ?? '?').toUpperCase(),
      colour: SPACE_COLOURS[at % SPACE_COLOURS.length] ?? 'muted',
    }
    const inSpace = agents.filter((a) => a.space?.name === space.name)
    const master = inSpace.find((a) => a.role === 'master') ?? null
    const masterAt = master === null ? null : master.address
    const cat = (/** @type {string} */ role, /** @type {string} */ state) => ({
      role,
      state,
      file: catFile(role, state, 24, theme) ?? null,
    })

    // A master that is blocked.
    if (master !== null && master.needsYou) {
      const since = blockedSince[master.address] ?? now
      cards.push({
        key: `master:${master.address}`,
        kind: 'master',
        at: since,
        age: Math.max(0, now - since),
        space: badge,
        master: masterAt,
        cat: cat('master', 'needs'),
        head: `${space.name} · master blocked`,
        text: 'Waiting for your reply in its pane.',
      })
    }

    const read = github?.spaces[space.name]
    // An issue is in one pair; its card names it by its reference, and keeps its state by its key.
    const carded = new Set()
    for (const { pair, raw } of pairReads(space, read)) {
      const ofPair = inSpace.filter((a) => onPair(a, pair))
      const { rows } = milestoneRows({ raw }, now, ofPair)
      const where = (/** @type {number} */ n) => issueAt(space, pair, n)
      const ids = (/** @type {number} */ n) => ({
        number: n,
        ref: refOf(space, pair, n),
        issue: issueKey(space, pair, n),
        repo: pair.repo,
      })

      // An open pull request with no `time:` note of the maintainer: a silent approval for `metrics`. One
      // card for each issue, the first pull request that names it. With no maintainer login, a pull
      // request with a note cannot be told from one without, so there is no card.
      for (const pull of raw.maintainer === '' ? [] : raw.pulls) {
        const number = pull.issue
        const row = number === null ? undefined : rows.find((r) => r.number === number)
        if (number === null || row === undefined) continue
        const noted = [...pull.comments, ...pull.reviews].some(
          (c) => c.user?.login === raw.maintainer && fromBody(c, hasTimeNote) === true
        )
        const id = ids(number)
        if (noted || carded.has(id.issue)) continue
        carded.add(id.issue)
        const form = {
          ...emptyTimeLogForm(),
          .../** @type {Partial<TimeLogForm> | undefined} */ (timeForms[id.issue]),
        }
        // A running timer has not added its minutes yet: the line waits for it to stop.
        const time = !form.open
          ? null
          : form.timerAt === null
            ? timeLine({ ...form, lane: row.lane })
            : { line: null, error: 'Stop the timer first.' }
        const since = toMs(pull.created_at) ?? now
        cards.push({
          key: `time:${where(number)}`,
          kind: 'time',
          at: since,
          age: Math.max(0, now - since),
          space: badge,
          ...id,
          pull: pull.number,
          master: masterAt,
          lane: row.lane,
          cat: cat('master', 'needs'),
          head: `${where(number)} · PR open · G6`,
          text: 'No time note from you on this pull request yet.',
          form: form.open
            ? {
                ...form,
                showHands: row.lane === 'full',
                timer: timerLabel(form.timerAt, now),
                error: time?.error ?? null,
              }
            : null,
          lines: time?.line == null ? null : timeMessage(id.ref, time.line),
          posted: time?.line ?? null,
        })
      }

      for (const row of rows) {
        const issue = raw.issues.find((i) => i.number === row.number)
        const comments = raw.comments[row.number] ?? []
        const id = ids(row.number)

        // A decision a worker waits for.
        const decision = parseDecision(comments, raw.maintainer)
        if (decision !== null) {
          const waiting = ofPair.find((a) => a.issue === row.number && a.needsYou)
          const worker =
            waiting ?? ofPair.find((a) => a.issue === row.number && a.role === 'worker')
          const gates = parseGates({ comments, maintainer: raw.maintainer })
          cards.push({
            key: `decision:${where(row.number)}`,
            kind: 'decision',
            at: decision.at,
            age: Math.max(0, now - decision.at),
            space: badge,
            ...id,
            master: masterAt,
            lane: row.lane,
            cat: cat(worker?.role ?? 'worker', 'needs'),
            head: `${where(row.number)} · G2 · r${Math.max(1, gates.round)}`,
            text: decision.question,
            options: decision.options,
          })
        }

        // A check held by the load: its reason, and a retry the mod sends once.
        const held = parseHeld(comments, raw.maintainer, row.number)
        if (held !== null) {
          const key = `held:${where(row.number)}`
          const on = armed[key] === true
          cards.push({
            key,
            kind: 'held',
            at: held.at,
            age: Math.max(0, now - held.at),
            space: badge,
            ...id,
            master: masterAt,
            lane: row.lane,
            cat: cat(ofPair.find((a) => a.issue === row.number)?.role ?? 'worker', 'held'),
            head: `${where(row.number)} · G${held.gate} · HELD`,
            text: held.reason,
            armed: on,
            retryLabel: retryLabel(cores, on),
            armedNote: on ? armedNote(cores) : null,
          })
        }

        if (row.marks[4] !== 'needs') continue
        const opened = diffs[id.issue]
        const item = {
          ...id,
          title: row.title,
          lane: row.lane,
          space: badge,
          master: masterAt,
          read: opened !== undefined,
          at: now - (row.waitMs ?? 0),
          label: where(row.number),
          worktree: parseProgress(issue?.body).worktree,
        }
        if (row.lane === 'express') {
          express.push(item)
          continue
        }

        // A sign-off.
        const gates = parseGates({ comments, maintainer: raw.maintainer })
        const last = (/** @type {number} */ gate) => gates.rounds.findLast((r) => r.gate === gate)
        const form = { ...emptyForm(), ...forms[id.issue] }
        const minutes = form.readMin ?? String(minutesSince(now, opened) ?? '')
        const time =
          opened === undefined ? null : timeLine({ ...form, readMin: minutes, lane: row.lane })
        const locked = opened === undefined
        cards.push({
          key: `signoff:${where(row.number)}`,
          kind: 'signoff',
          at: item.at,
          age: row.waitMs ?? 0,
          space: badge,
          ...id,
          master: masterAt,
          lane: row.lane,
          worktree: item.worktree,
          cat: cat('master', 'needs'),
          head: `${where(row.number)} · G5`,
          text: `Ready for your sign-off.${issue?.title ? ` ${issue.title}` : ''}`,
          review:
            /** @type {Card['lane']} */ (row.lane) === 'express' || last(3) === undefined
              ? null
              : last(3)?.summary || null,
          verify:
            /** @type {Card['lane']} */ (row.lane) === 'express' || last(4) === undefined
              ? null
              : last(4)?.summary || null,
          laneText:
            `${row.lane === 'full' ? 'Full' : row.lane === 'normal' ? 'Normal' : 'Express'}: ${laneWhy(comments, raw.maintainer)}`.trim(),
          commit: commits[id.issue] ?? null,
          locked,
          lockedNote: item.worktree === null ? NO_WORKTREE_NOTE : LOCKED_NOTE,
          form: locked
            ? null
            : {
                ...form,
                readMin: minutes,
                showHands: row.lane === 'full',
                tracked: minutesSince(now, opened),
                error: time?.error ?? null,
              },
          lines: locked || time?.line == null ? null : signOffMessage(id.ref, time.line),
        })
      }
    }
  })

  // The green express issues: one card for each space, so that a click sends exactly one message, to
  // that space's master.
  for (const group of Map.groupBy(express, (i) => i.space.name).values()) {
    const sorted = group.toSorted(
      (a, b) => a.at - b.at || a.number - b.number || a.ref.localeCompare(b.ref)
    )
    const at = sorted[0]?.at ?? now
    const readCount = sorted.filter((i) => i.read).length
    const space = /** @type {ExpressItem} */ (sorted[0]).space
    cards.push({
      key: `express:${space.name}`,
      kind: 'batch',
      at,
      age: Math.max(0, now - at),
      space,
      master: /** @type {ExpressItem} */ (sorted[0]).master,
      cat: { role: 'master', state: 'needs', file: catFile('master', 'needs', 24, theme) ?? null },
      head: `${space.name} · ${sorted.length} change${sorted.length === 1 ? '' : 's'} · G5 · no reviewer, no stack`,
      text: `${sorted.length} express change${sorted.length === 1 ? ' is' : 's are'} green.`,
      items: sorted,
      unread: sorted.length - readCount,
      readCount,
      messages: sharedMessages(sorted),
    })
  }

  cards.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))
  // The cards that show an agent's cat come from the agents: a stale source dims them, with one note.
  let dimmed = false
  for (const card of cards) {
    if (agentsNote === null || !['master', 'decision', 'held'].includes(card.kind)) continue
    card.dim = true
    dimmed = true
  }
  return { count: cards.length, cards, note: dimmed ? agentsNote : null }
}

/**
 * The messages a card sends when its main button is clicked: none while the sign-off is locked, while
 * the time form is invalid or while the space has no master.
 *
 * @param {unknown} given a card of `buildNeeds`
 * @returns {Message[]}
 */
export function cardMessages(given) {
  const card = /** @type {Card} */ (given)
  if (card.kind === 'batch') return /** @type {Message[]} */ (card.messages)
  if (card.kind === 'time') {
    return card.lines === null || card.master === null
      ? []
      : [{ target: card.master, text: /** @type {string} */ (card.lines) }]
  }
  if (card.kind !== 'signoff' || card.locked || card.lines === null || card.master === null) {
    return []
  }
  return [{ target: card.master, text: /** @type {string} */ (card.lines) }]
}

/**
 * The notification of a card that appeared. Its action is the mod's own command that scrolls the docked
 * panel to "Needs you": `mod.open` would open a new copy of the mod with no props (no spaces, no
 * maintainer), which draws an empty panel (`herdr/mod/findings.md`, questions 9 and 10).
 *
 * @param {{ head: string, text: string }} card
 */
export function notificationFor(card) {
  return {
    title: 'Needs you',
    body: `${card.head} · ${card.text}`,
    level: /** @type {const} */ ('warning'),
    action: { name: 'factory.reveal:needs' },
  }
}

/**
 * Holds one send for 10 s, in which it can be undone, and makes the call once, after them. `send`
 * is the caller's (`hc send <target> <text>`).
 *
 * @param {object} deps
 * @param {(target: string, text: string) => unknown} deps.send
 * @param {number} [deps.delayMs]
 */
export function createOutbox({ send, delayMs = SEND_DELAY_MS }) {
  /** @type {{ label: string, key: string, messages: { target: string, text: string }[], due: number } | null} */
  let pending = null
  return {
    /**
     * Starts the countdown of one click; false when another is running or there is nothing to send.
     *
     * @param {number} now
     * @param {string} label what the countdown says it sends
     * @param {{ target: string, text: string }[]} messages
     * @param {string} [key] the card whose click it is, so only that card draws the countdown
     */
    start(now, label, messages, key = '') {
      if (pending !== null || messages.length === 0) return false
      pending = { label, key, messages, due: now + delayMs }
      return true
    },
    /** Undoes the click: nothing is sent. */
    undo() {
      pending = null
    },
    /**
     * Sends what is due. Returns the messages it sent, `null` before they are due.
     *
     * @param {number} now
     */
    tick(now) {
      if (pending === null || now < pending.due) return null
      const done = pending
      pending = null
      for (const message of done.messages) send(message.target, message.text)
      return done.messages
    },
    /** @param {number} now @returns {{ label: string, key: string, secondsLeft: number, fraction: number } | null} */
    state(now) {
      if (pending === null) return null
      const left = Math.max(0, pending.due - now)
      return {
        label: pending.label,
        key: pending.key,
        secondsLeft: Math.ceil(left / 1000),
        fraction: left / delayMs,
      }
    },
  }
}
