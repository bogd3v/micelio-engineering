// The legend of the gate track, under Milestones.

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

export { div }
