// Needs you: what waits for the maintainer, oldest first, first in the panel and not collapsible while
// something waits (`herdr/mod/design/screens/Panel.png`, `TimeForm.png`). A click here never reaches a
// worker: a button opens a pane that only reads, or starts the 10 s countdown of a line for the master.
// `ctx.ui` gives `goTo(address)`, `openDiff(card)`, `openReports(card)`, `readDiffs(card, cx)`,
// `openDetail(space, number, repo)`, `setForm(issue, patch, cx)`, `inputs(issue)`, `timeInputs(issue)`, `setTimeForm(issue, patch, cx)`,
// `toggleTimer(issue, cx)` (`issue` is a card's key of its issue, `issueKey` of `lib/panel.js`), `send(card, cx)`,
// `undo(cx)` and `pending` (the countdown, `null` when none runs).

import { div } from 'gpui-kit'
import { h_flex, Input, v_flex } from 'gpui-base'
import { badge, button, cat, display, displayBold, label, laneTag } from './ui.js'

/** @typedef {import('../../types/views.js').ViewContext} ViewContext */
/** @typedef {import('../../types/views.js').Pending} Pending */
/** @typedef {import('../../types/views.js').ClickHandler} ClickHandler */

/** @typedef {import('../lib/needs.js').Card} Card */
/** @typedef {'number' | 'ref' | 'issue' | 'repo' | 'lane'} IssueFields */
/** @typedef {Card & Required<Pick<Card, IssueFields | 'form' | 'lines' | 'posted'>>} FormCard a card with a time form, closed (`null`) or open */
/** @typedef {FormCard & { form: import('../lib/needs.js').CardForm }} OpenFormCard a card that draws its time form */
/** @typedef {FormCard & Required<Pick<Card, 'worktree' | 'review' | 'verify' | 'laneText' | 'commit' | 'locked' | 'lockedNote'>>} SignoffCard */
/** @typedef {Card & Required<Pick<Card, 'items' | 'unread' | 'readCount' | 'messages'>>} BatchCard */
/** @typedef {Card & Required<Pick<Card, IssueFields>>} DecisionCard */
/** @typedef {DecisionCard & Required<Pick<Card, 'retryLabel' | 'armed' | 'armedNote'>>} HeldCard */

/** A pill of the time form: selected is filled cyan. */
function pill(
  /** @type {ViewContext} */ ctx,
  /** @type {string} */ id,
  /** @type {string} */ text,
  /** @type {boolean} */ on,
  /** @type {ClickHandler} */ click
) {
  const el = displayBold(div())
    .id(id)
    .min_h(32)
    .px(10)
    .flex()
    .items_center()
    .text_size(12)
    .cursor_pointer()
    .on_click(click)
    .child(text)
  return on
    ? el.bg(ctx.c['cyan']).text_color(ctx.c['badge-fg']).border_1().border_color(ctx.c['cyan'])
    : el.text_color(ctx.c['fg']).border_1().border_color(ctx.c['line'])
}

const legend = (/** @type {ViewContext} */ ctx, /** @type {string} */ text) =>
  displayBold(div()).text_size(11).text_color(ctx.c['muted']).mb(6).child(text.toUpperCase())

/** The top line of a card: the cat, the space's badge, what it is, the lane and the age. */
function top(/** @type {ViewContext} */ ctx, /** @type {Card} */ card) {
  const row = h_flex().items_center().gap(6).text_size(11).text_color(ctx.c['muted'])
  row.child(cat(ctx, card.cat.file, 24, card.cat.state))
  if (card.space !== null) row.child(badge(ctx, card.space.letter, card.space.colour, 16))
  if (card.lane !== undefined) row.child(laneTag(ctx, String(card.lane).toUpperCase()))
  else if (card.kind === 'batch') row.child(laneTag(ctx, 'EXPRESS'))
  row.child(div().flex_1().min_w(0).child(card.head))
  return row.child(
    div().flex_none().font_bold().text_color(ctx.c['magenta']).child(ctx.ui.formatAge(card.age))
  )
}

/** The facts of a sign-off: review, verification, lane, commit. */
function facts(/** @type {ViewContext} */ ctx, /** @type {SignoffCard} */ card) {
  /** @type {[string, string | null][]} */
  const lines = [
    ['REVIEW', card.review],
    ['VERIFY', card.verify],
    ['LANE', card.laneText],
    ['COMMIT', card.commit],
  ]
  return v_flex()
    .mt(8)
    .bg(ctx.c['surface'])
    .border_l(2)
    .border_color(ctx.c['cyan-dim'])
    .px(8)
    .py(6)
    .gap(4)
    .children(
      lines
        .filter(([, text]) => text !== null)
        .map(([name, text]) =>
          h_flex()
            .gap(8)
            .text_size(11.5)
            .child(label(name, ctx.c['muted'], 10.5).w(52).flex_none())
            .child(
              div()
                .flex_1()
                .min_w(0)
                .child(text ?? '')
            )
        )
    )
}

/** The countdown that replaces the button while a line waits, with its undo. */
function countdown(/** @type {ViewContext} */ ctx, /** @type {Pending} */ pending) {
  return h_flex()
    .mt(10)
    .items_center()
    .gap(8)
    .p(8)
    .bg(ctx.c['surface'])
    .border_1()
    .border_dashed()
    .border_color(ctx.c['magenta'])
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .gap(6)
        .child(div().text_size(12).child(`Sending ${pending.label} in ${pending.secondsLeft} s`))
        .child(
          div()
            .h(3)
            .w_full()
            .bg(ctx.c['track'])
            .child(
              div()
                .h(3)
                .w(`${Math.round(pending.fraction * 100)}%`)
                .bg(ctx.c['magenta'])
            )
        )
    )
    .child(
      button(ctx, 'needs-undo', 'UNDO', {
        tone: 'magenta',
        click: (_e, cx) => ctx.ui.undo(cx),
      })
    )
}

/**
 * The time form of an unlocked sign-off (`TimeForm.png`) or, with `log`, the one of an open pull request
 * (`TimeLog.png`: Noted, Diff or Reports, a timer for the hands-on check, "Posted on the PR").
 */
function timeForm(/** @type {ViewContext} */ ctx, /** @type {OpenFormCard} */ card, log = false) {
  const f = card.form
  const n = card.issue
  const inputs = log ? ctx.ui.timeInputs(n) : ctx.ui.inputs(n)
  const set =
    (/** @type {Record<string, unknown>} */ patch) =>
    /** @type {ClickHandler} */
    (_e, cx) => (log ? ctx.ui.setTimeForm(n, patch, cx) : ctx.ui.setForm(n, patch, cx))
  const minutes = (/** @type {import('gpui-base').InputState} */ state) =>
    div().w(64).flex_none().child(Input.new(state))
  const box = v_flex()
    .mt(10)
    .gap(10)
    .p(12)
    .bg(ctx.c['surface2'])
    .border_1()
    .border_color(ctx.c['line'])
  box.child(
    displayBold(div())
      .text_size(13)
      .text_color(ctx.c['cyan'])
      .child(log ? `// LOG TIME · PR OF #${n}` : `// TIME FOR #${n}`)
  )
  box.child(
    v_flex()
      .child(legend(ctx, 'Read first'))
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .children(
            log
              ? [pill(ctx, `read-none-${n}`, 'Noted', f.read === 'none', set({ read: 'none' }))]
              : []
          )
          .child(pill(ctx, `read-diff-${n}`, 'Diff', f.read === 'diff', set({ read: 'diff' })))
          .child(
            pill(ctx, `read-report-${n}`, 'Reports', f.read === 'report', set({ read: 'report' }))
          )
          .child(inputs === null ? div() : minutes(inputs.readMin))
          .child(label('min', ctx.c['muted'], 12))
      )
      .child(
        label(
          log
            ? 'Only if not noted yet; a later note keeps it.'
            : f.read === 'diff'
              ? `Tracked ${f.tracked} min since you opened the diff.`
              : 'Reports first, before any diff.',
          ctx.c['muted'],
          11
        ).mt(4)
      )
  )
  if (f.showHands) {
    const row = h_flex().gap(6).items_center()
    for (const [kind, text] of /** @type {[string, string][]} */ ([
      ['none', 'None'],
      ['stack', 'Stack'],
      ['test', 'Test'],
    ])) {
      row.child(pill(ctx, `hand-${kind}-${n}`, text, f.hand === kind, set({ hand: kind })))
    }
    if (f.hand !== 'none' && inputs !== null) {
      row.child(minutes(inputs.handMin)).child(label('min', ctx.c['muted'], 12))
    }
    if (f.hand !== 'none' && log) {
      row.child(
        displayBold(div())
          .id(`timer-${n}`)
          .min_h(32)
          .px(10)
          .flex()
          .items_center()
          .text_size(12)
          .cursor_pointer()
          .text_color(ctx.c['magenta'])
          .border_1()
          .border_color(ctx.c['magenta'])
          .on_click((_e, cx) => ctx.ui.toggleTimer(n, cx))
          .child(/** @type {string} */ (f.timer))
      )
    }
    box.child(v_flex().child(legend(ctx, 'Hands-on check')).child(row))
  } else {
    box.child(
      label(
        `> no hands-on check in the ${card.lane} lane: the diff does not reach the stack.`,
        ctx.c['muted'],
        11.5
      )
    )
  }
  box.child(
    v_flex()
      .child(legend(ctx, 'Remark (optional)'))
      .child(inputs === null ? div() : Input.new(inputs.remark))
  )
  box.child(
    v_flex()
      .child(legend(ctx, log ? '> posted on the PR' : '> sent to ' + card.space.name + ' · master'))
      .child(
        div()
          .p(8)
          .bg(ctx.c['bg'])
          .border_l(2)
          .border_color(ctx.c['cyan'])
          .text_size(11.5)
          .text_color(ctx.c['cyan'])
          .child((log ? card.posted : card.lines) ?? '…')
      )
      .child(f.error === null ? div() : label(`! ${f.error}`, ctx.c['red'], 11.5).mt(4))
  )
  return box
}

/** @param {ViewContext} ctx @param {SignoffCard} card */
function signoff(ctx, card) {
  const pending = ctx.ui.pending
  const mine = pending !== null && pending.key === card.key
  const body = v_flex()
    .child(top(ctx, card))
    .child(displayBold(div()).mt(8).text_size(14).child(card.text))
    .child(facts(ctx, card))
  body.child(
    h_flex()
      .mt(10)
      .gap(8)
      .child(
        button(ctx, `diff-${card.issue}`, 'OPEN DIFF', {
          click: () => ctx.ui.openDiff(card),
          disabled: card.worktree === null,
        })
      )
      .child(
        button(ctx, `reports-${card.issue}`, 'REPORTS', {
          tone: 'fg',
          click: () => ctx.ui.openReports(card),
        })
      )
  )
  if (card.locked) {
    return body.child(label(card.lockedNote, ctx.c['muted'], 11).mt(6))
  }
  body.child(timeForm(ctx, /** @type {OpenFormCard} */ (card)))
  if (mine) return body.child(countdown(ctx, pending))
  return body.child(
    button(ctx, `signoff-${card.issue}`, `APPROVE & SIGN OFF ${card.ref}`, {
      primary: true,
      disabled: card.lines === null || card.master === null || pending !== null,
      click: (_e, cx) => ctx.ui.send(card, cx),
    }).mt(10)
  )
}

/** @param {ViewContext} ctx @param {BatchCard} card */
function batch(ctx, card) {
  const pending = ctx.ui.pending
  const mine = pending !== null && pending.key === card.key
  const body = v_flex()
    .child(top(ctx, card))
    .child(displayBold(div()).mt(8).text_size(14).child(card.text))
  body.child(
    v_flex()
      .mt(8)
      .gap(6)
      .children(
        card.items.map((i) =>
          h_flex()
            .items_center()
            .gap(6)
            .text_size(11.5)
            .child(badge(ctx, i.space.letter, i.space.colour, 16))
            .child(div().flex_1().min_w(0).child(`${i.label} · ${i.title}`))
            .child(label(i.read ? 'read' : 'unread', i.read ? ctx.c['cyan'] : ctx.c['muted'], 11))
        )
      )
  )
  const unread = card.unread
  body.child(
    h_flex()
      .mt(10)
      .gap(8)
      .child(
        button(ctx, `read-diffs-${card.key}`, `READ THE ${card.items.length} DIFFS`, {
          disabled: unread === 0,
          click: (_e, cx) => ctx.ui.readDiffs(card, cx),
        })
      )
      .child(
        mine
          ? div()
          : button(ctx, `signoff-${card.key}`, `SIGN OFF ${card.readCount} EXPRESS`, {
              primary: true,
              disabled: card.messages.length === 0 || pending !== null,
              click: (_e, cx) => ctx.ui.send(card, cx),
            })
      )
  )
  if (mine) body.child(countdown(ctx, pending))
  return body.child(
    label(
      'One sign-off for the ones you have read. No hands-on check in this lane.',
      ctx.c['muted'],
      11
    ).mt(6)
  )
}

/** An open pull request with no `time:` note of the maintainer (`Panel.png`, f3-main; `TimeLog.png`). @param {ViewContext} ctx @param {FormCard} card */
function timeCard(ctx, card) {
  const pending = ctx.ui.pending
  const mine = pending !== null && pending.key === card.key
  const body = v_flex()
    .child(top(ctx, card))
    .child(displayBold(div()).mt(8).text_size(14).child(card.text))
  if (card.form === null) {
    return body.child(
      button(ctx, `log-time-${card.issue}`, 'LOG TIME', {
        tone: 'fg',
        click: (_e, cx) => ctx.ui.setTimeForm(card.issue, { open: true }, cx),
      }).mt(10)
    )
  }
  body.child(timeForm(ctx, /** @type {OpenFormCard} */ (card), true))
  if (mine) return body.child(countdown(ctx, pending))
  return body.child(
    button(ctx, `post-time-${card.issue}`, 'POST TIME NOTE', {
      primary: true,
      disabled: card.lines === null || card.master === null || pending !== null,
      click: (_e, cx) => ctx.ui.send(card, cx),
    }).mt(10)
  )
}

/** @param {ViewContext} ctx @param {DecisionCard} card */
function decision(ctx, card) {
  return v_flex()
    .child(top(ctx, card))
    .child(
      displayBold(div())
        .mt(8)
        .text_size(14)
        .child(
          `The worker asks: ${card.text.length > 120 ? `${card.text.slice(0, 117)}…` : card.text}`
        )
    )
    .child(
      button(ctx, `answer-${card.issue}`, 'ANSWER THROUGH THE MASTER', {
        primary: true,
        tone: 'magenta',
        click: () => ctx.ui.openDetail(card.space.name, card.number, card.repo),
      }).mt(10)
    )
}

/** @param {ViewContext} ctx @param {HeldCard} card */
function held(ctx, card) {
  const body = v_flex()
    .child(top(ctx, card))
    .child(displayBold(div()).mt(8).text_size(14).child(card.text))
    .child(
      h_flex()
        .mt(10)
        .gap(8)
        .child(
          button(ctx, `retry-${card.issue}`, card.retryLabel, {
            disabled: card.master === null,
            tip: 'This space has no master to send retry to.',
            click: (_e, cx) => ctx.ui.toggleRetry(card, cx),
          })
        )
    )
  if (card.armed) body.child(label(`> ${card.armedNote}`, ctx.c['cyan'], 11.5).mt(6))
  return body
}

/** @param {ViewContext} ctx @param {Card} card */
function master(ctx, card) {
  return v_flex()
    .child(top(ctx, card))
    .child(displayBold(div()).mt(8).text_size(14).child(card.text))
    .child(
      button(ctx, `go-${card.master}`, 'GO TO MASTER', {
        click: () => ctx.ui.goTo(card.master),
      }).mt(10)
    )
}

/**
 * The section as a list of elements, so that each card is an item of the panel's scroll and
 * `factory.reveal:card-<n>` can bring it into view: the heading first, then one element for each card.
 *
 * @param {ViewContext} ctx
 * @param {ReturnType<typeof import('../lib/needs.js').buildNeeds>} needs `buildNeeds`
 * @param {boolean} [collapsed] hidden in Customize: the heading and the count, no cards
 * @returns {{ items: import('gpui-kit').NativeElement[], keys: string[] }} empty when nothing waits
 */
export function needsYou(ctx, needs, collapsed = false) {
  if (needs.count === 0) return { items: [], keys: [] }
  const frame = () => v_flex().w_full().px(16).bg(ctx.c['magenta-bg'])
  const head = frame()
    .pt(14)
    .pb(12)
    .child(
      h_flex()
        .items_center()
        .justify_between()
        .child(display(div()).text_size(12).text_color(ctx.c['magenta']).child('// NEEDS YOU'))
        .child(label(`[${needs.count}] oldest first`, ctx.c['magenta'], 11))
    )
  if (ctx.ui.sentNote !== null) head.child(label(ctx.ui.sentNote, ctx.c['cyan'], 11.5).mt(6))
  if (needs.note !== null && needs.note !== undefined)
    head.child(label(`! ${needs.note}`, ctx.c['red'], 11).mt(6))
  const items = [head.id('needs')]
  const keys = ['needs']
  // Hidden in Customize while something waits: the heading and its count, no cards.
  if (collapsed) {
    items[0] = /** @type {import('gpui-kit').NativeElement} */ (items[0])
      .pb(14)
      .border_b(1)
      .border_color(ctx.c['line'])
    return { items, keys }
  }
  needs.cards.forEach((card, i) => {
    const inner =
      card.kind === 'signoff'
        ? signoff(ctx, /** @type {SignoffCard} */ (card))
        : card.kind === 'batch'
          ? batch(ctx, /** @type {BatchCard} */ (card))
          : card.kind === 'decision'
            ? decision(ctx, /** @type {DecisionCard} */ (card))
            : card.kind === 'held'
              ? held(ctx, /** @type {HeldCard} */ (card))
              : card.kind === 'time'
                ? timeCard(ctx, /** @type {FormCard} */ (card))
                : master(ctx, card)
    const last = i === needs.cards.length - 1
    const body = div()
      .id(`card-${card.key}`)
      .p(12)
      .bg(ctx.c['surface'])
      .border_1()
      .border_color(ctx.c['magenta'])
      .child(inner)
    items.push(
      frame()
        .id(`card-${i}`)
        .pb(last ? 14 : 12)
        .child(card.dim === true ? body.opacity(0.6) : body)
    )
    keys.push(`card-${i}`)
  })
  items[items.length - 1] = /** @type {import('gpui-kit').NativeElement} */ (
    items[items.length - 1]
  )
    .border_b(1)
    .border_color(ctx.c['line'])
  return { items, keys }
}
