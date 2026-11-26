// The legend of the gate track, under Milestones, and the footer of the panel: "log a correction", which opens
// the correction form (`herdr/mod/design/screens/Panel.png`; `ctx.ui.openLog(space, number)`, no issue chosen).

import { div } from 'gpui-kit'
import { h_flex } from 'gpui-base'
import { gateMark, label } from './ui.js'

/** @typedef {import('../../types/views.js').ViewContext} ViewContext */

const ENTRIES = [
  ['passed', 'passed'],
  ['running', 'running'],
  ['needs', 'needs you'],
  ['held', 'held'],
  ['omitted', 'omitted by lane'],
  ['red', 'red'],
]

/** @param {ViewContext} ctx */
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

/**
 * The footer: the keys of the panel (`Panel.png`) and "log a correction", which opens the correction form.
 * `keys` are the entries of `keyMap` (`lib/settings.js`): the key that acts, and what it does.
 *
 * @param {ViewContext} ctx
 * @param {{ id: string, shown: string, label: string }[]} [keys]
 */
export function footer(ctx, keys = []) {
  return h_flex()
    .w_full()
    .flex_wrap()
    .px(16)
    .py(14)
    .gap(6)
    .text_size(11)
    .text_color(ctx.c['muted'])
    .children(
      keys.map((k) => {
        // As `Panel.png`: the text of [L] is the link that opens the correction form, not a second one.
        const text =
          k.id === 'log'
            ? div()
                .id('log-correction')
                .cursor_pointer()
                .text_color(ctx.c['cyan'])
                .on_click(() => ctx.ui.openLog(null, null))
                .child(k.label)
            : div().child(k.label)
        return h_flex()
          .gap(4)
          .child(div().text_color(ctx.c['fg']).child(`[${k.shown.toUpperCase()}]`))
          .child(text)
      })
    )
}
