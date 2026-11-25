// Customize: where the mod shows, the panel's sections (order and visibility), the alerts and the keys
// (`herdr/mod/design/screens/Customize.png`). An overlay of this mod, opened with `customize` in its props.
// The Theme group of the design is not built: the mod follows the Herdr app's theme. It only draws:
// `ctx.ui.customize` gives `model` (see `main.js`), `panel(on)`, `board(on)`, `move(name, by, cx)`,
// `toggleSection(name, cx)`, `toggleAlert(name, cx)`, `restore(cx)` and `close()`, and the calls that
// follow a click are made there.

import { div } from 'gpui-kit'
import { h_flex, v_flex } from 'gpui-base'
import { displayBold, label } from './ui.js'

/** A heading of a group: `// WHERE IT SHOWS`. */
const group = (/** @type {any} */ ctx, /** @type {string} */ text) =>
  displayBold(div()).text_size(12).text_color(ctx.c['cyan']).child(`// ${text.toUpperCase()}`)

/**
 * A switch: a 44 by 24 track and a 16 px knob, cyan when on.
 *
 * @param {any} ctx
 * @param {string} id
 * @param {boolean} on
 * @param {any} click
 */
function toggle(ctx, id, on, click) {
  return div()
    .id(id)
    .relative()
    .w(44)
    .h(24)
    .flex_none()
    .cursor_pointer()
    .border_1()
    .border_color(ctx.c[on ? 'cyan' : 'line'])
    .bg(ctx.c[on ? 'cyan-dim' : 'track'])
    .on_click(click)
    .child(
      div()
        .absolute()
        .top(3)
        .left(on ? 23 : 3)
        .w(16)
        .h(16)
        .bg(ctx.c[on ? 'cyan' : 'muted'])
    )
}

/** A title with the line under it. */
function titled(
  /** @type {any} */ ctx,
  /** @type {string} */ title,
  /** @type {string} */ desc,
  /** @type {boolean} */ on = true
) {
  const name = div()
    .font_bold()
    .text_color(ctx.c[on ? 'fg' : 'muted'])
    .child(title)
  return v_flex()
    .flex_1()
    .min_w(0)
    .child(on ? name : name.line_through())
    .child(label(desc, ctx.c['muted'], 11.5).mt(2))
}

/** A row of a group's box: the text and what sits at its right. */
const row = (/** @type {any} */ ctx, /** @type {any} */ left, /** @type {any} */ right) =>
  h_flex()
    .items_center()
    .gap(12)
    .px(12)
    .py(10)
    .border_b(1)
    .border_color(ctx.c['line'])
    .child(left)
    .child(right)

const box = (/** @type {any} */ ctx) =>
  v_flex().border_1().border_color(ctx.c['line']).bg(ctx.c['surface'])

/** A button of the two of "Panel side": filled cyan when it is the side the install wrote. */
function side(/** @type {any} */ ctx, /** @type {string} */ name, /** @type {boolean} */ on) {
  const el = displayBold(div())
    .id(`side-${name}`)
    .min_h(36)
    .px(12)
    .flex()
    .items_center()
    .text_size(12)
    .child(name.toUpperCase())
  return on
    ? el.bg(ctx.c['cyan']).text_color(ctx.c['badge-fg']).border_1().border_color(ctx.c['cyan'])
    : el.text_color(ctx.c['fg']).border_1().border_color(ctx.c['line'])
}

/** One of the two arrows that move a section; the first has no up and the last no down. */
function arrow(
  /** @type {any} */ ctx,
  /** @type {string} */ id,
  /** @type {string} */ glyph,
  /** @type {boolean} */ off,
  /** @type {any} */ click
) {
  const el = displayBold(div())
    .id(id)
    .w(24)
    .h(20)
    .flex()
    .items_center()
    .justify_center()
    .text_size(11)
    .border_1()
    .border_color(ctx.c['line'])
    .child(glyph)
  return off
    ? el.text_color(ctx.c['line'])
    : el.text_color(ctx.c['fg']).cursor_pointer().on_click(click)
}

/**
 * @param {any} ctx
 * @param {{
 *   shown: string,
 *   side: string,
 *   panel: boolean,
 *   board: boolean,
 *   sections: { name: string, title: string, desc: string, on: boolean, first: boolean, last: boolean }[],
 *   alerts: { name: string, title: string, desc: string, on: boolean }[],
 *   keys: { id: string, shown: string, label: string }[],
 *   note: string | null,
 * }} model
 */
export function customize(ctx, model) {
  const c = ctx.ui.customize
  const places = box(ctx)
    .child(
      row(
        ctx,
        titled(ctx, 'Side panel', 'Docked beside your panes'),
        toggle(ctx, 'place-panel', model.panel, (/** @type {any} */ _e, /** @type {any} */ cx) =>
          c.panel(!model.panel, cx)
        )
      )
    )
    .child(
      row(
        ctx,
        titled(ctx, 'Board tab', 'Every milestone by gate, in its own tab'),
        toggle(ctx, 'place-board', model.board, (/** @type {any} */ _e, /** @type {any} */ cx) =>
          c.board(!model.board, cx)
        )
      )
    )
    .child(
      h_flex()
        .items_center()
        .gap(8)
        .px(12)
        .py(10)
        .child(label('Panel side', ctx.c['muted'], 12).flex_1())
        .child(side(ctx, 'left', model.side === 'left'))
        .child(side(ctx, 'right', model.side === 'right'))
    )
    .child(
      label('Set with `herdr/mod/install.sh --side left` (README, Install)', ctx.c['muted'], 11)
        .px(12)
        .pb(10)
    )
  const sections = box(ctx).children(
    model.sections.map((s) =>
      h_flex()
        .items_center()
        .gap(10)
        .px(12)
        .py(8)
        .border_b(1)
        .border_color(ctx.c['line'])
        .child(
          v_flex()
            .flex_none()
            .gap(2)
            .child(
              arrow(
                ctx,
                `up-${s.name}`,
                '^',
                s.first,
                (/** @type {any} */ _e, /** @type {any} */ cx) => c.move(s.name, -1, cx)
              )
            )
            .child(
              arrow(
                ctx,
                `down-${s.name}`,
                'v',
                s.last,
                (/** @type {any} */ _e, /** @type {any} */ cx) => c.move(s.name, 1, cx)
              )
            )
        )
        .child(titled(ctx, s.title, s.desc, s.on))
        .child(
          toggle(ctx, `section-${s.name}`, s.on, (/** @type {any} */ _e, /** @type {any} */ cx) =>
            c.toggleSection(s.name, cx)
          )
        )
    )
  )
  const alerts = box(ctx).children(
    model.alerts.map((a) =>
      row(
        ctx,
        titled(ctx, a.title, a.desc),
        toggle(ctx, `alert-${a.name}`, a.on, (/** @type {any} */ _e, /** @type {any} */ cx) =>
          c.toggleAlert(a.name, cx)
        )
      )
    )
  )
  const keys = div()
    .flex()
    .flex_wrap()
    .gap(6)
    .text_size(12)
    .children(
      model.keys.map((k) =>
        h_flex()
          .w(176)
          .gap(6)
          .p(8)
          .bg(ctx.c['surface'])
          .border_1()
          .border_color(ctx.c['line'])
          .child(div().font_bold().child(k.shown.toUpperCase()))
          .child(label(k.label, ctx.c['muted'], 12))
      )
    )
  return v_flex()
    .w_full()
    .p(20)
    .gap(20)
    .child(
      h_flex()
        .items_center()
        .gap(10)
        .child(displayBold(div()).flex_1().text_size(18).text_color(ctx.c['fg']).child('CUSTOMIZE'))
        .child(
          displayBold(div())
            .id('customize-done')
            .min_h(36)
            .px(14)
            .flex()
            .items_center()
            .bg(ctx.c['cyan'])
            .text_color(ctx.c['badge-fg'])
            .cursor_pointer()
            .on_click(() => ctx.ui.close())
            .child('DONE')
        )
    )
    .child(v_flex().gap(8).child(group(ctx, 'Where it shows')).child(places))
    .child(
      v_flex()
        .gap(8)
        .child(
          h_flex()
            .items_baseline()
            .justify_between()
            .child(group(ctx, 'Panel sections'))
            .child(label(`${model.shown} shown`, ctx.c['muted'], 11))
        )
        .child(sections)
        .child(
          label(
            'Needs you cannot be hidden while something waits for you; it collapses to a count. A hidden section that turns red still turns the header of the panel red.',
            ctx.c['muted'],
            11.5
          )
        )
    )
    .child(v_flex().gap(8).child(group(ctx, 'Alerts')).child(alerts))
    .child(
      v_flex()
        .gap(6)
        .child(group(ctx, 'Keys'))
        .child(keys)
        .child(
          label(
            'Active while the panel has focus. S, P and R are keys of the panel only and cannot be rebound.',
            ctx.c['muted'],
            11
          )
        )
        .child(
          label(
            'Rebind N, L or B with a `mod:factory` section in your keys.json (README, Keys).',
            ctx.c['muted'],
            11
          )
        )
    )
    .child(
      h_flex()
        .items_center()
        .justify_between()
        .child(
          displayBold(div())
            .id('customize-restore')
            .min_h(36)
            .px(12)
            .flex()
            .items_center()
            .text_size(12)
            .text_color(ctx.c['fg'])
            .border_1()
            .border_color(ctx.c['line'])
            .cursor_pointer()
            .on_click((/** @type {any} */ _e, /** @type {any} */ cx) => c.restore(cx))
            .child('RESTORE DEFAULTS')
        )
        .child(label(model.note ?? '> saved in mod storage', ctx.c['muted'], 11))
    )
}
