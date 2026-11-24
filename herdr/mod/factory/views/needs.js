// Needs you: what waits for the maintainer, oldest first, first in the panel and not collapsible while
// something waits (`herdr/mod/design/screens/Panel.png`, `TimeForm.png`). A click here never reaches a
// worker: a button opens a pane that only reads, or starts the 10 s countdown of a line for the master.
// `ctx.ui` gives `goTo(address)`, `openDiff(card)`, `openReports(card)`, `readDiffs(card, cx)`,
// `openDetail(space, number)`, `setForm(number, patch, cx)`, `inputs(number)`, `send(card, cx)`,
// `undo(cx)` and `pending` (the countdown, `null` when none runs).

import { div } from 'gpui-kit'
import { h_flex, Input, v_flex } from 'gpui-base'
import { badge, button, cat, display, displayBold, label, laneTag } from './ui.js'

/** A pill of the time form: selected is filled cyan. */
function pill(
  /** @type {any} */ ctx,
  /** @type {string} */ id,
  /** @type {string} */ text,
  /** @type {boolean} */ on,
  /** @type {any} */ click
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

const legend = (/** @type {any} */ ctx, /** @type {string} */ text) =>
  displayBold(div()).text_size(11).text_color(ctx.c['muted']).mb(6).child(text.toUpperCase())

/** The top line of a card: the cat, the space's badge, what it is, the lane and the age. */
function top(/** @type {any} */ ctx, /** @type {any} */ card) {
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
function facts(/** @type {any} */ ctx, /** @type {any} */ card) {
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
function countdown(/** @type {any} */ ctx, /** @type {any} */ pending) {
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
        click: (/** @type {any} */ _e, /** @type {any} */ cx) => ctx.ui.undo(cx),
      })
    )
}

/** The time form of an unlocked sign-off (`TimeForm.png`). */
function timeForm(/** @type {any} */ ctx, /** @type {any} */ card) {
  const f = card.form
  const n = card.number
  const inputs = ctx.ui.inputs(n)
  const set = (/** @type {any} */ patch) => (/** @type {any} */ _e, /** @type {any} */ cx) =>
    ctx.ui.setForm(n, patch, cx)
  const minutes = (/** @type {any} */ state) => div().w(64).flex_none().child(Input.new(state))
  const box = v_flex()
    .mt(10)
    .gap(10)
    .p(12)
    .bg(ctx.c['surface2'])
    .border_1()
    .border_color(ctx.c['line'])
  box.child(displayBold(div()).text_size(13).text_color(ctx.c['cyan']).child(`// TIME FOR #${n}`))
  box.child(
    v_flex()
      .child(legend(ctx, 'Read first'))
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(pill(ctx, `read-diff-${n}`, 'Diff', f.read === 'diff', set({ read: 'diff' })))
          .child(
            pill(ctx, `read-report-${n}`, 'Reports', f.read === 'report', set({ read: 'report' }))
          )
          .child(inputs === null ? div() : minutes(inputs.readMin))
          .child(label('min', ctx.c['muted'], 12))
      )
      .child(
        label(
          f.read === 'diff'
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
      .child(legend(ctx, '> sent to ' + card.space.name + ' · master'))
      .child(
        div()
          .p(8)
          .bg(ctx.c['bg'])
          .border_l(2)
          .border_color(ctx.c['cyan'])
          .text_size(11.5)
          .text_color(ctx.c['cyan'])
          .child(card.lines ?? '…')
      )
      .child(f.error === null ? div() : label(`! ${f.error}`, ctx.c['red'], 11.5).mt(4))
  )
  return box
}

/** @param {any} ctx @param {any} card */
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
        button(ctx, `diff-${card.number}`, 'OPEN DIFF', {
          click: () => ctx.ui.openDiff(card),
          disabled: card.worktree === null,
        })
      )
      .child(
        button(ctx, `reports-${card.number}`, 'REPORTS', {
          tone: 'fg',
          click: () => ctx.ui.openReports(card),
        })
      )
  )
  if (card.locked) {
    return body.child(label(card.lockedNote, ctx.c['muted'], 11).mt(6))
  }
  body.child(timeForm(ctx, card))
  if (mine) return body.child(countdown(ctx, pending))
  return body.child(
    button(ctx, `signoff-${card.number}`, `APPROVE & SIGN OFF #${card.number}`, {
      primary: true,
      disabled: card.lines === null || card.master === null || pending !== null,
      click: (/** @type {any} */ _e, /** @type {any} */ cx) => ctx.ui.send(card, cx),
    }).mt(10)
  )
}

/** @param {any} ctx @param {any} card */
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
        card.items.map((/** @type {any} */ i) =>
          h_flex()
            .items_center()
            .gap(6)
            .text_size(11.5)
            .child(badge(ctx, i.space.letter, i.space.colour, 16))
            .child(div().flex_1().min_w(0).child(`${i.space.name}#${i.number} · ${i.title}`))
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
          click: (/** @type {any} */ _e, /** @type {any} */ cx) => ctx.ui.readDiffs(card, cx),
        })
      )
      .child(
        mine
          ? div()
          : button(ctx, `signoff-${card.key}`, `SIGN OFF ${card.readCount} EXPRESS`, {
              primary: true,
              disabled: card.messages.length === 0 || pending !== null,
              click: (/** @type {any} */ _e, /** @type {any} */ cx) => ctx.ui.send(card, cx),
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

/** @param {any} ctx @param {any} card */
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
      button(ctx, `answer-${card.number}`, 'ANSWER THROUGH THE MASTER', {
        primary: true,
        tone: 'magenta',
        click: () => ctx.ui.openDetail(card.space.name, card.number),
      }).mt(10)
    )
}

/** @param {any} ctx @param {any} card */
function held(ctx, card) {
  const body = v_flex()
    .child(top(ctx, card))
    .child(displayBold(div()).mt(8).text_size(14).child(card.text))
    .child(
      h_flex()
        .mt(10)
        .gap(8)
        .child(
          button(ctx, `retry-${card.number}`, card.retryLabel, {
            disabled: card.master === null,
            tip: 'This space has no master to send retry to.',
            click: (/** @type {any} */ _e, /** @type {any} */ cx) => ctx.ui.toggleRetry(card, cx),
          })
        )
    )
  if (card.armed) body.child(label(`> ${card.armedNote}`, ctx.c['cyan'], 11.5).mt(6))
  return body
}

/** @param {any} ctx @param {any} card */
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
 * @param {any} ctx
 * @param {any} needs `buildNeeds`
 * @returns {{ items: any[], keys: string[] }} empty when nothing waits
 */
export function needsYou(ctx, needs) {
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
  const items = [head.id('needs')]
  const keys = ['needs']
  needs.cards.forEach((/** @type {any} */ card, /** @type {number} */ i) => {
    const inner =
      card.kind === 'signoff'
        ? signoff(ctx, card)
        : card.kind === 'batch'
          ? batch(ctx, card)
          : card.kind === 'decision'
            ? decision(ctx, card)
            : card.kind === 'held'
              ? held(ctx, card)
              : master(ctx, card)
    const last = i === needs.cards.length - 1
    items.push(
      frame()
        .id(`card-${i}`)
        .pb(last ? 14 : 12)
        .child(
          div()
            .id(`card-${card.key}`)
            .p(12)
            .bg(ctx.c['surface'])
            .border_1()
            .border_color(ctx.c['magenta'])
            .child(inner)
        )
    )
    keys.push(`card-${i}`)
  })
  items[items.length - 1] = items[items.length - 1].border_b(1).border_color(ctx.c['line'])
  return { items, keys }
}
