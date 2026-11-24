// Stacks up: the Compose stacks that run, and the agent that owns each.

import { div } from 'gpui-kit'
import { h_flex, v_flex } from 'gpui-base'
import { heading, label, section } from './ui.js'

/**
 * @param {any} ctx
 * @param {any} s `panel.sections.stacks`
 */
export function stacks(ctx, s) {
  const right = h_flex()
    .gap(4)
    .child(label(s.count.split(' · ')[0], ctx.c['muted'], 11))
    .child(s.unowned > 0 ? label(`· ${s.unowned} unowned`, ctx.c['magenta'], 11) : div())
  const box = section(ctx).child(heading(ctx, 'stacks', 'Stacks up', s.open, right))
  if (!s.open) return box
  if (s.error !== null) box.child(label(`! docker: ${s.error}`, ctx.c['red'], 11).mt(8))
  return box.child(
    v_flex()
      .mt(6)
      .children(
        s.rows.map((/** @type {any} */ row) =>
          h_flex()
            .items_center()
            .gap(8)
            .py(6)
            .border_b(1)
            .border_color(ctx.c['line'])
            .child(label(row.name, ctx.c['fg'], 12).flex_1().min_w(0).truncate())
            .child(
              row.owner === null
                ? div().font_bold().text_size(11).text_color(ctx.c['magenta']).child('NO AGENT')
                : label(row.owner, ctx.c['muted'], 11)
            )
            .child(label(row.status, ctx.c['muted'], 11))
        )
      )
  )
}
