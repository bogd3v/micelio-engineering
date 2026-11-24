// Builds the agent cats of the factory mod from the design's source: one SVG per role, state, crop and
// theme (6 x 5 x 2 x 2 = 120 files) in herdr/mod/factory/cats/, or in the folder after --out. The input
// is herdr/mod/design/cats.json and herdr/mod/design/tokens.json; the output has no date and no random id,
// so the same input gives the same bytes. The glow of "needs you" is not in the files: the panel draws it.
//
//   node herdr/mod/build-cats.mjs [--out <dir>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROLES, STATES, THEMES } from './factory/lib/cat.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DESIGN = join(HERE, 'design')
const CROPS = ['full', 'head']

/** A colour of the source: a token of the theme, or a literal `#rrggbb`. */
function colour(value, theme) {
  if (value.startsWith('#')) return value
  const found = theme[value]
  if (found === undefined) throw new Error(`no token "${value}" in the theme`)
  return found
}

/** The icon of a role's badge, with its placeholders filled. */
function badge(cats, role) {
  const figure = cats.roles[role]
  const reviewer = role === 'reviewer'
  return cats.badge.icons[role]
    .replaceAll('{{c.ink}}', figure.ink)
    .replaceAll('{{halo}}', reviewer ? 'none' : '#ffffff')
    .replaceAll('{{notch}}', reviewer ? '#15161c' : '#ffffff')
}

/** The pause mark of "held", at the crop's origin plus its offset. */
function pause(cats, theme, crop) {
  const p = cats.marks.pause
  const at = `translate(${crop.x + p.offsetFromCropOrigin} ${crop.y + p.offsetFromCropOrigin})`
  return (
    `<g transform="${at}">` +
    `<rect x="0" y="0" width="${p.size}" height="${p.size}" fill="${colour(p.fill, theme)}" stroke="${colour(p.stroke, theme)}" stroke-width="${p.strokeWidth}"/>` +
    `<path d="${p.bars}" fill="none" stroke="${p.barColour}" stroke-width="${p.barWidth}" stroke-linecap="round"/>` +
    `</g>`
  )
}

/** The SVG of one cat. */
function drawCat(cats, tokens, role, state, cropName, themeName) {
  const theme = tokens.themes[themeName]
  const figure = cats.roles[role]
  const spec = cats.states[state]
  const crop = cats.crops[cropName]
  const outline = colour(spec.outline, theme)
  const eyes = cats.eyes[spec.eyes]
  const parts = []
  parts.push(
    `<path d="${figure.paths.silhouette}" fill="${figure.body}" stroke="${outline}" stroke-width="${spec.outlineWidth}" stroke-linejoin="round"/>`,
    `<path d="${figure.paths.collar}" fill="${figure.collar}"/>`,
    `<circle cx="${cats.bell.cx}" cy="${cats.bell.cy}" r="${cats.bell.r}" fill="${colour(cats.bell.fill[state], theme)}"/>`,
    `<path d="${figure.paths.objectFill}" fill="${figure.objectFill}"/>`,
    `<path d="${figure.paths.ink}" fill="${figure.ink}" fill-rule="evenodd"/>`
  )
  parts.push(
    eyes.fill === undefined
      ? `<path d="${eyes.d}" fill="none" stroke="${colour(eyes.stroke, { ink: figure.ink })}" stroke-width="${eyes.width}" stroke-linecap="round"/>`
      : `<path d="${eyes.d}" fill="${figure.ink}"/>`
  )
  for (const mark of spec.marks) {
    if (mark === 'pause') {
      parts.push(pause(cats, theme, crop))
    } else {
      const m = cats.marks[mark]
      parts.push(
        `<path d="${m.d}" fill="none" stroke="${colour(m.stroke, { outline })}" stroke-width="${m.width}" stroke-linecap="round"/>`
      )
    }
  }
  if (cropName === 'head') {
    parts.push(
      `<g transform="translate(598 504) scale(1.15)"><circle cx="0" cy="0" r="100" fill="${figure.body}" stroke="${figure.ink}" stroke-width="12"/>${badge(cats, role)}</g>`
    )
  }
  const scale = (100 / crop.size).toFixed(5)
  const opacity = spec.opacity === undefined ? '' : ` opacity="${spec.opacity}"`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${opacity}>` +
    `<g transform="scale(${scale}) translate(${-crop.x} ${-crop.y})">${parts.join('')}</g>` +
    `</svg>\n`
  )
}

/** Writes the 120 files into `outDir`; returns their names. */
function buildCats(outDir) {
  const cats = JSON.parse(readFileSync(join(DESIGN, 'cats.json'), 'utf8'))
  const tokens = JSON.parse(readFileSync(join(DESIGN, 'tokens.json'), 'utf8'))
  mkdirSync(outDir, { recursive: true })
  const names = []
  for (const role of ROLES) {
    for (const state of STATES) {
      for (const crop of CROPS) {
        for (const theme of THEMES) {
          const name = `${role}-${state}-${crop}-${theme}.svg`
          writeFileSync(join(outDir, name), drawCat(cats, tokens, role, state, crop, theme))
          names.push(name)
        }
      }
    }
  }
  return names
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--out')
  const outDir = at === -1 ? join(HERE, 'factory', 'cats') : resolve(process.argv[at + 1] ?? '')
  process.stdout.write(`${buildCats(outDir).length} cats written to ${outDir}\n`)
}
