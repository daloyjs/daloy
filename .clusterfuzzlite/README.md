# ClusterFuzzLite fuzzing for `@daloyjs/core`

This directory wires [ClusterFuzzLite](https://google.github.io/clusterfuzzlite/)
into the repo so OpenSSF Scorecard's **Fuzzing** check passes and — more
importantly — so the framework's untrusted-input parsers are continuously
fuzzed. Scorecard detects fuzzing by the presence of
`.clusterfuzzlite/Dockerfile`.

## What gets fuzzed

Each `fuzz_*.js` target drives one pure parser that handles attacker-controlled
input and asserts the function's documented contract. A *documented* rejection
(e.g. `BadRequestError` on malformed input) is correct behavior and is swallowed
via [`_guard.js`](./_guard.js); any other throw — or a hang — is a real finding.

| Target | Function (module) | Invariant checked |
|---|---|---|
| `fuzz_safe_json` | `safeJsonParse` (`security.ts`) | only throws `BadRequestError`; never returns an object carrying an own `__proto__` / `constructor` / `prototype` key |
| `fuzz_cookie` | `readRequestCookie` (`cookie.ts`) | never throws (returns `string \| null`) |
| `fuzz_cursor` | `decodeCursor` (`pagination.ts`) | only throws `BadRequestError` |
| `fuzz_cron` | `parseCron` (`scheduler.ts`) | only throws `CronParseError` |
| `fuzz_ip` | `parseIp` (`ip-restriction.ts`) | never throws (returns `ParsedIp \| undefined`) |
| `fuzz_headers` | `sanitizeHeaderName` / `sanitizeHeaderValue` (`security.ts`) | only throws `BadRequestError`; an accepted value never contains CR/LF/NUL |

## Why CommonJS targets for an ESM package

`@daloyjs/core` ships as pure ESM (`"type": "module"`), but the OSS-Fuzz
JavaScript toolchain and `@jazzer.js/core` are consumed via `require()`. The
local [`package.json`](./package.json) sets `"type": "commonjs"` so the
`fuzz_*.js` files here are CommonJS; they load the compiled ESM framework from
`../dist/*.js` via a cached dynamic `import()`.

## Run it locally

This setup has been validated locally with Docker: the image builds, `compile`
bundles all six targets (the ESM-`dist/`-from-CJS-target dynamic import bundles
fine), and every target runs and exits cleanly with no crash.

```sh
# from the repo root — build the image
docker build --platform linux/amd64 -t daloy-cflite -f .clusterfuzzlite/Dockerfile .

# compile the fuzzers into ./build-out
mkdir -p build-out
docker run --rm --platform linux/amd64 \
  -e SANITIZER=coverage -e FUZZING_ENGINE=libfuzzer -e FUZZING_LANGUAGE=javascript \
  -v "$(pwd)/build-out:/out" daloy-cflite compile

# run one target for a bit (libFuzzer args after the target)
docker run --rm --platform linux/amd64 -v "$(pwd)/build-out:/out" -w /out \
  --entrypoint bash daloy-cflite -c './fuzz_safe_json -runs=100000'
```

`--platform linux/amd64` matters on Apple Silicon: the OSS-Fuzz base image is
amd64-only and runs under emulation locally (CI's `ubuntu-latest` is native
amd64). For the full corpus/reproduce loop see the official guide:
<https://google.github.io/clusterfuzzlite/build-integration/> and
<https://google.github.io/clusterfuzzlite/running-clusterfuzzlite/>.

## Jazzer.js version is coupled to the base image's glibc

`build.sh` pins `@jazzer.js/core` to **2.1.0** and installs it in isolation,
then overlays it into the project's `node_modules`. Two constraints drive this:

- **glibc:** the OSS-Fuzz base image is Ubuntu 20.04 (**glibc 2.31**). Jazzer.js
  4.x ships a prebuilt native addon that requires `GLIBC_2.32` and fails to
  `dlopen` here; 2.1.0's addon resolves against 2.31. Bump the pin only when the
  OSS-Fuzz base moves to a newer glibc.
- **isolation:** installing Jazzer.js alongside the framework's full
  devDependency tree leaves `@jazzer.js/fuzzer` without its native addon, so it
  is installed in a clean temp dir and copied in (no-clobber).

JavaScript fuzzers use ClusterFuzzLite's **coverage** sanitizer mode
(`sanitizer: coverage` in the workflows / `SANITIZER=coverage` for `compile`);
passing `address` errors with "JavaScript projects cannot be fuzzed with
sanitizers."

## Maintaining the base-image pin

[`Dockerfile`](./Dockerfile) pins `gcr.io/oss-fuzz-base/base-builder-javascript`
by digest so Scorecard's **Pinned-Dependencies** check stays at 10. Refresh it
periodically (the OSS-Fuzz base images update often):

```sh
curl -sSI "https://gcr.io/v2/oss-fuzz-base/base-builder-javascript/manifests/latest" \
  -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
  | grep -i docker-content-digest
```

Then update the `@sha256:...` in `Dockerfile`.
