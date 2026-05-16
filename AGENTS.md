# The guiding principles for Daloy's design and development are:


1. **Best OpenAPI ergonomics**: FastAPI's single-source-of-truth route definitions that generate OpenAPI docs and a client SDK with no extra code.
2. **Vercel / serverless / edge fit**: Hono's web-standard core and multi-runtime adapters that let you run the same app on any platform.
3. **Mature Node ops & docs**: Fastify's encapsulated plugins, structured logs, and graceful shutdown features that make production apps easier to build and maintain.
4. **Modern TS-first DX, Bun OK**: Elysia's end-to-end typed handlers, typed context, and typed client that give you confidence and great DX without needing to write extra types or use codegen.
5. **Best typed client codegen**: Hey API's `pnpm gen` command that generates a fully typed fetch SDK from your OpenAPI spec with zero config and no extra code.
6. **Supply-chain-hardened installs and publishing**: pnpm's security defaults for installs plus a hardened CI/CD pipeline with blocked scripts, release-age cooldowns, SHA-pinned actions, and provenance publishing that make it harder for attackers to compromise your supply chain and give you confidence in the integrity of your dependencies and the software you publish.



## Quality Gates

- After any new feature, bug fix, or refactor, always run `pnpm typecheck` and `pnpm test`
- If a change touches `website`, also run `cd website && pnpm typecheck && pnpm build`
- Do not consider the task complete until these checks pass, unless the user explicitly asks not to run them or the environment prevents it
- Every new feature must include automated tests that cover the new behavior, including both happy paths and unhappy paths where practical
- Bug fixes should include a regression test when practical
- Refactors must keep existing tests passing and should add tests if behavior changes or previously untested behavior becomes important
- Every new feature must include documentation updates that explain how to use the feature, including examples when practical
- Update also the "Status" table in the README to reflect the new capability
- Documentation updates should be clear, concise, and accurate, and should be reviewed for quality along with the code changes
- Code reviews should be thorough and constructive, providing feedback on both the implementation and the tests, and should ensure that all quality gates are met before approving the changes
- Codecoverage is 100% lines and 100% functions, so any change that adds code must also include tests that cover that code, and the coverage report should be checked to ensure that no new code is left untested
- Any new features should be well documenbted in the `website` documentation, and the documentation should be updated to reflect any changes in behavior or new capabilities introduced by the feature
- Making the repo and the app itself secure are top priorities; any change that has security implications must be carefully reviewed for potential vulnerabilities and should include updates to `SECURITY.md` or related documentation when relevant
