// Small parts the views share: the two typefaces, a badge, a lane tag, a gate mark, a cat and a
// section's heading. `ctx` is `{ c, dark, ui }`: `c` the colours to draw with (the names
// of `herdr/mod/design/tokens.json`: the neutral ones are the Herdr app's `theme()`, the rest the design's
// for the app's appearance), `dark` whether the app is dark (the only appearance that glows) and
// `ui` the panel's own state (`toggle(section, cx)`, `openDetail`, …).

import { div, image } from 'gpui-kit'
import { h_flex, v_flex } from 'gpui-base'

/** @typedef {import('../../types/views.js').ViewContext} ViewContext */
/** @typedef {import('../../types/views.js').ClickHandler} ClickHandler */

/** The family of headings, buttons and badges; the files are in `fonts/`. */
const DISPLAY = 'Chakra Petch'
/** The family of everything else. */
export const MONO = 'JetBrains Mono'

/** A heading, button or badge text: Chakra Petch, semibold. */
export const display = (/** @type {import('gpui-kit').NativeElement} */ el) =>
  el.font_family(DISPLAY).font_semibold()
/** A heading text in bold. */
export const displayBold = (/** @type {import('gpui-kit').NativeElement} */ el) =>
  el.font_family(DISPLAY).font_bold()

/**
 * A line of text.
 *
 * @param {string} text
 * @param {string} colour
 * @param {number} [size]
 */
export function label(text, colour, size = 12) {
  return div().text_size(size).text_color(colour).child(text)
}

/**
 * The small square with a space's letter.
 *
 * @param {ViewContext} ctx
 * @param {string} letter
 * @param {string} colour a token name
 * @param {number} [size]
 */
export function badge(ctx, letter, colour, size = 16) {
  const warn = colour === 'warn-fill'
  return display(div())
    .w(size)
    .h(size)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .text_size(11)
    .bg(ctx.c[colour] ?? ctx.c['muted'])
    .text_color(warn ? ctx.c['warn-fg'] : ctx.c['badge-fg'])
    .child(letter)
}

/**
 * The lane tag: FULL filled, NORMAL outlined, EXPRESS dashed.
 *
 * @param {ViewContext} ctx
 * @param {string} lane `FULL`, `NORMAL` or `EXPRESS`
 */
export function laneTag(ctx, lane) {
  const tag = displayBold(div())
    .flex_none()
    .px(4)
    .py(1)
    .text_size(9.5)
    .whitespace_nowrap()
    .child(lane)
  if (lane === 'FULL') {
    return tag.bg(ctx.c['fg']).text_color(ctx.c['bg']).border_1().border_color(ctx.c['fg'])
  }
  if (lane === 'EXPRESS') {
    return tag.text_color(ctx.c['muted']).border_1().border_dashed().border_color(ctx.c['muted'])
  }
  return tag.text_color(ctx.c['fg']).border_1().border_color(ctx.c['fg'])
}

/**
 * One mark of a gate track, 14 by 6 px. Running and needs-you marks glow in the dark theme.
 *
 * @param {ViewContext} ctx
 * @param {string} mark one of `passed`, `running`, `needs`, `held`, `red`, `notReached`, `omitted`
 */
export function gateMark(ctx, mark) {
  const box = div().w(14).h(6).flex_none()
  switch (mark) {
    case 'passed':
      return box.bg(ctx.c['cyan-dim'])
    case 'running':
    case 'needs': {
      const colour = mark === 'running' ? 'cyan' : 'magenta'
      const solid = div().w(14).h(6).flex_none().bg(ctx.c[colour])
      if (!ctx.dark) return solid
      return div()
        .relative()
        .w(14)
        .h(6)
        .flex_none()
        .child(
          image(`mods/factory/glow-${colour === 'cyan' ? 'cyan' : 'magenta'}.svg`)
            .absolute()
            .left(-9)
            .top(-8)
            .w(32)
            .h(22)
        )
        .child(solid.absolute().left(0).top(0))
    }
    case 'held':
      return box.bg(ctx.c['warn-fill']).border_1().border_color(ctx.c['fg'])
    case 'red':
      return box.bg(ctx.c['red-bg']).border_1().border_color(ctx.c['red'])
    case 'omitted':
      return box.border_1().border_dashed().border_color(ctx.c['muted'])
    default:
      return box.bg(ctx.c['track'])
  }
}

/**
 * The cat of `file` at `size` px. A cat that works glows cyan and one that needs the maintainer
 * glows magenta, in the dark theme only.
 *
 * @param {ViewContext} ctx
 * @param {string | null | undefined} file a file of `cats/`
 * @param {number} size
 * @param {string} state `working`, `needs`, `idle`, `held` or `red`
 */
export function cat(ctx, file, size, state) {
  if (!file) return div().w(size).h(size).flex_none()
  const picture = image(`mods/factory/cats/${file}`).w(size).h(size).flex_none()
  const glow = state === 'working' ? 'cyan' : state === 'needs' ? 'magenta' : null
  if (glow === null || !ctx.dark) return picture
  return div()
    .relative()
    .w(size)
    .h(size)
    .flex_none()
    .child(
      image(`mods/factory/glow-${glow}.svg`)
        .absolute()
        .left(-size / 2)
        .top(-size / 2)
        .w(size * 2)
        .h(size * 2)
    )
    .child(picture.absolute().left(0).top(0))
}

/** A text button: filled when it is the card's main action, outlined otherwise, flat when disabled. */
export function button(
  /** @type {ViewContext} */ ctx,
  /** @type {string} */ id,
  /** @type {string} */ text,
  /** @type {{ primary?: boolean, disabled?: boolean, tone?: string, fg?: string, tip?: string, click?: ClickHandler }} */ o = {}
) {
  const tone = o.tone ?? 'cyan'
  const el = displayBold(div())
    .id(id)
    .min_h(36)
    .px(12)
    .flex()
    .items_center()
    .justify_center()
    .text_size(12)
    .whitespace_nowrap()
    .child(text)
  if (o.disabled === true) {
    return el
      .bg(ctx.c['track'])
      .text_color(ctx.c['muted'])
      .border_1()
      .border_color(ctx.c['track'])
      .tooltip(o.tip ?? ctx.ui.lockedNote)
  }
  el.cursor_pointer().on_click(/** @type {ClickHandler} */ (o.click))
  if (o.primary === true) {
    return el
      .bg(ctx.c[/** @type {import('../lib/tokens.js').Token} */ (tone)])
      .text_color(ctx.c[/** @type {import('../lib/tokens.js').Token} */ (o.fg ?? 'badge-fg')])
      .border_1()
      .border_color(ctx.c[/** @type {import('../lib/tokens.js').Token} */ (tone)])
  }
  return el
    .text_color(ctx.c[/** @type {import('../lib/tokens.js').Token} */ (tone)])
    .border_1()
    .border_color(ctx.c[/** @type {import('../lib/tokens.js').Token} */ (tone)])
}

/**
 * The heading of a section: `// NAME [-]`, a button that folds it, and what is on its right.
 *
 * @param {ViewContext} ctx
 * @param {string} name the section's key
 * @param {string} title
 * @param {boolean} open
 * @param {import('gpui-kit').NativeElement} right an element
 * @param {string} [colour] a token name
 */
export function heading(ctx, name, title, open, right, colour = 'cyan') {
  return h_flex()
    .items_center()
    .justify_between()
    .gap(8)
    .child(
      display(div())
        .id(`h-${name}`)
        .cursor_pointer()
        .min_h(24)
        .flex()
        .items_center()
        .text_size(12)
        .text_color(ctx.c[/** @type {import('../lib/tokens.js').Token} */ (colour)])
        .on_click((_e, cx) => ctx.ui.toggle(name, cx))
        .child(`// ${title.toUpperCase()} ${open ? '[-]' : '[+]'}`)
    )
    .child(right)
}

/**
 * The box every section sits in.
 *
 * @param {ViewContext} ctx
 * @param {boolean} [last]
 */
export function section(ctx, last = false) {
  const box = v_flex().w_full().px(16).py(14)
  return last ? box : box.border_b(1).border_color(ctx.c['line'])
}

/**
 * The body of a section whose source is not live: the note in red, then the content at opacity 0.6, as
 * Milestones does for a stale GitHub. A live section (`dim` false) is drawn as it is.
 *
 * @param {ViewContext} ctx
 * @param {import('gpui-kit').NativeElement} box the section, with its heading
 * @param {{ dim?: boolean, note?: string | null }} m the section's model
 * @param {import('gpui-kit').NativeElement[]} content what the section shows below its heading
 */
export function liveOrDim(ctx, box, m, content) {
  if (m.note !== null && m.note !== undefined)
    box.child(label(`! ${m.note}`, ctx.c['red'], 11).mt(8))
  if (m.dim !== true) return box.children(content)
  return box.child(v_flex().opacity(0.6).children(content))
}
