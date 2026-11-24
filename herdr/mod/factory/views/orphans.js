// Orphans: processes under the factory's temporary folder that no slot and no agent owns.

import { div } from 'gpui-kit'
import { v_flex } from 'gpui-base'
import { heading, label, section } from './ui.js'

/**
 * @param {any} ctx
 * @param {any} o `panel.sections.orphans`
 */
export function orphans(ctx, o) {
  const box = section(ctx, true).child(
    heading(
      ctx,
      'orphans',
      'Orphans',
      o.open,
      div().font_bold().text_size(12).text_color(ctx.c['red']).child(`[${o.count}]`),
      'red'
    )
  )
  if (!o.open) return box
  return box.children(
    o.rows.map((/** @type {any} */ row) =>
      v_flex()
        .mt(10)
        .p(10)
        .bg(ctx.c['red-bg'])
        .border_1()
        .border_color(ctx.c['red'])
        .child(
          div()
            .font_bold()
            .text_size(12)
            .text_color(ctx.c['red'])
            .child(`${row.command} · ${row.cwd}`)
        )
        .child(label(row.line, ctx.c['fg'], 12).mt(4))
    )
  )
}
