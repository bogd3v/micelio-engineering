// Machine: one line when nominal; the load of the last 15 minutes, the memory and the temperature
// when open; the alarm (the pill, and the banner above the sections) when saturated.

import { div } from 'gpui-kit'
import { h_flex, v_flex } from 'gpui-base'
import { displayBold, heading, label, liveOrDim, section } from './ui.js'

/** @typedef {import('../../types/views.js').ViewContext} ViewContext */
/** @typedef {import('../../types/views.js').PanelSections} PanelSections */

/**
 * @param {ViewContext} ctx
 * @param {PanelSections['machine']} m `panel.sections.machine`
 */
export function machine(ctx, m) {
  const pill = displayBold(div()).px(8).py(2).text_size(11).child(m.pill)
  const styled = m.saturated
    ? pill.bg(ctx.c['warn-fill']).text_color(ctx.c['warn-fg'])
    : pill.border_1().border_color(ctx.c['cyan']).text_color(ctx.c['cyan'])
  const box = section(ctx).child(heading(ctx, 'machine', 'Machine', m.open, styled))
  if (!m.open) {
    return liveOrDim(ctx, box, m, [
      h_flex()
        .mt(8)
        .gap(4)
        .text_size(12)
        .text_color(ctx.c['muted'])
        .child(div().font_bold().text_color(ctx.c['cyan']).child(m.load))
        .child(`/ ${m.cores} · RAM ${m.ram} · ${m.temp} · ${m.agents} agents`),
    ])
  }
  const stat = (/** @type {string} */ name, /** @type {string} */ value) =>
    v_flex()
      .flex_1()
      .p(8)
      .bg(ctx.c['surface2'])
      .border_l(2)
      .border_color(ctx.c['cyan'])
      .child(label(name, ctx.c['muted'], 11))
      .child(div().font_bold().child(value))
  const content = v_flex()
    .child(
      h_flex()
        .items_baseline()
        .gap(8)
        .mt(10)
        .child(displayBold(div()).text_size(34).text_color(ctx.c[m.tone]).child(m.load))
        .child(
          label(
            `load / ${m.cores} threads · wait > ${Math.round(m.cores * 0.75)}`,
            ctx.c['muted'],
            12
          )
        )
    )
    .child(
      h_flex()
        .w_full()
        .h(8)
        .mt(8)
        .bg(ctx.c['track'])
        .child(
          div()
            .h_full()
            .w(`${Math.round(m.fraction * 100)}%`)
            .bg(ctx.c[m.tone])
        )
    )
    .child(
      h_flex()
        .w_full()
        .h(36)
        .mt(12)
        .gap(2)
        .items_end()
        .children(
          m.bars.map((bar) =>
            div()
              .flex_1()
              .h(
                `${bar.load === null ? 4 : Math.max(4, Math.round((Math.min(bar.load, m.cores * 1.35) / (m.cores * 1.35)) * 100))}%`
              )
              .bg(ctx.c[bar.tone])
          )
        )
    )
    .child(
      h_flex()
        .justify_between()
        .mt(4)
        .child(label('-15 min', ctx.c['muted'], 11))
        .child(label('now', ctx.c['muted'], 11))
    )
    .child(
      h_flex()
        .gap(8)
        .mt(12)
        .child(stat('RAM', `${m.ram} GB`))
        .child(stat('AGENTS', String(m.agents)))
        .child(stat('CPU TEMP', m.temp))
    )
  return liveOrDim(ctx, box, m, [content])
}
