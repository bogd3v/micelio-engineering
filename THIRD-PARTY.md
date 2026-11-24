# Third-party files

Everything in this repository is MIT-0 (`REUSE.toml`) except the files below, which keep their own licence.

| Files                                                             | What                        | Source                                                     | Copyright                               | Licence |
| ----------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------- | --------------------------------------- | ------- |
| `herdr/mod/factory/fonts/ChakraPetch-{Medium,SemiBold,Bold}.ttf`  | The Chakra Petch typeface   | <https://github.com/google/fonts> (`ofl/chakrapetch`)      | 2018 The Chakra Petch Project Authors   | OFL-1.1 |
| `herdr/mod/factory/fonts/JetBrainsMono-{Regular,Medium,Bold}.ttf` | The JetBrains Mono typeface | <https://github.com/JetBrains/JetBrainsMono> (`fonts/ttf`) | 2020 The JetBrains Mono Project Authors | OFL-1.1 |

The licence text is [`LICENSES/OFL-1.1.txt`](LICENSES/OFL-1.1.txt); each project's own copy, with its copyright line, is beside the fonts as `herdr/mod/factory/fonts/OFL-ChakraPetch.txt` and `herdr/mod/factory/fonts/OFL-JetBrainsMono.txt`. The factory mod ships them in its `fonts/` folder, which the Herdr app loads at start and at the next look change; JetBrains Mono also ships with Herdr.
