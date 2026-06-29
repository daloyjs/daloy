## Benchmarking and Performance Tuning important reminders
- Always run benchmarks before and after your changes to ensure that
- Never remove or compromise the built-in security protection features of @daloyjs/core, as they are crucial for maintaining the integrity and security of the system.
- Make sure to not affect badly an existing performance improvement. You can find the existing performance improvements in the PERFORMANCE_IMPROVEMENTS_STORY.md within the same folder.

## Root benchmarks

- `pnpm bench` runs the tiny in-process router lookup benchmark.
- `pnpm bench:serverless` measures the cold-path pieces that matter for
  serverless boot work: module import, `new App()` plus route registration,
  first `fetch()`, and warm `fetch()`.

`bench:serverless` keeps secure defaults active. It uses
`trustProxy: false` only to make the production proxy posture explicit, not to
disable security checks.
