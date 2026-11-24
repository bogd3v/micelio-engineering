// The header: the name and the age of the last sync; and the two buttons under the banners
// ("Pause new workers", "Reserve a slot").

import { div } from 'gpui-kit'
import { h_flex, v_flex } from 'gpui-base'
import { display, displayBold, label } from './ui.js'

/**
 * @param {any} ctx
 * @param {any} model `panel.header`
 * @param {any} strip the summary strip's element
 */
export function header(ctx, model, strip) {
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
    )
    .child(strip)
}

/**
 * The two buttons of the machine: no new worker, and a heavy slot kept for the maintainer. `ctx.ui` gives
 * `togglePause(cx)`, `toggleReserve(cx)` and `actionNote` (what the last click said, such as "no free slot").
 *
 * @param {any} ctx
 * @param {any} model `panel.header`
 */
export function controls(ctx, model) {
  /** @param {string} id @param {any} on @param {string} text @param {string} tone @param {any} click */
  const toggle = (id, on, text, tone, click) => {
    const el = displayBold(div())
      .id(id)
      .flex_1()
      .min_h(36)
      .px(12)
      .flex()
      .items_center()
      .justify_center()
      .text_size(12)
      .cursor_pointer()
      .on_click(click)
      .child(text.toUpperCase())
    return on.on
      ? el
          .bg(ctx.c[tone === 'magenta' ? 'magenta-bg' : 'warn-fill'])
          .text_color(ctx.c[tone === 'magenta' ? 'magenta' : 'warn-fg'])
          .border_1()
          .border_color(ctx.c[tone === 'magenta' ? 'magenta' : 'fg'])
      : el.text_color(ctx.c['fg']).border_1().border_color(ctx.c['line'])
  }
  return v_flex()
    .w_full()
    .px(16)
    .py(12)
    .gap(6)
    .border_b(1)
    .border_color(ctx.c['line'])
    .child(
      h_flex()
        .gap(8)
        .child(
          toggle(
            'pause',
            model.pause,
            model.pause.label,
            'magenta',
            (/** @type {any} */ _e, /** @type {any} */ cx) => ctx.ui.togglePause(cx)
          )
        )
        .child(
          toggle(
            'reserve',
            model.reserve,
            model.reserve.label,
            'warn',
            (/** @type {any} */ _e, /** @type {any} */ cx) => ctx.ui.toggleReserve(cx)
          )
        )
    )
    .child(ctx.ui.actionNote === null ? div() : label(`> ${ctx.ui.actionNote}`, ctx.c['red'], 11.5))
}

export { display }
