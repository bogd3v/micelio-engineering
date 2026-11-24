// The issue detail, an overlay opened from an issue row: the header, "Gates by round", "Agents on
// this issue", "Packet" and the closing sentence (`herdr/mod/design/screens/IssueDetail.png`). It
// reads and sends nothing: a packet path opens the file in a pane (`less`), an agent's name opens a
// pane that only shows its last lines (`watch` over `hc read`), and neither focuses a worker for typing.
// `ctx` is as in `views/ui.js`, with `ctx.ui.openFile(path)`, `ctx.ui.watchAgent(target)`,
// `ctx.ui.toggleTheme(cx)` and `ctx.ui.close(cx)`.

import { div } from 'gpui-kit'
import { h_flex, v_flex } from 'gpui-base'
import { badge, cat, display, displayBold, label, laneTag } from './ui.js'

/** The title of a section: `// NAME`, cyan. */
const title = (/** @type {any} */ ctx, /** @type {string} */ text) =>
  display(div()).text_size(12).text_color(ctx.c['cyan']).mb(10).child(`// ${text.toUpperCase()}`)

/**
 * The look of a cell of a round, by its mark (`Gates by round`: the same marks as the track, wider).
 *
 * @param {any} ctx
 * @param {{ mark: string, text: string }} cell
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

/** @param {any} ctx @param {any} model `buildDetail` */
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
  const button = (/** @type {string} */ id, /** @type {string} */ text, /** @type {any} */ click) =>
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
      button(
        'detail-theme',
        ctx.dark ? 'LIGHT' : 'DARK',
        (/** @type {any} */ _e, /** @type {any} */ cx) => ctx.ui.toggleTheme(cx)
      )
    )
    .child(
      button('detail-close', 'CLOSE', (/** @type {any} */ _e, /** @type {any} */ cx) =>
        ctx.ui.close(cx)
      )
    )
}

/** @param {any} ctx @param {any} model */
function gates(ctx, model) {
  return v_flex()
    .child(title(ctx, 'Gates by round'))
    .child(
      h_flex()
        .gap(6)
        .child(div().w(34).flex_none())
        .children(
          model.gateNames.map((/** @type {string} */ g) =>
            displayBold(div()).flex_1().min_w(0).text_size(10.5).text_color(ctx.c['muted']).child(g)
          )
        )
    )
    .children(
      model.rounds.map((/** @type {any} */ round) =>
        h_flex()
          .mt(6)
          .items_center()
          .gap(6)
          .child(label(round.name, ctx.c['muted'], 12).w(34).flex_none())
          .children(round.cells.map((/** @type {any} */ c) => cell(ctx, c)))
      )
    )
}

/** @param {any} ctx @param {any} model */
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
          model.agents.map((/** @type {any} */ a) => {
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
                      .on_click(() => ctx.ui.watchAgent(a.name, a.address))
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
                  .text_color(ctx.c[a.tone])
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

/** @param {any} ctx @param {any} model */
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
  const [a, b, c, d] = model.packet
  return v_flex()
    .child(title(ctx, 'Packet'))
    .child(h_flex().gap(8).child(item(a)).child(item(b)))
    .child(h_flex().mt(8).gap(8).child(item(c)).child(item(d)))
    .child(div().mt(10).text_size(11.5).text_color(ctx.c['muted']).child(model.closing))
}

/**
 * @param {any} ctx
 * @param {any} model `buildDetail`, or `null` before the first read of GitHub
 */
export function detail(ctx, model) {
  const body = v_flex().w_full().p(24).gap(20)
  if (model === null) return body.child(label('Reading the issue…', ctx.c['muted'], 12))
  return body
    .child(top(ctx, model))
    .child(gates(ctx, model))
    .child(agents(ctx, model))
    .child(packet(ctx, model))
}
