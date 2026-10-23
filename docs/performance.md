# Performance: the React Compiler and measuring

> Split out of `AGENTS.md`; read on demand. Cross-references such as "see Motion" or "under Shape" name sections listed in the index in `AGENTS.md`.

## The React Compiler

On, through **Babel**, with `experimental.turbopackRustReactCompiler` deliberately off.

**The Rust port emits nothing here.** The built client chunks contain **0** memo-cache call sites against **356** with the Babel transform; the only `useMemoCache` references left are React's own runtime definitions. A compiler that silently optimises no files is worse than one that is off, because the flag says otherwise. The count is one grep over `.next/static/chunks/*.js` for the compiler's slot idiom, and it belongs in any Next upgrade; `next.config.ts` spells the command out beside the flag.

**What it buys** (`npm run perf:metrics`, `Performance.getMetrics` deltas, median of 9): a tab switch's `ScriptDuration` 0.076s ? 0.062s, **?18%**; a cold load of `/` 0.211s ? 0.223s, +6%. A later tab-switch measurement (median of 7) recorded `ScriptDuration` 0.038s beside `RecalcStyleDuration` 0.244s across 229 style recalculations; that style figure is total interaction cost, not an isolated compiler delta, and belongs beside the script figure when this trade is reviewed. The trade is taken because a cold load happens once while the interactions happen all session. (A 5-sample run reported the cold regression at +33%; it is noise at that size.)

**What it costs is bytes**, and the current F5 production snapshot puts `/policy` at **309,498 brotli** (`fix/F5-integration/perf_weight.log`). The older 270,655-on / 254,873-off pair is historical and is not a same-build baseline for the integrated F5 tree, so it must not be quoted as the current compiler delta. Keep a same-build on/off weight comparison before assigning that byte cost to the compiler; if a first visit on a slow link becomes the priority, `reactCompiler: false` is still the first flag to reconsider.

It was enabled **last** on purpose, so anything it broke would be attributable to it. The risk surface here is not the usual one:

- **Render-phase writes** exist on purpose and each is guarded by an *identity* comparison — `lib/resource.ts`'s `setRetained` against `snapshot.data`, and `AppLayout`'s drawer and background-location state. A memoised snapshot that changed identity for an unchanged value loops rather than merely re-renders, so this is the first place to look.
- **`useGSAP`'s `dependencies`** is a runtime argument the compiler does not model while still memoising the values fed into it. How often those identities change is how often the GSAP context is disposed, which is the accumulated-`Observer` bug this file already records. `lib/motion/drawer.ts`, `lib/motion/grid.ts` and `components/Sheet.tsx` retain their hand-tuned dependency lists, cleanup and **`'use no memo'`** boundary. Lift them one file at a time with `npm run net:tabs` and `npm run hero:path` as guardrails.
- `RouteCrossFade` is **not** a risk: it is a class component, which the compiler does not touch.

A bailout is information, not noise — it says that file was not optimised. **Check the components that render most, not only the chunk count**: `ImageCard` (a conditional with a fallback inside its consequent, a shape the compiler cannot lower), `FadeInImage` (a suppressed `exhaustive-deps`) and `MasonryGrid` (a ref captured by an object built during render) were all skipped, so every card re-render rebuilt its whole subtree — and a router update reaches every mounted card through `useHeroLink`'s `useRouter()`, which in this Next reads `LayoutRouterContext`: one `?page=` write was a 1.2s task of fifty cards at 4× CPU. Running `babel-plugin-react-compiler` over a file with a `logger` names the line of each `CompileError`.

## Measuring it

The probes below sit beside the checks, all driving Edge over CDP against the same stubbed upstream as `net:audit`. None asserts; they print, and the numbers in this file come from them.

**Read focus after the frame, not at its rAF.** The overlay returns focus in the first rAF after a close, ahead of that frame's style and paint. A sampler whose rAF runs first reads the document for a frame no one sees (NEW-6, N4). Post a task from the rAF (`MessageChannel`) and read focus there: that is what the frame showed.

| | |
| --- | --- |
| `npm run perf:weight [routes…]` | every `<script src>` a document pulls, raw and brotli |
| `npm run perf:metrics [runs]` | `Performance.getMetrics` deltas for a cold load and a tab switch |
| `npm run perf:hydration [routes…]` | content in the first byte, and console warnings |
| `npm run perf:motion` | the lazy chunks warmed; the indicator glides; the cross-fade clone exists |
| `npm run perf:sw` | the worker controls; what is in its caches; a dead-origin navigation |
| `npm run perf:ripple` | a press wave's computed opacity per frame — peak must be the token, 0.1 |
| `npm run net:tabnav [w] [back] [gap]` | tab tap → open a thread → back; where it lands and which pane shows |
| `npm run perf:pageturn` | a gallery page turn per frame: scroll offset, and what each in-view card shows |
| `npm run perf:tab-latency [cpu] [dpr]` | real touch (or, `PROBE_DESKTOP=1` / `1920`, mouse) presses on tabs: from the release to the strip's first frame, and how far it has got 50, 100 and 150ms later |
| `npm run perf:sharpness [w]` | the flight's bitmap vs the box it is painted into, on real images |
| `npm run perf:glass [w] [h]` | the /about plate, rendered to a PNG on the CPU — a design instrument, not a check. Every field of its four config objects is sweepable by name (`--refraction=`, `--momentum=`, `--detail=`, `--flank=`, …), plus `--colorA= --colorB= --sheen= --hue=`; `--stroke` walks a cursor through all four ink directions. One documented exception: two config objects declare `speed`, so the reeds' creep is `--fluteSpeed` and the flow's clock is `--swirlSpeed`. Note it renders on the CPU and so never compiles the GLSL — a shader change needs a browser as well |

`perf:sw` stops the **server** rather than emulating offline, and that is not a shortcut: `Network.emulateNetworkConditions` is scoped to the page target and does not reach the service worker's own thread, so the worker's `fetch()` kept succeeding and the first version of that probe reported the app rendering normally "offline".

**The /about glass rests.** `FlutedGlass` creates its programs, buffers and texture objects once per WebGL context. Resizing updates the canvas, resolution uniforms and the backdrop texture’s storage; theme changes update colour uniforms. In 标准 it wakes on input or visibility, waits eight seconds after the last wake, then eases to rest and stops requesting frames. The ink field skips its step and texture upload once empty. 减弱, 关闭 and data saver draw a still frame. Context loss stops drawing until restoration rebuilds the objects. The material, shader formulas and colour roles are unchanged.
