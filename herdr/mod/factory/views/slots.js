// Heavy slots and the queue.

import { div } from 'gpui-kit'
import { h_flex, v_flex } from 'gpui-base'
import { badge, cat, heading, label, liveOrDim, section } from './ui.js'
import { catFile } from '../lib/cat.js'

/**
 * @param {any} ctx
 * @param {any} s `panel.sections.slots`
 */
export function slots(ctx, s) {
  const box = section(ctx).child(
    heading(ctx, 'slots', 'Heavy slots', s.open, label(s.count, ctx.c['muted'], 11))
  )
  if (!s.open) return box
  const content = v_flex()
    .child(
      v_flex()
        .gap(6)
        .mt(10)
        .children(
          s.rows.map((/** @type {any} */ row) => {
            if (row.free) {
              return h_flex()
                .items_center()
                .gap(10)
                .px(10)
                .py(8)
                .min_h(40)
                .border_1()
                .border_dashed()
                .border_color(ctx.c['line'])
                .child(label(`0${row.n}`, ctx.c['muted'], 11))
                .child(label('[ free ]', ctx.c['muted'], 12))
            }
            return h_flex()
              .items_center()
              .gap(10)
              .px(10)
              .py(8)
              .bg(ctx.c['surface2'])
              .border_l(2)
              .border_color(ctx.c[row.held ? 'warn-fill' : 'cyan'])
              .child(label(`0${row.n}`, ctx.c['muted'], 11))
              .child(badge(ctx, row.badge.letter, row.badge.colour))
              .child(
                row.role === null
                  ? div()
                  : cat(ctx, catFile(row.role, 'working', 24, ctx.theme), 24, 'working')
              )
              .child(
                v_flex()
                  .flex_1()
                  .min_w(0)
                  .child(div().font_bold().truncate().child(row.agent))
                  .child(label(row.command, ctx.c['muted'], 11).truncate())
              )
              .child(label(row.time, ctx.c['cyan'], 12))
          })
        )
    )
    .child(
      div()
        .mt(10)
        .font_bold()
        .text_size(11)
        .text_color(ctx.c['muted'])
        .child(`> ${s.queueTitle}`.toUpperCase())
    )
    .children(
      s.queue.map((/** @type {any} */ q) =>
        h_flex()
          .items_center()
          .gap(8)
          .py(6)
          .text_size(12)
          .border_t(1)
          .border_dashed()
          .border_color(ctx.c['line'])
          .child(label(q.pos, ctx.c['muted'], 11))
          .child(badge(ctx, q.badge.letter, q.badge.colour))
          .child(
            q.role === null ? div() : cat(ctx, catFile(q.role, 'idle', 16, ctx.theme), 16, 'idle')
          )
          .child(
            h_flex()
              .flex_1()
              .min_w(0)
              .gap(4)
              .child(div().truncate().child(q.agent))
              .child(label(q.command, ctx.c['muted'], 12).truncate())
          )
          .child(label(q.wait, ctx.c['magenta'], 12))
      )
    )
  return liveOrDim(ctx, box, s, [content])
}
