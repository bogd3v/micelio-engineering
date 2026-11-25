// The legend of the gate track, under Milestones, and the footer of the panel: "log a correction", which opens
// the correction form (`herdr/mod/design/screens/Panel.png`; `ctx.ui.openLog(space, number)`, no issue chosen).

import { div } from 'gpui-kit'
import { h_flex } from 'gpui-base'
import { gateMark, label } from './ui.js'

const ENTRIES = [
  ['passed', 'passed'],
  ['running', 'running'],
  ['needs', 'needs you'],
  ['held', 'held'],
  ['omitted', 'omitted by lane'],
  ['red', 'red'],
]

/** @param {any} ctx */
export function legend(ctx) {
  return h_flex()
    .flex_wrap()
    .gap(10)
    .mt(10)
    .children(
      ENTRIES.map(([mark, text]) =>
        h_flex()
          .items_center()
          .gap(4)
          .child(gateMark(ctx, /** @type {string} */ (mark)))
          .child(label(/** @type {string} */ (text), ctx.c['muted'], 11))
      )
    )
}

/** @param {any} ctx */
export function footer(ctx) {
  return h_flex()
    .w_full()
    .px(16)
    .py(14)
    .gap(6)
    .text_size(11)
    .child(
      div()
        .id('log-correction')
        .cursor_pointer()
        .text_color(ctx.c['cyan'])
        .on_click(() => ctx.ui.openLog(null, null))
        .child('log a correction')
    )
}

export { div }
