## Benchmarking and Performance Tuning important reminders

- Always run benchmarks before and after your changes to ensure that performance did not regress. Compare before/after numbers from the same machine, power source (plugged in, not on battery), and Node version.
- Never remove or compromise the built-in security protection features of @daloyjs/core, as they are crucial for maintaining the integrity and security of the system.
- Make sure to not affect badly an existing performance improvement. You can find the existing performance improvements in the PERFORMANCE_IMPROVEMENTS_STORY.md within the same folder.

## Root benchmarks

- `pnpm bench` runs seven rotated rounds of the in-process router lookup
  benchmark, verifies every lookup scenario, and reports medians plus ranges.
  Raw samples and machine/git provenance are written to
  `bench/results.router.json`.
- `pnpm bench:serverless` measures the cold-path pieces that matter for
  serverless boot work: module import, `new App()` plus route registration,
  first `fetch()`, and warm `fetch()`. It builds first, measures the shipped
  `dist/` JavaScript, and runs every sample in a fresh process so JIT and
  singleton initialization cannot leak between scenarios. Raw samples and
  provenance are written to `bench/results.serverless.json`.

`bench:serverless` keeps secure defaults active. It uses
`trustProxy: false` only to make the production proxy posture explicit, not to
disable security checks.
