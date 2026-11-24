// "Needs you": what waits for the maintainer, oldest first, as plain data, and the lines a click sends
// to a master. A function of its arguments: the time, the facts and what the maintainer did (which
// diffs were opened, what the forms hold) are given by the caller. Nothing here calls `hc`: the
// caller's `send` does, and only through the outbox, which waits 10 s and can be undone.
//
// The lines are the forms of `herdr/master.md`, "Lines from the mod", character for character.

import { catFile } from './cat.js'
import { parseGates } from './gates.js'
import { parseDecision } from './decision.js'
import { parseProgress } from './detail.js'
import { milestoneRows } from './panel.js'
import { SEND_DELAY_MS, minutesSince, timeLine, toMs } from './time.js'

/** The colour of a space's badge, by its position in the layout's props (as `panel.js`). */
const SPACE_COLOURS = ['space-m', 'space-f', 'space-p']

export { parseDecision }

/** What the locked sign-off says under its buttons. */
export const LOCKED_NOTE = 'Time form and sign-off unlock after the diff.'

/**
 * The first line of a comment without its markup.
 *
 * @param {string} body
 * @returns {string}
 */
function firstLine(body) {
  return (body.split(/\r?\n/, 1)[0] ?? '')
    .replaceAll(/<[^>]*>/g, '')
    .replaceAll('*', '')
    .replace(/^\s*#+\s*/, '')
    .trim()
}

/** @param {string} text @returns {string} */
const oneLine = (text) => text.replaceAll(/\s+/g, ' ').trim()

/**
 * Why the master chose the lane: the lines of its last Gate 1 comment that are not the headline or the
 * `lane:` line.
 *
 * @param {{ user?: { login?: string }, body?: string, created_at?: string, id?: number }[]} comments
 * @param {string} maintainer
 * @returns {string}
 */
export function laneWhy(comments, maintainer) {
  const gate1 = comments
    .filter((c) => c.user?.login === maintainer && /^gate 1\b/i.test(firstLine(c.body ?? '')))
    .toSorted((a, b) => (toMs(a.created_at) ?? 0) - (toMs(b.created_at) ?? 0))
    .at(-1)
  if (gate1 === undefined) return ''
  return oneLine(
    (gate1.body ?? '')
      .split(/\r?\n/)
      .slice(1)
      .filter((l) => l.trim() !== '' && !/^\s*(?:[-*]\s+)?lane:/i.test(l))
      .join(' ')
  )
}

/**
 * The sign-off line of one issue, with its time line when it has one.
 *
 * @param {number} number
 * @param {string | null} [time] a line `time: …`
 * @returns {string}
 */
export function signOffMessage(number, time = null) {
  return `approved, sign off #${number}${time === null ? '' : `\n${time}`}`
}

/**
 * The messages of a shared sign-off, one for each master (each gets only the numbers of its own
 * space, `G5.3`; a card holds one space's issues, so it is one message). Only an issue that is
 * `express` and whose diff was read is named.
 *
 * @param {{ number: number, lane: string, read: boolean, master: string | null }[]} items
 * @returns {{ target: string, text: string }[]}
 */
export function sharedMessages(items) {
  /** @type {Map<string, number[]>} */
  const byMaster = new Map()
  for (const item of items) {
    if (item.lane !== 'express' || !item.read || item.master === null) continue
    byMaster.set(item.master, [...(byMaster.get(item.master) ?? []), item.number])
  }
  return [...byMaster].map(([target, numbers]) => ({
    target,
    text: `approved, sign off ${numbers.map((n) => `#${n}`).join(' ')}`,
  }))
}

/**
 * The answer to a decision: `answer #N: <option>[ — <note>]`.
 *
 * @param {number} number
 * @param {string} option the letter
 * @param {string} [note]
 * @returns {string}
 */
export function answerLine(number, option, note = '') {
  const text = oneLine(note)
  return `answer #${number}: ${option}${text === '' ? '' : ` — ${text}`}`
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
 * The cards of "Needs you".
 *
 * @param {object} input
 * @param {number} input.now milliseconds since the epoch
 * @param {{ spaces: import('./panel.js').SpaceConfig[] }} input.config
 * @param {import('./panel.js').Github | null} input.github
 * @param {import('./agents.js').Agent[]} input.agents
 * @param {Record<string, number>} [input.blockedSince] when the panel first saw each blocked terminal (by address)
 * @param {Record<number, number>} [input.diffs] when the maintainer opened each issue's diff (by number)
 * @param {Record<number, string>} [input.commits] the subject of each issue's commit message
 * @param {Record<number, Partial<Form>>} [input.forms] the time forms
 * @param {'dark' | 'light'} [input.theme]
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
  theme = 'dark',
}) {
  /** @type {any[]} */
  const cards = []
  /** @type {any[]} */
  const express = []
  config.spaces.forEach((space, at) => {
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
    const raw = read?.raw
    if (raw == null) return
    const { rows } = milestoneRows(read, now, inSpace)

    for (const row of rows) {
      const issue = raw.issues.find((i) => i.number === row.number)
      const comments = raw.comments[row.number] ?? []

      // A decision a worker waits for.
      const decision = parseDecision(comments, raw.maintainer)
      if (decision !== null) {
        const waiting = inSpace.find((a) => a.issue === row.number && a.needsYou)
        const worker = waiting ?? inSpace.find((a) => a.issue === row.number && a.role === 'worker')
        const gates = parseGates({ comments, maintainer: raw.maintainer })
        cards.push({
          key: `decision:${space.name}#${row.number}`,
          kind: 'decision',
          at: decision.at,
          age: Math.max(0, now - decision.at),
          space: badge,
          number: row.number,
          master: masterAt,
          lane: row.lane,
          cat: cat(worker?.role ?? 'worker', 'needs'),
          head: `${space.name}#${row.number} · G2 · r${Math.max(1, gates.round)}`,
          text: decision.question,
          options: decision.options,
        })
      }

      if (row.marks[4] !== 'needs') continue
      const opened = diffs[row.number]
      const item = {
        number: row.number,
        title: row.title,
        lane: row.lane,
        space: badge,
        master: masterAt,
        read: opened !== undefined,
        at: now - (row.waitMs ?? 0),
        repo: space.repo,
        worktree: parseProgress(issue?.body).worktree,
      }
      if (row.lane === 'express') {
        express.push(item)
        continue
      }

      // A sign-off.
      const gates = parseGates({ comments, maintainer: raw.maintainer })
      const last = (/** @type {number} */ gate) => gates.rounds.findLast((r) => r.gate === gate)
      const form = { ...emptyForm(), ...forms[row.number] }
      const minutes = form.readMin ?? String(minutesSince(now, opened) ?? '')
      const time =
        opened === undefined ? null : timeLine({ ...form, readMin: minutes, lane: row.lane })
      const locked = opened === undefined
      cards.push({
        key: `signoff:${space.name}#${row.number}`,
        kind: 'signoff',
        at: item.at,
        age: row.waitMs ?? 0,
        space: badge,
        number: row.number,
        master: masterAt,
        lane: row.lane,
        repo: space.repo,
        worktree: item.worktree,
        cat: cat('master', 'needs'),
        head: `${space.name}#${row.number} · G5`,
        text: `Ready for your sign-off.${issue?.title ? ` ${issue.title}` : ''}`,
        review: row.lane === 'express' || last(3) === undefined ? null : last(3)?.summary || null,
        verify: row.lane === 'express' || last(4) === undefined ? null : last(4)?.summary || null,
        laneText:
          `${row.lane === 'full' ? 'Full' : row.lane === 'normal' ? 'Normal' : 'Express'}: ${laneWhy(comments, raw.maintainer)}`.trim(),
        commit: commits[row.number] ?? null,
        locked,
        lockedNote: LOCKED_NOTE,
        form: locked
          ? null
          : {
              ...form,
              readMin: minutes,
              showHands: row.lane === 'full',
              tracked: minutesSince(now, opened),
              error: time?.error ?? null,
            },
        lines: locked || time?.line == null ? null : signOffMessage(row.number, time.line),
      })
    }
  })

  // The green express issues: one card for each space, so that a click sends exactly one message, to
  // that space's master.
  for (const group of Map.groupBy(express, (/** @type {any} */ i) => i.space.name).values()) {
    const sorted = group.toSorted(
      (/** @type {any} */ a, /** @type {any} */ b) => a.at - b.at || a.number - b.number
    )
    const at = sorted[0]?.at ?? now
    const readCount = sorted.filter((i) => i.read).length
    const space = sorted[0].space
    cards.push({
      key: `express:${space.name}`,
      kind: 'batch',
      at,
      age: Math.max(0, now - at),
      space,
      master: sorted[0].master,
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
  return { count: cards.length, cards }
}

/**
 * The messages a card sends when its main button is clicked: none while the sign-off is locked, while
 * the time form is invalid or while the space has no master.
 *
 * @param {any} card a card of `buildNeeds`
 * @returns {{ target: string, text: string }[]}
 */
export function cardMessages(card) {
  if (card.kind === 'batch') return card.messages
  if (card.kind !== 'signoff' || card.locked || card.lines === null || card.master === null) {
    return []
  }
  return [{ target: card.master, text: card.lines }]
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
