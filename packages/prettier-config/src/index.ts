import type { Config } from 'prettier'

/**
 * The Prettier options every Micelio repository uses (standard, section 4, "Style").
 *
 * @remarks
 * Point `package.json` at it with `"prettier": "@micelio/prettier-config"`. A repository
 * never overrides these options: formatting is not discussed in review.
 */
const config: Config = {
  semi: false,
  singleQuote: true,
  trailingComma: 'es5',
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
}

export default config
