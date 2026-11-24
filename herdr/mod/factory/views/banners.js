// The saturation alarm, the stale banner and the line of the paused factory.

import { div } from 'gpui-kit'
import { h_flex } from 'gpui-base'
import { displayBold, label } from './ui.js'

/**
 * @param {any} ctx
 * @param {any} banners `panel.banners`
 * @returns {any[]} the elements to show, none when nothing is wrong
 */
export function banners(ctx, banners) {
  /** @type {any[]} */
  const out = []
  if (banners.saturated !== null) {
    out.push(
      div()
        .mx(16)
        .mt(12)
        .p(10)
        .bg(ctx.c['warn-fill'])
        .text_color(ctx.c['warn-fg'])
        .text_size(12)
        .child(displayBold(div()).child(banners.saturated.title.toUpperCase()))
        .child(div().child(banners.saturated.text))
    )
  }
  if (banners.stale !== null) {
    out.push(
      div()
        .mx(16)
        .mt(12)
        .p(10)
        .border_1()
        .border_color(ctx.c['red'])
        .bg(ctx.c['red-bg'])
        .text_size(12)
        .text_color(ctx.c['fg'])
        .child(div().font_bold().text_color(ctx.c['red']).child(banners.stale.title))
        .child(div().child(banners.stale.text))
    )
  }
  if (banners.paused !== null) {
    out.push(
      h_flex()
        .px(16)
        .py(8)
        .border_b(1)
        .border_color(ctx.c['line'])
        .child(label(`> ${banners.paused}`, ctx.c['magenta'], 11.5))
    )
  }
  return out
}
