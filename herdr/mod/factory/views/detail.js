// The issue detail, an overlay opened from an issue row: the header, "Gates by round", "Decision for
// you" (only while the master has an open `**Decision needed**` comment), "Agents on this issue",
// "Packet" and the closing sentence (`herdr/mod/design/screens/IssueDetail.png`). It reads, and sends
// one thing: the answer of "Decision for you", `answer #N: <option>[ — <note>]`, to the space's master
// after a 10 s countdown that can be undone (closing the overlay cancels it). A packet path opens the
// file in a pane (`less`), an agent's name opens a pane that only shows its last lines (`watch` over
// `hc read`), and neither focuses a worker for typing.
// `ctx` is as in `views/ui.js`, with `ctx.ui.openLogFromDetail()` (the correction form of this issue), `ctx.ui.openFile(path)`, `ctx.ui.watchAgent(target)`,
// `ctx.ui.close(cx)` and, for the decision, `ctx.ui.answer` (`option`,
// `note`, `choose(letter, cx)`), `ctx.ui.send(model, cx)`, `ctx.ui.undo(cx)` and `ctx.ui.pending`.

import { div } from 'gpui-kit'
import { h_flex, Input, Textarea, v_flex } from 'gpui-base'
import { badge, cat, display, displayBold, label, laneTag } from './ui.js'

/** @typedef {import('../../types/views.js').ViewContext} ViewContext */
/** @typedef {import('../../types/views.js').DetailModel} DetailModel */
/** @typedef {import('../../types/views.js').DecisionModel} DecisionModel */
/** @typedef {import('../../types/views.js').LogModel} LogModel */
/** @typedef {import('../../types/views.js').ClickHandler} ClickHandler */

/** The title of a section: `// NAME`, cyan. */
const title = (/** @type {ViewContext} */ ctx, /** @type {string} */ text) =>
  display(div()).text_size(12).text_color(ctx.c['cyan']).mb(10).child(`// ${text.toUpperCase()}`)

/**
 * The look of a cell of a round, by its mark (`Gates by round`: the same marks as the track, wider).
 *
 * @param {ViewContext} ctx
 * @param {DetailModel['rounds'][number]['cells'][number]} cell
 */
function cell(ctx, cell) {
  const box = div()
    .flex_1()
    .min_w(0)
    .min_h(42)
    .overflow_hidden()
    .px(8)
    .py(6)
    .flex()
    .items_center()
    .text_size(11)
    .child(div().min_w(0).w_full().child(cell.text))
  switch (cell.mark) {
    case 'passed':
      return box
        .bg(ctx.c['surface2'])
        .text_color(ctx.c['fg'])
        .border_l(2)
        .border_color(ctx.c['cyan-dim'])
    case 'running':
      return box.bg(ctx.c['cyan']).text_color(ctx.c['badge-fg'])
    case 'needs':
      return box
        .bg(ctx.c['magenta-bg'])
        .text_color(ctx.c['magenta'])
        .border_1()
        .border_color(ctx.c['magenta'])
    case 'held':
      return box.bg(ctx.c['warn-fill']).text_color(ctx.c['warn-fg'])
    case 'red':
      return box.bg(ctx.c['red-bg']).text_color(ctx.c['red']).border_1().border_color(ctx.c['red'])
    case 'omitted':
      return box.text_color(ctx.c['muted']).border_1().border_dashed().border_color(ctx.c['muted'])
    default:
      return box.text_color(ctx.c['muted']).border_1().border_dashed().border_color(ctx.c['line'])
  }
}

/** @param {ViewContext} ctx @param {DetailModel} model `buildDetail` */
function top(ctx, model) {
  const h = model.header
  const facts = h_flex()
    .items_center()
    .gap(6)
    .flex_wrap()
    .text_size(11)
    .text_color(ctx.c['muted'])
    .child(laneTag(ctx, h.lane))
    .child(div().child(`${h.id}`))
  if (h.branch !== null) facts.child(div().child(`· ${h.branch}`))
  facts.child(div().child(`· ${h.stack}`))
  if (h.added !== null) {
    facts.child(label(`+${h.added}`, ctx.c['cyan'], 11))
    facts.child(label(`−${h.removed ?? 0}`, ctx.c['red'], 11))
  }
  const button = (
    /** @type {string} */ id,
    /** @type {string} */ text,
    /** @type {ClickHandler} */ click
  ) =>
    displayBold(div())
      .id(id)
      .h(36)
      .px(12)
      .flex()
      .items_center()
      .cursor_pointer()
      .border_1()
      .border_color(ctx.c['line'])
      .text_color(ctx.c['fg'])
      .text_size(12)
      .on_click(click)
      .child(text)
  return h_flex()
    .items_start()
    .gap(12)
    .child(badge(ctx, h.letter, h.colour, 28))
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .gap(2)
        .child(facts)
        .child(displayBold(div()).text_size(22).text_color(ctx.c['fg']).child(model.title))
    )
    .child(
      h_flex()
        .gap(8)
        .child(button('detail-log', 'LOG A CORRECTION', () => ctx.ui.openLogFromDetail()))
        .child(button('detail-close', 'CLOSE', (_e, cx) => ctx.ui.close(cx)))
    )
}

/** @param {ViewContext} ctx @param {DetailModel} model */
function gates(ctx, model) {
  return v_flex()
    .child(title(ctx, 'Gates by round'))
    .child(
      h_flex()
        .gap(6)
        .child(div().w(34).flex_none())
        .children(
          model.gateNames.map((g) =>
            displayBold(div()).flex_1().min_w(0).text_size(10.5).text_color(ctx.c['muted']).child(g)
          )
        )
    )
    .children(
      model.rounds.map((round) =>
        h_flex()
          .mt(6)
          .items_center()
          .gap(6)
          .child(label(round.name, ctx.c['muted'], 12).w(34).flex_none())
          .children(round.cells.map((c) => cell(ctx, c)))
      )
    )
}

/** @param {ViewContext} ctx @param {DetailModel} model */
function agents(ctx, model) {
  const col = [220, 150, 170, 148]
  const head = h_flex()
    .gap(8)
    .px(12)
    .py(8)
    .bg(ctx.c['surface2'])
    .text_size(10.5)
    .text_color(ctx.c['muted'])
    .children(
      ['AGENT', 'MODEL', 'STATE', 'TOKENS'].map((name, i) =>
        displayBold(div())
          .w(col[i] ?? 100)
          .flex_none()
          .child(name)
      )
    )
  return v_flex()
    .child(title(ctx, 'Agents on this issue'))
    .child(
      v_flex()
        .border_1()
        .border_color(ctx.c['line'])
        .child(head)
        .children(
          model.agents.map((a) => {
            const name = h_flex()
              .items_center()
              .gap(8)
              .w(col[0] ?? 100)
              .flex_none()
              .child(cat(ctx, a.cat, 24, a.catState))
              .child(
                a.address === null
                  ? div().truncate().child(a.name)
                  : div()
                      .id(`agent-${a.address}`)
                      .cursor_pointer()
                      .truncate()
                      .text_color(ctx.c['cyan'])
                      .tooltip('Opens a pane that only shows its last lines')
                      .on_click(() => ctx.ui.watchAgent(a.name, /** @type {string} */ (a.address)))
                      .child(a.name)
              )
            return h_flex()
              .items_center()
              .gap(8)
              .px(12)
              .py(9)
              .text_size(12)
              .border_t(1)
              .border_color(ctx.c['line'])
              .child(name)
              .child(
                label(a.model, ctx.c['muted'], 12)
                  .w(col[1] ?? 100)
                  .flex_none()
              )
              .child(
                div()
                  .w(col[2] ?? 100)
                  .flex_none()
                  .font_bold()
                  .text_color(ctx.c[/** @type {import('../lib/tokens.js').Token} */ (a.tone)])
                  .child(a.state)
              )
              .child(
                label(a.tokensText, ctx.c['muted'], 12)
                  .w(col[3] ?? 100)
                  .flex_none()
              )
          })
        )
    )
}

/** @param {ViewContext} ctx @param {DetailModel} model */
function packet(ctx, model) {
  const item = (/** @type {{ label: string, path: string | null, file: boolean }} */ p) => {
    const box = v_flex()
      .flex_1()
      .min_w(0)
      .min_h(44)
      .justify_center()
      .px(10)
      .py(6)
      .bg(ctx.c['surface'])
      .border_1()
      .border_color(ctx.c['line'])
      .border_l(2)
      .child(label(p.label, ctx.c['muted'], 10.5))
      .child(
        div()
          .text_size(12)
          .truncate()
          .text_color(ctx.c['fg'])
          .child(p.path ?? '--')
      )
    if (!p.file || p.path === null) return box
    const path = p.path
    return box
      .id(`packet-${p.label}`)
      .cursor_pointer()
      .tooltip('Opens the file in a pane')
      .on_click(() => ctx.ui.openFile(path))
  }
  const [a, b, c, d] =
    /** @type {[DetailModel['packet'][number], DetailModel['packet'][number], DetailModel['packet'][number], DetailModel['packet'][number]]} */ (
      model.packet
    )
  return v_flex()
    .child(title(ctx, 'Packet'))
    .child(h_flex().gap(8).child(item(a)).child(item(b)))
    .child(h_flex().mt(8).gap(8).child(item(c)).child(item(d)))
    .child(div().mt(10).text_size(11.5).text_color(ctx.c['muted']).child(model.closing))
}

/**
 * "Decision for you": the options of the master's `**Decision needed**` comment, a note, and the
 * button that sends `answer #N: <option>[ — <note>]` to the space's master after 10 s (`ctx.ui.answer`:
 * `option`, `note` (a textarea state), `choose(letter, cx)`, `send(model, cx)`, `undo(cx)`, `pending`).
 *
 * @param {ViewContext} ctx
 * @param {DecisionModel} model `buildDetail().decision`
 */
function decision(ctx, model) {
  const a = ctx.ui.answer
  const pending = ctx.ui.pending
  const box = v_flex()
    .p(16)
    .gap(10)
    .bg(ctx.c['magenta-bg'])
    .border_1()
    .border_color(ctx.c['magenta'])
  box.child(
    displayBold(div())
      .text_size(12)
      .text_color(ctx.c['magenta'])
      .child(`// ${model.title.toUpperCase()}`)
  )
  box.child(div().text_size(12.5).child(model.question))
  box.child(displayBold(div()).text_size(12).child('Which option?'))
  for (const o of model.options) {
    const on = a.option === o.letter
    box.child(
      h_flex()
        .id(`option-${o.letter}`)
        .items_center()
        .gap(10)
        .p(10)
        .cursor_pointer()
        .bg(ctx.c['surface'])
        .border_1()
        .border_color(on ? ctx.c['cyan'] : ctx.c['line'])
        .on_click((_e, cx) => a.choose(o.letter, cx))
        .child(
          displayBold(div())
            .w(22)
            .h(22)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .text_size(11)
            .bg(on ? ctx.c['cyan'] : ctx.c['surface2'])
            .text_color(on ? ctx.c['badge-fg'] : ctx.c['muted'])
            .child(o.letter)
        )
        .child(div().flex_1().min_w(0).text_size(12.5).child(o.text))
    )
  }
  box.child(
    v_flex()
      .gap(4)
      .child(
        div()
          .text_size(12)
          .child('Note for the master ')
          .child(label('(optional)', ctx.c['muted'], 12))
      )
      .child(
        div()
          .h(72)
          .child(Textarea.new(/** @type {import('gpui-base').TextareaState} */ (a.note)))
      )
  )
  if (pending !== null) {
    box.child(
      h_flex()
        .items_center()
        .gap(8)
        .p(8)
        .bg(ctx.c['surface'])
        .border_1()
        .border_dashed()
        .border_color(ctx.c['magenta'])
        .child(
          div()
            .flex_1()
            .text_size(12)
            .child(
              `Sending ${pending.label} in ${pending.secondsLeft} s. Closing this window cancels it.`
            )
        )
        .child(
          displayBold(div())
            .id('answer-undo')
            .min_h(32)
            .px(10)
            .flex()
            .items_center()
            .cursor_pointer()
            .text_size(12)
            .text_color(ctx.c['magenta'])
            .border_1()
            .border_color(ctx.c['magenta'])
            .on_click((_e, cx) => ctx.ui.undo(cx))
            .child('UNDO')
        )
    )
  } else {
    const ready = a.option !== null && model.master !== null
    const send = displayBold(div())
      .id('answer-send')
      .min_h(40)
      .px(14)
      .flex()
      .items_center()
      .justify_center()
      .text_size(13)
      .bg(ready ? ctx.c['btn-bg'] : ctx.c['track'])
      .text_color(ready ? ctx.c['btn-fg'] : ctx.c['muted'])
      .child(`SEND TO ${String(model.masterName).toUpperCase()} · MASTER`)
    if (ready) {
      send.cursor_pointer().on_click((_e, cx) => ctx.ui.send(model, cx))
    }
    box.child(send)
  }
  if (ctx.ui.sentNote !== null) box.child(label(ctx.ui.sentNote, ctx.c['cyan'], 11.5))
  return box.child(
    label(
      'Recorded in decisions.md and on the issue, then passed to the worker.',
      ctx.c['muted'],
      11.5
    )
  )
}

/**
 * @param {ViewContext} ctx
 * @param {DetailModel | null} model `buildDetail`, or `null` before the first read of GitHub
 */
export function detail(ctx, model) {
  const body = v_flex().w_full().p(24).gap(20)
  if (model === null) return body.child(label('Reading the issue…', ctx.c['muted'], 12))
  return body
    .child(top(ctx, model))
    .child(gates(ctx, model))
    .children(model.decision == null ? [] : [decision(ctx, model.decision)])
    .child(agents(ctx, model))
    .child(packet(ctx, model))
}

// The correction form (`herdr/mod/design/screens/LogForm.png`), the overlay opened with `log` in the props.
// "Log a correction" (`herdr/mod/design/screens/LogForm.png`): the issue, what was wrong, one of the six
// categories, the line the master will post and a button that starts the 10 s countdown of
// `log #N | <what> | <category>`, a line for the master of the issue's space. It opens from the issue detail
// and from the panel's footer, as an overlay of this mod (`props().log`); nothing is posted on GitHub.
// `ctx.ui.logForm` gives `model` (`lib/log.js`, `correctionLine`, with `masterName`, `master`, `form`),
// `inputs` (`issue`, `what`), `choose(category, cx)`, `send(cx)`, `undo(cx)`, `close()` and `pending`.

const logLegend = (/** @type {ViewContext} */ ctx, /** @type {string} */ text) =>
  displayBold(div()).text_size(11).text_color(ctx.c['muted']).mb(6).child(text.toUpperCase())

/** A category of the correction form: filled cyan when chosen. */
function categoryPill(
  /** @type {ViewContext} */ ctx,
  /** @type {string} */ name,
  /** @type {boolean} */ on
) {
  const el = displayBold(div())
    .id(`category-${name}`)
    .flex_1()
    .min_w(0)
    .min_h(36)
    .flex()
    .items_center()
    .justify_center()
    .text_size(12)
    .cursor_pointer()
    .on_click((_e, cx) => ctx.ui.logForm.choose(name, cx))
    .child(name)
  return on
    ? el.bg(ctx.c['cyan']).text_color(ctx.c['badge-fg']).border_1().border_color(ctx.c['cyan'])
    : el.text_color(ctx.c['fg']).border_1().border_color(ctx.c['line'])
}

/**
 * @param {ViewContext} ctx
 * @param {LogModel} model
 */
export function logForm(ctx, model) {
  const f = ctx.ui.logForm
  const pending = ctx.ui.pending
  const box = v_flex().w_full().p(16).gap(14)
  box.child(
    h_flex()
      .items_center()
      .gap(8)
      .child(
        displayBold(div())
          .flex_1()
          .text_size(13)
          .text_color(ctx.c['cyan'])
          .child('// LOG A CORRECTION')
      )
      .child(
        displayBold(div())
          .id('log-close')
          .text_size(11)
          .text_color(ctx.c['cyan'])
          .cursor_pointer()
          .on_click(() => ctx.ui.close())
          .child('CLOSE')
      )
  )
  box.child(
    label(
      'One line each time you send work back. The retro turns the ones that repeat into a test, a skill or a rule.',
      ctx.c['muted'],
      11.5
    )
  )
  box.child(
    v_flex()
      .child(logLegend(ctx, 'Issue'))
      .child(
        div()
          .w(120)
          .child(
            Input.new(/** @type {import('../../types/views.js').LogInputs} */ (f.inputs).issue)
          )
      )
  )
  box.child(
    v_flex()
      .child(
        div()
          .mb(6)
          .child(logLegend(ctx, 'What was wrong').mb(0).child(' '))
          .child(label('(not how it was fixed)', ctx.c['muted'], 11))
      )
      .child(
        div()
          .h(72)
          .child(
            Textarea.new(/** @type {import('../../types/views.js').LogInputs} */ (f.inputs).what)
          )
      )
  )
  box.child(
    v_flex()
      .child(logLegend(ctx, 'Category'))
      .child(
        v_flex()
          .gap(6)
          .child(
            h_flex()
              .gap(6)
              .children(
                model.categories
                  .slice(0, 3)
                  .map((c) => categoryPill(ctx, c, model.form.category === c))
              )
          )
          .child(
            h_flex()
              .gap(6)
              .children(
                model.categories
                  .slice(3)
                  .map((c) => categoryPill(ctx, c, model.form.category === c))
              )
          )
      )
  )
  box.child(
    v_flex()
      .child(logLegend(ctx, '> the master posts on the issue'))
      .child(
        div()
          .p(8)
          .bg(ctx.c['bg'])
          .border_l(2)
          .border_color(ctx.c['cyan'])
          .text_size(11.5)
          .text_color(ctx.c['cyan'])
          .child(model.posted)
      )
      .child(label('Destination stays “-” until the retro gives one.', ctx.c['muted'], 11).mt(4))
      .child(model.error === null ? div() : label(`! ${model.error}`, ctx.c['red'], 11.5).mt(4))
  )
  if (pending !== null) {
    box.child(
      h_flex()
        .items_center()
        .gap(8)
        .p(8)
        .bg(ctx.c['surface'])
        .border_1()
        .border_dashed()
        .border_color(ctx.c['magenta'])
        .child(
          div()
            .flex_1()
            .text_size(12)
            .child(
              `Sending ${pending.label} in ${pending.secondsLeft} s. Closing this window cancels it.`
            )
        )
        .child(
          displayBold(div())
            .id('log-undo')
            .min_h(32)
            .px(10)
            .flex()
            .items_center()
            .cursor_pointer()
            .text_size(12)
            .text_color(ctx.c['magenta'])
            .border_1()
            .border_color(ctx.c['magenta'])
            .on_click((_e, cx) => ctx.ui.undo(cx))
            .child('UNDO')
        )
    )
  } else {
    const ready = model.send !== null && model.master !== null
    const send = displayBold(div())
      .id('log-send')
      .min_h(42)
      .px(14)
      .flex()
      .items_center()
      .justify_center()
      .text_size(13)
      .bg(ready ? ctx.c['btn-bg'] : ctx.c['track'])
      .text_color(ready ? ctx.c['btn-fg'] : ctx.c['muted'])
      .child(`SEND TO ${model.masterName.toUpperCase()} · MASTER`)
    if (ready) {
      send.cursor_pointer().on_click((_e, cx) => f.send(cx))
    }
    box.child(send)
  }
  if (ctx.ui.sentNote !== null) box.child(label(ctx.ui.sentNote, ctx.c['cyan'], 11.5))
  return box
}
