## Quality Gates

- After any new feature, bug fix, or refactor, always run `pnpm typecheck` and `pnpm test`
- If a change touches `daloyjs.dev`, also run `cd daloyjs.dev && pnpm typecheck && pnpm build`
- Do not consider the task complete until these checks pass, unless the user explicitly asks not to run them or the environment prevents it
- Every new feature must include automated tests that cover the new behavior, including both happy paths and unhappy paths where practical
- Bug fixes should include a regression test when practical
- Refactors must keep existing tests passing and should add tests if behavior changes or previously untested behavior becomes important
- Every new feature must include documentation updates that explain how to use the feature, including examples when practical
- Documentation updates should be clear, concise, and accurate, and should be reviewed for quality along with the code changes
- Code reviews should be thorough and constructive, providing feedback on both the implementation and the tests, and should ensure that all quality gates are met before approving the changes