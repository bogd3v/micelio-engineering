// Orphans: processes under the factory's temporary folder that no slot and no agent owns. "Show process" reads
// its cores and age (`ctx.ui.showProcess(pid, cx)`, `ctx.ui.processes[pid]`); "Terminate…" asks for a
// confirmation (`ctx.ui.askTerminate(pid, cx)`).

import { div } from 'gpui-kit'
import { h_flex, v_flex } from 'gpui-base'
import { button, heading, label, section } from './ui.js'
import { confirmation } from './stacks.js'

/**
 * @param {any} ctx
 * @param {any} o `panel.sections.orphans`
 */
export function orphans(ctx, o) {
  const box = section(ctx, true).child(
    heading(
      ctx,
      'orphans',
      'Orphans',
      o.open,
      div().font_bold().text_size(12).text_color(ctx.c['red']).child(`[${o.count}]`),
      'red'
    )
  )
  if (!o.open) return box
  return box.children(
    o.rows.map((/** @type {any} */ row) =>
      v_flex()
        .mt(10)
        .p(10)
        .bg(ctx.c['red-bg'])
        .border_1()
        .border_color(ctx.c['red'])
        .child(
          div()
            .font_bold()
            .text_size(12)
            .text_color(ctx.c['red'])
            .child(`${row.command} · ${row.cwd}`)
        )
        .child(label(row.line, ctx.c['fg'], 12).mt(4))
        .child(
          ctx.ui.processes[row.pid] === undefined
            ? div()
            : v_flex()
                .mt(6)
                .gap(2)
                .child(label(`command  ${row.command}`, ctx.c['fg'], 11.5))
                .child(label(`cwd      ${row.cwd}`, ctx.c['fg'], 11.5))
                .child(label(`cores    ${ctx.ui.processes[row.pid].cores}`, ctx.c['fg'], 11.5))
                .child(
                  label(
                    `age      ${ctx.ui.formatAge(ctx.ui.processes[row.pid].ageMs)}`,
                    ctx.c['fg'],
                    11.5
                  )
                )
        )
        .child(
          h_flex()
            .mt(8)
            .gap(6)
            .child(
              button(ctx, `show-${row.pid}`, 'SHOW PROCESS', {
                tone: 'fg',
                click: (/** @type {any} */ _e, /** @type {any} */ cx) =>
                  ctx.ui.showProcess(row.pid, cx),
              })
            )
            .child(
              button(ctx, `terminate-${row.pid}`, 'TERMINATE…', {
                primary: true,
                tone: 'red',
                fg: 'btn-fg',
                click: (/** @type {any} */ _e, /** @type {any} */ cx) =>
                  ctx.ui.askTerminate(row.pid, cx),
              })
            )
        )
        .child(
          ctx.ui.confirmation !== null &&
            ctx.ui.confirmation.kind === 'process' &&
            ctx.ui.confirmation.target === String(row.pid)
            ? confirmation(ctx, ctx.ui.confirmation, 'red')
            : div()
        )
    )
  )
}
