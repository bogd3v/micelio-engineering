// A fixed release plan, so the reusable release workflow can be tried in a dry run on this repository.
// Real repositories compute it from their pull request titles (scripts/release/version.mjs).
console.log(
  JSON.stringify({
    tag: 'v0.0.0-fixture.1',
    version: '0.0.0-fixture.1',
    previous: null,
    bump: null,
    prerelease: true,
    breaking: 0,
  })
)
