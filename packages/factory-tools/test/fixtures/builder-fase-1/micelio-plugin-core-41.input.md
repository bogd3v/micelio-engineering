# feat(admin): extension points for sibling plugins (sub-nav, site section, status checks, export sections)

<!-- bogd3v/micelio-plugin-core#41 as read with gh issue view on 2026-10-24: the input of micelio-plugin-core-41.md -->

## Why

ADR-0017 (bogd3v/micelio#665) makes `@micelio/strapi-plugin-core` the host of every other Micelio plugin, starting with `@micelio/strapi-plugin-fediverse` at the `0.7` cut-over. The hooks API (#29) covers what a plugin needs to *react* to content (`afterTransition`, `afterPublish`); nothing yet covers how a plugin *appears* in the Micelio admin or in the site archive. Today the local fediverse plugin of `micelio-cms` has its own menu entry (bogd3v/micelio-cms#300), its own component on `api::site-setting` (bogd3v/micelio-cms#303) and its own idea of the handle host and attribution domains (bogd3v/micelio-cms#298, #349). Without extension points in the core, the published plugin would keep all three, and the Micelio admin would be two admins.

The design that this issue implements is the "Micelio plugin admin" canvas (artboards `Fediverse.dc.html`, `Sites.dc.html` section "Fediverse actor", `Main.dc.html`, `About.dc.html`, `ExportImport.dc.html`, and the note "Extension points a sibling plugin uses").

## What to build

Four extension points, registered by a sibling plugin at `register`/`bootstrap` through the core's service, each with TSDoc and a row in the hooks reference (section 6 of the standard, "Plugin hooks API"):

1. **Sub-nav item.** `registerAdminPage({ id, group: 'site' | 'content' | 'overview', label: { en, es }, to, permission })`. The core renders it in its sub-navigation (`/plugins/micelio/*`) in the given group, hidden when the admin lacks `permission`. The plugin keeps **no** `addMenuLink` of its own.
2. **Per-site settings section.** `registerSiteSection({ id, component: '<plugin>.<name>', label, panel })`: the core attaches the plugin's component to `plugin::micelio.site` (one instance per site) and renders `panel` inside the site view in Sites, under the core fields. The section's data travels with the site in `GET /micelio/sites` only when the caller has the plugin's read permission.
3. **Status checks.** `registerStatusChecks({ id, label, run(site) => Check[] })` with `Check = { id, title: { en, es }, status: 'ok' | 'warn' | 'fail', detail?, fix? }`. The core shows them as a card per plugin in Status (#32) and includes their one-line summary in "Copy diagnostics"; it never runs them on page load, only on "Run again" and on the daily refresh.
4. **Export sections.** `registerExportSection({ id, version, personalData: boolean, write(site) => AsyncIterable<Entry>, read(site, entries) => ImportReport })`. The archive (#37, #40) carries the section under `plugins/<id>/` with its `version` in the manifest; a section with `personalData: true` is **off by default** in the export dialog, needs the plugin's manage permission and is logged. Import of an unknown section is reported and skipped, never an error.

Plus a reference implementation in the clean-Strapi suite: a test plugin that registers one of each, so the points are tested without the fediverse plugin.

## Requirements

- Additive: no change to the content types, hooks, blocks or editorial states of phase 0. `feat` → MINOR of the plugin (`0.2.0`), core line unchanged.
- Everything keyed by site (ADR-0017): a section instance, a check run and an export section name the site.
- Least privilege: an item, a section and a check are visible only with the registering plugin's permission; the core never widens it.
- i18n: labels are `{ en, es }` objects; the core falls back to `en` and reports a missing locale in `npm run check` of the registering plugin (a helper the plugin SDK template reuses).
- No outbound request from any of the four points at admin page load.
- Docs: `docs/plugins/extension-points.md` (how-to for plugin authors), the generated hooks reference, `docs/api.md` for the status and sites responses.

## Acceptance criteria

- [ ] A test plugin registers one sub-nav item and it renders in the Micelio sub-navigation in the browser suite (`npm run test:admin`), hidden for a role without the permission.
- [ ] A test plugin registers a site section; creating a site creates its component instance; `GET /micelio/sites` carries it only with the permission.
- [ ] A test plugin registers two checks; `GET /micelio/status` carries them under `plugins[<id>].checks` and the Status page shows the card; "Copy diagnostics" contains their summary line.
- [ ] A test plugin registers an export section with `personalData: true`; `npm run micelio export` leaves it out by default and includes it with `--include <id>`; import of an archive with an unknown section reports it as skipped.
- [ ] The hooks reference lists the four points with their TSDoc, and `npm run check` fails on drift.
- [ ] `docs/plugins/extension-points.md` exists and the fediverse migration issue (bogd3v/micelio-cms#354) can be written against it with no open question.

Out of scope: the fediverse plugin itself (its migration is the micelio-cms issue), a marketplace or discovery of plugins, UI injection outside the four points.

## Progress

Not started.

---
_Generated by [Claude Code](https://claude.ai/code)_
