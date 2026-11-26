// Worker leases: one cell per lease, the letter of the space that holds it.

import { div } from 'gpui-kit'
import { h_flex } from 'gpui-base'
import { displayBold, heading, label, liveOrDim, section } from './ui.js'

/** @typedef {import('../../types/views.js').ViewContext} ViewContext */
/** @typedef {import('../../types/views.js').PanelSections} PanelSections */

/**
 * @param {ViewContext} ctx
 * @param {PanelSections['workers']} w `panel.sections.workers`
 */
export function leases(ctx, w) {
  const box = section(ctx).child(
    heading(ctx, 'workers', 'Worker leases', w.open, label(w.count, ctx.c['muted'], 11))
  )
  if (!w.open) return box
  return liveOrDim(ctx, box, w, [
    h_flex()
      .gap(6)
      .mt(10)
      .children(
        w.cells.map((cell) =>
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
                .bg(ctx.c[/** @type {string} */ (cell.colour)])
                .text_color(ctx.c['badge-fg'])
                .tooltip(cell.title)
                .child(cell.label)
        )
      ),
  ])
}
