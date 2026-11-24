// Worker leases: one cell per lease, the letter of the space that holds it.

import { div } from 'gpui-kit'
import { h_flex } from 'gpui-base'
import { displayBold, heading, label, section } from './ui.js'

/**
 * @param {any} ctx
 * @param {any} w `panel.sections.workers`
 */
export function leases(ctx, w) {
  const box = section(ctx).child(
    heading(ctx, 'workers', 'Worker leases', w.open, label(w.count, ctx.c['muted'], 11))
  )
  if (!w.open) return box
  return box.child(
    h_flex()
      .gap(6)
      .mt(10)
      .children(
        w.cells.map((/** @type {any} */ cell) =>
          cell.free
            ? div()
                .flex_1()
                .h(32)
                .flex()
                .items_center()
                .justify_center()
                .text_size(11)
                .border_1()
                .border_dashed()
                .border_color(ctx.c[w.paused ? 'magenta' : 'line'])
                .text_color(ctx.c[w.paused ? 'magenta' : 'muted'])
                .tooltip(cell.title)
                .child(cell.label)
            : displayBold(div())
                .flex_1()
                .h(32)
                .flex()
                .items_center()
                .justify_center()
                .text_size(13)
                .bg(ctx.c[cell.colour])
                .text_color(ctx.c['badge-fg'])
                .tooltip(cell.title)
                .child(cell.label)
        )
      )
  )
}
