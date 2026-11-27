// The saturation alarm, the banners of a missing maintainer, of wrong spaces and of a stale GitHub, and
// the line of the paused factory.

import { div } from 'gpui-kit'
import { h_flex } from 'gpui-base'
import { displayBold, label } from './ui.js'

/** @typedef {import('../../types/views.js').ViewContext} ViewContext */
/** @typedef {import('../../types/views.js').PanelModel} PanelModel */

/**
 * @param {ViewContext} ctx
 * @param {PanelModel['banners']} banners `panel.banners`
 * @param {import('gpui-kit').NativeElement | null} [controls] the two buttons of the machine, which the design puts under the alarms and above the paused line
 * @returns {import('gpui-kit').NativeElement[]} the elements to show, none when nothing is wrong
 */
export function banners(ctx, banners, controls = null) {
  /** @type {import('gpui-kit').NativeElement[]} */
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
  const redBox = () =>
    div()
      .mx(16)
      .mt(12)
      .p(10)
      .border_1()
      .border_color(ctx.c['red'])
      .bg(ctx.c['red-bg'])
      .text_size(12)
      .text_color(ctx.c['fg'])
  /** @param {{ title: string, text: string }} red */
  const titled = (red) =>
    redBox()
      .child(div().font_bold().text_color(ctx.c['red']).child(red.title))
      .child(div().child(red.text))
  if (banners.maintainer !== null) out.push(titled(banners.maintainer))
  if (banners.spaces !== null) {
    const box = redBox()
    for (const line of banners.spaces) box.child(div().child(line))
    out.push(box)
  }
  if (banners.stale !== null) out.push(titled(banners.stale))
  if (controls !== null) out.push(controls)
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
