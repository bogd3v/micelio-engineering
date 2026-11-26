// Stacks up: the Compose stacks that run, and the agent that owns each. A stack no live agent and no lease
// owns shows its age and "Bring down …", which asks for a confirmation (`ctx.ui.askBringDown(name, cx)`,
// `ctx.ui.confirmation`, `confirm(cx)`, `cancel(cx)`).

import { div } from 'gpui-kit'
import { h_flex, v_flex } from 'gpui-base'
import { button, displayBold, heading, label, section } from './ui.js'

/** @typedef {import('../../types/views.js').ViewContext} ViewContext */
/** @typedef {import('../../types/views.js').PanelSections} PanelSections */

/**
 * The question of a confirmation, with its two answers.
 *
 * @param {ViewContext} ctx
 * @param {{ title: string, detail: string }} ask
 * @param {string} tone
 */
export function confirmation(ctx, ask, tone) {
  return v_flex()
    .mt(8)
    .gap(6)
    .p(10)
    .bg(ctx.c['surface2'])
    .border_1()
    .border_color(ctx.c[tone])
    .child(displayBold(div()).text_size(13).text_color(ctx.c[tone]).child(ask.title))
    .child(label(ask.detail, ctx.c['fg'], 11.5))
    .child(
      h_flex()
        .gap(6)
        .child(
          button(ctx, 'confirm', 'CONFIRM', {
            primary: true,
            tone,
            fg: 'btn-fg',
            click: (_e, cx) => ctx.ui.confirm(cx),
          })
        )
        .child(
          button(ctx, 'cancel', 'CANCEL', {
            tone: 'fg',
            click: (_e, cx) => ctx.ui.cancel(cx),
          })
        )
    )
}

/**
 * @param {ViewContext} ctx
 * @param {PanelSections['stacks']} s `panel.sections.stacks`
 */
export function stacks(ctx, s) {
  const right = h_flex()
    .gap(4)
    .child(label(s.count.split(' · ')[0], ctx.c['muted'], 11))
    .child(s.unowned > 0 ? label(`· ${s.unowned} unowned`, ctx.c['magenta'], 11) : div())
  const box = section(ctx).child(heading(ctx, 'stacks', 'Stacks up', s.open, right))
  if (!s.open) return box
  if (s.error !== null) box.child(label(`! docker: ${s.error}`, ctx.c['red'], 11).mt(8))
  const ask = ctx.ui.confirmation
  return box
    .child(
      v_flex()
        .mt(6)
        .children(
          s.rows.map((row) =>
            h_flex()
              .items_center()
              .gap(8)
              .py(6)
              .border_b(1)
              .border_color(ctx.c['line'])
              .child(label(row.name, ctx.c['fg'], 12).flex_1().min_w(0).truncate())
              .child(
                row.owner === null
                  ? div()
                      .font_bold()
                      .text_size(11)
                      .text_color(ctx.c['magenta'])
                      .child(row.age === null ? 'NO AGENT' : `NO AGENT · ${row.age}`)
                  : label(row.owner, ctx.c['muted'], 11)
              )
              .child(label(row.status, ctx.c['muted'], 11))
          )
        )
    )
    .children(
      s.rows
        .filter((row) => row.removable)
        .map((row) =>
          v_flex()
            .child(
              button(ctx, `down-${row.name}`, `BRING DOWN ${row.name.toUpperCase()}…`, {
                tone: 'fg',
                click: (_e, cx) => ctx.ui.askBringDown(row.name, cx),
              }).mt(8)
            )
            .child(
              ask !== null && ask.kind === 'stack' && ask.target === row.name
                ? confirmation(ctx, ask, 'red')
                : div()
            )
        )
    )
}
