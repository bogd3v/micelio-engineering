// The Board tab: the summary, the space and lane filters and seven columns of cards, one card for
// each issue of every space (`lib/board.js` says which column). It reads and draws; a card opens the
// issue detail and does nothing else.

import { div } from 'gpui-kit'
import { h_flex, v_flex } from 'gpui-base'
import { customizeButton } from './header.js'
import { badge, cat, displayBold, label, laneTag } from './ui.js'

/** @typedef {import('../../types/views.js').ViewContext} ViewContext */
/** @typedef {import('../../types/views.js').BoardModel} BoardModel */

/**
 * The frame of a card by its mark (`Board.dc.html`): magenta on a magenta ground for needs you, a
 * 6 px acid stripe for held, red on a red ground for red, a 2 px dim cyan stripe for the rest. A
 * border has one colour in Herdr's elements, so a stripe is a child of its own.
 *
 * @param {ViewContext} ctx
 * @param {BoardModel['columns'][number]['cards'][number]} card
 * @param {import('gpui-kit').NativeElement} body the card's content
 */
function frame(ctx, card, body) {
  const box = h_flex().border_1().mb(8).text_size(12)
  if (card.mark === 'needs')
    return box.border_color(ctx.c['magenta']).bg(ctx.c['magenta-bg']).child(body)
  if (card.mark === 'red') return box.border_color(ctx.c['red']).bg(ctx.c['red-bg']).child(body)
  const held = card.mark === 'held'
  return box
    .border_color(ctx.c[held ? 'fg' : 'line'])
    .bg(ctx.c['surface'])
    .child(
      div()
        .w(held ? 6 : 2)
        .flex_none()
        .bg(ctx.c[held ? 'warn-fill' : 'cyan-dim'])
    )
    .child(body)
}

/**
 * One card: the space, the issue, the lane, the round, a sentence, the cat and name of its agent and
 * how long.
 *
 * @param {ViewContext} ctx
 * @param {BoardModel['columns'][number]['cards'][number]} card
 */
function cardOf(ctx, card) {
  const body = v_flex()
    .flex_1()
    .min_w(0)
    .p(10)
    .child(
      h_flex()
        .items_center()
        .gap(6)
        .child(badge(ctx, card.letter, card.colour, 16))
        .child(div().font_bold().text_size(12).child(card.id))
        .child(laneTag(ctx, card.lane))
        .child(div().flex_grow(1))
        .child(label(card.round, ctx.c['muted'], 11))
    )
    .child(div().mt(6).child(card.text))
    .child(
      h_flex()
        .mt(6)
        .items_center()
        .justify_between()
        .gap(6)
        .child(
          h_flex()
            .items_center()
            .gap(6)
            .min_w(0)
            .children(
              card.cat === null ? [] : [cat(ctx, card.cat, 16, /** @type {string} */ (card.state))]
            )
            .child(label(card.agent ?? '--', ctx.c['muted'], 11).truncate())
        )
        .child(label(card.time, ctx.c['muted'], 11).whitespace_nowrap())
    )
  return frame(ctx, card, body)
    .id(`board-${card.space}-${card.id}`)
    .cursor_pointer()
    .tooltip('Open the issue')
    .on_click(() => ctx.ui.openDetail(card.space, card.number, card.repo))
}

/**
 * A filter button of the space or the lane row.
 *
 * @param {ViewContext} ctx
 * @param {'space' | 'lane'} kind
 * @param {{ key: string, label: string, pressed: boolean }} f
 */
function filterButton(ctx, kind, f) {
  const on = f.pressed
  const fill = kind === 'space' ? 'cyan' : 'fg'
  return displayBold(div())
    .id(`board-${kind}-${f.key}`)
    .cursor_pointer()
    .min_h(36)
    .px(14)
    .flex()
    .items_center()
    .text_size(12)
    .border_1()
    .border_color(ctx.c[on ? fill : 'line'])
    .bg(on ? ctx.c[fill] : ctx.c['bg'])
    .text_color(on ? ctx.c[kind === 'space' ? 'badge-fg' : 'bg'] : ctx.c['fg'])
    .on_click((_e, cx) => ctx.ui.setBoardFilter(kind, f.key, cx))
    .child(f.label)
}

/**
 * @param {ViewContext} ctx
 * @param {BoardModel} model `buildBoard(...)`
 */
export function board(ctx, model) {
  const stats = h_flex()
    .flex_wrap()
    .gap(8)
    .children(
      model.summary.map((s) =>
        h_flex()
          .items_center()
          .bg(ctx.c['surface'])
          .border_1()
          .border_color(ctx.c['line'])
          .child(div().w(2).h(30).flex_none().bg(ctx.c['cyan']))
          .child(
            h_flex()
              .items_center()
              .gap(6)
              .px(12)
              .py(6)
              .child(label(s.label, ctx.c['muted'], 11))
              .child(div().font_bold().text_color(ctx.c[s.tone]).child(s.value))
          )
      )
    )
  const header = h_flex()
    .items_center()
    .flex_wrap()
    .gap(12)
    .child(displayBold(div()).text_size(22).text_color(ctx.c['fg']).child('FACTORY BOARD'))
    .child(div().flex_grow(1))
    .child(stats)
    .child(customizeButton(ctx))
  const filters = h_flex()
    .flex_wrap()
    .gap(8)
    .children(model.filters.spaces.map((f) => filterButton(ctx, 'space', f)))
    .child(div().w(1).bg(ctx.c['line']))
    .children(model.filters.lanes.map((f) => filterButton(ctx, 'lane', f)))
  // The design's grid: seven columns of at least 180 px that share the width, and a scroll below 1330 px.
  const row = h_flex()
    .w_full()
    .min_w(1330)
    .gap(12)
    .items_start()
    .children(
      model.columns.map((col) => {
        const box = v_flex().flex_1().min_w(0).min_h(520).p(10)
        return (
          col.yours
            ? box.bg(ctx.c['magenta-bg']).border_1().border_dashed().border_color(ctx.c['magenta'])
            : box.bg(ctx.c['surface2']).border_1().border_color(ctx.c['line'])
        )
          .child(
            h_flex()
              .items_center()
              .justify_between()
              .pb(10)
              .child(
                displayBold(div())
                  .text_size(12)
                  .text_color(ctx.c[col.yours ? 'magenta' : 'cyan'])
                  .child(col.title.toUpperCase())
              )
              .child(label(`[${col.count}]`, ctx.c['muted'], 11))
          )
          .children(col.cards.map((c) => cardOf(ctx, c)))
      })
    )
  const columns = div().id('board-columns').w_full().overflow_x_scrollbar().child(row)
  return v_flex()
    .w_full()
    .gap(16)
    .p(20)
    .child(header)
    .children(model.note === null ? [] : [label(`! ${model.note}`, ctx.c['red'], 11)])
    .child(filters)
    .child(columns)
}
