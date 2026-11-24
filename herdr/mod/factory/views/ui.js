// Small parts the views share: the two typefaces, a badge, a lane tag, a gate mark, a cat and a
// section's heading. `ctx` is `{ c, dark, ui }`: `c` the colours to draw with (the names
// of `herdr/mod/design/tokens.json`: the neutral ones are the Herdr app's `theme()`, the rest the design's
// for the app's appearance), `dark` whether the app is dark (the only appearance that glows) and
// `ui` the panel's own state (`toggle(section, cx)`, `openDetail`, …).

import { div, image } from 'gpui-kit'
import { h_flex, v_flex } from 'gpui-base'

/** The family of headings, buttons and badges; the files are in `fonts/`. */
export const DISPLAY = 'Chakra Petch'
/** The family of everything else. */
export const MONO = 'JetBrains Mono'

/** A heading, button or badge text: Chakra Petch, semibold. */
export const display = (/** @type {any} */ el) => el.font_family(DISPLAY).font_semibold()
/** A heading text in bold. */
export const displayBold = (/** @type {any} */ el) => el.font_family(DISPLAY).font_bold()

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
 * @param {any} ctx
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
 * @param {any} ctx
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
 * @param {any} ctx
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
 * @param {any} ctx
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

/**
 * The heading of a section: `// NAME [-]`, a button that folds it, and what is on its right.
 *
 * @param {any} ctx
 * @param {string} name the section's key
 * @param {string} title
 * @param {boolean} open
 * @param {any} right an element
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
        .text_color(ctx.c[colour])
        .on_click((/** @type {any} */ _e, /** @type {any} */ cx) => ctx.ui.toggle(name, cx))
        .child(`// ${title.toUpperCase()} ${open ? '[-]' : '[+]'}`)
    )
    .child(right)
}

/**
 * The box every section sits in.
 *
 * @param {any} ctx
 * @param {boolean} [last]
 */
export function section(ctx, last = false) {
  const box = v_flex().w_full().px(16).py(14)
  return last ? box : box.border_b(1).border_color(ctx.c['line'])
}
