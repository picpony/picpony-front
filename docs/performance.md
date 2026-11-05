# Performance

React Compiler constraints and the repository's measurement tools. Dependency upgrades also follow [Dependencies](dependencies.md).

## Browser support

Chrome 109 is the minimum Chrome target. `package.json` retains Next's other browser targets. Next's Lightning CSS pass handles nesting, static colour fallbacks and prefixes using that Browserslist; Tailwind's separate optimizer is disabled so it cannot lower CSS against a different target first.

`scripts/postcssChrome109.cjs` guards Tailwind's registrations that omit an initial value. Chrome 109 otherwise invalidates empty `var()` fallbacks, breaking rings and filters. On that browser the same properties are reset in Tailwind's lowest layer to preserve their non-inheriting behaviour. Modern browsers keep the registrations.

Runtime alpha colours use the [owned RGB channels](design/colour.md#alpha-and-disabled-content). Dynamic animation and mask values follow [Motion system](motion-system.md#browser-compatibility) and [CSS verification](css-traps.md#inline-masks). View Transitions retain the existing immediate theme-change fallback when the API is absent; scroll-following retains its event-driven fallback.

Use a real browser executable for compatibility checks. Changing only the user agent does not test CSS or API support. After `bun run build`, set `PICPONY_BROWSER` to its absolute executable path and run `bun run test:compat`, `bun run test:browser`, `bun run test:hero` and `bun run test:overlays`. Omit it for the usual Edge test run. All business traffic uses the existing fixtures.

## React Compiler

React Compiler is enabled through Babel. Keep `experimental.turbopackRustReactCompiler` off until a production comparison proves that the Rust transform optimizes this repository.

After a compiler or Next upgrade:

1. Build and inspect client chunks for generated memo-cache call sites. [next.config.ts](../next.config.ts) records the check beside the flag.
2. Check frequently rendered components such as `ImageCard`, `FadeInImage` and `MasonryGrid`, not only the total cache count. The Babel plugin's `logger` reports `CompileError` locations.
3. Compare production bytes and interaction cost with the compiler on and off in the same build configuration.
4. Record script, style and layout costs separately. A faster script sample does not establish a faster whole interaction.

Known boundaries:

- Render-phase writes in resources and shell state must remain guarded by identity comparisons.
- `useGSAP` dependency identities control context disposal. Preserve `'use no memo'`, dependency lists and cleanup in the drawer, grid and sheet until each is verified.
- `RouteCrossFade` is a class component and is not transformed by React Compiler.

## Measurement tools

Most probes drive Edge over CDP. Browser setup and CI entry points are described in the [architecture guide](architecture-guide.md#verification). Read a probe's argument handling before supplying optional flags.

| Command | Measures |
| --- | --- |
| `bun run perf:weight` | Document script URLs, raw bytes and Brotli bytes |
| `bun run perf:metrics` | Cold-load and tab-switch `Performance.getMetrics` deltas |
| `bun run perf:hydration` | Server-rendered content and hydration warnings |
| `bun run perf:motion` | Lazy motion warmup, indicator and route clone |
| `bun run perf:hero` | Hero performance scenarios |
| `bun run perf:hero-pending` | Input and scrolling while a Hero leg is pending |
| `bun run perf:hero-gestures` | Hero gesture scenarios |
| `bun run perf:sw` | Worker control, caches and dead-origin navigation |
| `bun run perf:ripple` | Per-frame ripple opacity; peak is the pressed token |
| `bun run perf:pageturn` | Scroll and visible-card content during page turns |
| `bun run perf:tab-latency` | Release-to-first-frame tab latency and travel |
| `bun run perf:sharpness` | Flight bitmap resolution against painted bounds |
| `bun run perf:sharpness:assert` | Controlled-CDN sharpness assertions |
| `bun run perf:glass` | CPU-rendered inspection of the about-page glass |
| `bun run net:tabnav` | Tab → detail → Back state and offset |

Do not treat every probe as an assertion suite. `perf:pageturn` asserts that visible cards are not blank and painted cold-load cards are not hidden. Sharpness assertions require the controlled CDN mode; ordinary real-network samples only report what they measured.

## Measurement rules

- Record build mode, viewport, DPR, CPU/network conditions, scenario and sample count with a result. Compare like conditions.
- Read focus after the frame has painted: post a task from rAF, for example with `MessageChannel`. A rAF callback may run before focus restoration in that same frame.
- Use presented compositor frames for visible Hero smoothness. Main-thread rAF gaps measure responsiveness but do not prove the compositor stopped.
- Image probes need DPR 2 and decoded bitmaps; a successful fetch alone does not establish usable image pixels.
- Bypass Service Workers before installing CDP network stubs. `perf:sw` is the exception because the worker is its subject.
- `perf:sw` stops the server. Page-scoped network emulation does not make the worker's separate thread offline.

## About-page glass

`FlutedGlass` creates WebGL programs, buffers and textures once per context. Resize updates dimensions and storage; theme changes update colour uniforms.

At the standard tier it wakes on input or visibility, rests eight seconds after the last wake, then stops requesting frames. An empty ink field skips simulation and upload. Reduced motion, off and data saver render a still frame. Context restoration recreates GPU objects.

`perf:glass` renders on the CPU and does not compile GLSL. Shader changes also require browser verification. Its two speed options are `--fluteSpeed` and `--swirlSpeed`; do not merge them into an ambiguous `--speed`.

## Verification

Run `bun run check` and `bun run build` for compiler or performance code changes, then the probes for the affected interaction. Next upgrades also require route/browser and Hero regressions. Avoid broadening a probe run without a specific unresolved question.
