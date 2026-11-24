// The summary strip: load, heavy, workers, needs and orphans.

import { div } from 'gpui-kit'
import { h_flex, v_flex } from 'gpui-base'
import { displayBold, label } from './ui.js'

/**
 * @param {any} ctx
 * @param {{ key: string, label: string, value: string, tone: string, fill: string | null }[]} cells `panel.strip`
 */
export function strip(ctx, cells) {
  return h_flex()
    .w_full()
    .border_t(1)
    .border_color(ctx.c['line'])
    .children(
      cells.map((cell) => {
        const box = v_flex()
          .flex_1()
          .items_center()
          .py(6)
          .px(4)
          .border_r(1)
          .border_color(ctx.c['line'])
          .child(label(cell.label, ctx.c['muted'], 9.5))
          .child(displayBold(div()).text_size(14).text_color(ctx.c[cell.tone]).child(cell.value))
        return cell.fill === null ? box : box.bg(ctx.c[cell.fill])
      })
    )
}
