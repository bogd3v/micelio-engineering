// The header: the name, the age of the last sync and the theme toggle.

import { div, svg } from 'gpui-kit'
import { h_flex, v_flex } from 'gpui-base'
import { display, displayBold, label } from './ui.js'

const ICON = { dark: 'moon', light: 'sun', follow: 'auto' }
const NAME = { dark: 'Dark', light: 'Light', follow: 'Follow Herdr' }

/**
 * @param {any} ctx
 * @param {any} model `panel.header`
 * @param {any} strip the summary strip's element
 */
export function header(ctx, model, strip) {
  const theme = ctx.ui.themeName
  return v_flex()
    .w_full()
    .flex_none()
    .bg(ctx.c['surface'])
    .border_b(1)
    .border_color(ctx.c['line'])
    .child(
      h_flex()
        .items_center()
        .gap(10)
        .px(16)
        .pt(12)
        .pb(10)
        .child(displayBold(div()).text_size(16).text_color(ctx.c['fg']).child('FACTORY'))
        .child(div().flex_grow(1))
        .child(
          model.sync.stale
            ? displayBold(div()).text_size(11).text_color(ctx.c['red']).child(model.sync.text)
            : label(model.sync.text, ctx.c['muted'], 11)
        )
        .child(
          div()
            .id('theme')
            .w(32)
            .h(32)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .cursor_pointer()
            .border_1()
            .border_color(ctx.c['line'])
            .bg(ctx.c['surface2'])
            .text_color(ctx.c['fg'])
            .tooltip(`Theme: ${NAME[theme]}`)
            .on_click((/** @type {any} */ _e, /** @type {any} */ cx) => ctx.ui.cycleTheme(cx))
            .child(svg(`mods/factory/icons/${ICON[theme]}.svg`).size(15).text_color(ctx.c['fg']))
        )
    )
    .child(strip)
}

export { display }
