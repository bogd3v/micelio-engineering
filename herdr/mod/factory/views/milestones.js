// Milestones: per space its master's cat and the pull requests merged; per issue its gate track,
// gate label, lane tag, the cats of its agents and its note. A stale read dims the section.

import { div } from 'gpui-kit'
import { h_flex, v_flex } from 'gpui-base'
import { badge, cat, displayBold, gateMark, heading, label, laneTag, section } from './ui.js'
import { legend } from './legend.js'

/**
 * @param {any} ctx
 * @param {any} m `panel.sections.milestones`
 */
export function milestones(ctx, m) {
  const open = displayBold(div())
    .id('open-board')
    .cursor_pointer()
    .min_h(24)
    .flex()
    .items_center()
    .text_size(11)
    .text_color(ctx.c['cyan'])
    .tooltip('Open the Board in a tab')
    .on_click(() => ctx.ui.openBoard())
    .child('OPEN BOARD >')
  // The cats come from the agents: a stale agents source dims them.
  const dimmed = (/** @type {any} */ el) => (m.catsDim === true ? el.opacity(0.6) : el)
  // With the Board tab off in Customize the button is gone.
  const box = section(ctx).child(
    heading(ctx, 'milestones', 'Milestones', m.open, ctx.ui.boardOn === false ? div() : open)
  )
  if (!m.open) return box
  if (m.note !== null) box.child(label(`! ${m.note}`, ctx.c['red'], 11).mt(8))
  if (m.catsNote !== null && m.catsNote !== undefined)
    box.child(label(`! agents ${m.catsNote}`, ctx.c['red'], 11).mt(8))
  for (const space of m.spaces) {
    const issues = v_flex()
      .mt(12)
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .child(badge(ctx, space.letter, space.colour, 18))
          .child(dimmed(cat(ctx, space.masterFile, 24, space.master ?? 'idle')))
          .child(div().flex_1().font_bold().child(space.name))
          .child(label(`PRs ${space.merged}`, ctx.c['muted'], 11))
      )
      .children(
        space.issues.map((/** @type {any} */ issue) =>
          v_flex()
            .py(7)
            .pl(26)
            .border_b(1)
            .border_color(ctx.c['line'])
            .child(
              h_flex()
                .items_center()
                .gap(10)
                .child(
                  label(issue.id, ctx.c['cyan'], 12)
                    .id(`issue-${space.name}-${issue.id}`)
                    .cursor_pointer()
                    .w(62)
                    .flex_none()
                    .tooltip('Open the issue')
                    .on_click(() => ctx.ui.openDetail(space.name, issue.number, issue.repo))
                )
                .child(
                  h_flex()
                    .gap(2)
                    .tooltip(issue.aria)
                    .children(issue.marks.map((/** @type {string} */ mark) => gateMark(ctx, mark)))
                )
                .child(div().flex_grow(1))
                .child(
                  div()
                    .font_bold()
                    .text_size(11)
                    .whitespace_nowrap()
                    .text_color(ctx.c[issue.tone])
                    .child(issue.label)
                )
            )
            .child(
              h_flex()
                .mt(3)
                .items_center()
                .gap(6)
                .children(
                  issue.cats.map((/** @type {any} */ k) => dimmed(cat(ctx, k.file, 16, k.state)))
                )
                .child(laneTag(ctx, issue.lane))
                .child(label(issue.note, ctx.c['muted'], 11).flex_1().min_w(0).truncate())
            )
        )
      )
    box.child(m.dim ? issues.opacity(0.6) : issues)
  }
  return box.child(legend(ctx))
}
