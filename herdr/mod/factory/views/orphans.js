// Orphans: processes under the factory's temporary folder that no slot and no agent owns. "Show process" reads
// its cores and age (`ctx.ui.showProcess(pid, cx)`, `ctx.ui.processes[pid]`); "Terminate…" asks for a
// confirmation (`ctx.ui.askTerminate(pid, cx)`).

import { div } from 'gpui-kit'
import { h_flex, v_flex } from 'gpui-base'
import { button, heading, label, liveOrDim, section } from './ui.js'
import { confirmation } from './stacks.js'

/** @typedef {import('../../types/views.js').ViewContext} ViewContext */
/** @typedef {import('../../types/views.js').PanelSections} PanelSections */

/**
 * @typedef {object} OrphansContext what the view itself reads while it draws; the helpers it draws
 * with and the two clicks take the whole `ViewContext`. `cores` is only written into a line, so a
 * string will do
 * @property {Partial<ViewContext['c']>} c a test gives no colours; the view itself reads them as the
 * `ViewContext` it also takes
 * @property {Pick<ViewContext['ui'], 'confirmation' | 'formatAge'> & {
 *   processes: Record<number, { cores: number | string, ageMs: number }>
 * }} ui
 */

/**
 * @param {ViewContext | OrphansContext} ctx
 * @param {Pick<PanelSections['orphans'], 'open' | 'count' | 'rows'> &
 *   Partial<Pick<PanelSections['orphans'], 'dim' | 'note'>>} o `panel.sections.orphans`; without
 *   `dim` it is drawn live
 */
export function orphans(ctx, o) {
  const box = section(/** @type {ViewContext} */ (ctx), true).child(
    heading(
      /** @type {ViewContext} */ (ctx),
      'orphans',
      'Orphans',
      o.open,
      div()
        .font_bold()
        .text_size(12)
        .text_color(/** @type {ViewContext} */ (ctx).c['red'])
        .child(`[${o.count}]`),
      'red'
    )
  )
  if (!o.open) return box
  return liveOrDim(
    /** @type {ViewContext} */ (ctx),
    box,
    o,
    o.rows.map((row) =>
      v_flex()
        .mt(10)
        .p(10)
        .bg(/** @type {ViewContext} */ (ctx).c['red-bg'])
        .border_1()
        .border_color(/** @type {ViewContext} */ (ctx).c['red'])
        .child(
          div()
            .font_bold()
            .text_size(12)
            .text_color(/** @type {ViewContext} */ (ctx).c['red'])
            .truncate()
            .child(row.title)
        )
        .child(label(row.line, /** @type {ViewContext} */ (ctx).c['fg'], 12).mt(4))
        .child(
          ctx.ui.processes[row.pid] === undefined
            ? div()
            : v_flex()
                .mt(6)
                .gap(2)
                .child(
                  label(`command  ${row.brief}`, /** @type {ViewContext} */ (ctx).c['fg'], 11.5)
                )
                .child(label(`cwd      ${row.cwd}`, /** @type {ViewContext} */ (ctx).c['fg'], 11.5))
                .child(
                  label(
                    `cores    ${/** @type {{ cores: number | string }} */ (ctx.ui.processes[row.pid]).cores}`,
                    /** @type {ViewContext} */ (ctx).c['fg'],
                    11.5
                  )
                )
                .child(
                  label(
                    `age      ${ctx.ui.formatAge(/** @type {{ ageMs: number }} */ (ctx.ui.processes[row.pid]).ageMs)}`,
                    /** @type {ViewContext} */ (ctx).c['fg'],
                    11.5
                  )
                )
        )
        .child(
          h_flex()
            .mt(8)
            .gap(6)
            .child(
              button(/** @type {ViewContext} */ (ctx), `show-${row.pid}`, 'SHOW PROCESS', {
                tone: 'fg',
                click: (_e, cx) => /** @type {ViewContext} */ (ctx).ui.showProcess(row.pid, cx),
              })
            )
            .child(
              button(/** @type {ViewContext} */ (ctx), `terminate-${row.pid}`, 'TERMINATE…', {
                primary: true,
                tone: 'red',
                fg: 'btn-fg',
                click: (_e, cx) => /** @type {ViewContext} */ (ctx).ui.askTerminate(row.pid, cx),
              })
            )
        )
        .child(
          ctx.ui.confirmation !== null &&
            ctx.ui.confirmation.kind === 'process' &&
            ctx.ui.confirmation.target === String(row.pid)
            ? confirmation(/** @type {ViewContext} */ (ctx), ctx.ui.confirmation, 'red')
            : div()
        )
    )
  )
}
