# Hero (image detail) engine

> Split out of `AGENTS.md`; read on demand. Cross-references such as "see Motion" or "under Shape" name sections listed in the index in `AGENTS.md`.

The current contracts of `lib/hero/`, condensed from the 2026-10 investigation rounds. Read with
`docs/transitions.md` (the hero sections there) before touching the engine.

## Opening: the press builds it, the click plays it

- `useHero` → `armImageHeroOpen` on a card's `pointerdown` (not during a fling: `isScrollMoving`).
  `HeroController.armOpen` mounts the Stage under the session id the open will use
  (`stage.phase === 'armed'`), hidden with an empty `clip-path` — never `visibility`,
  `pointer-events` or `inert`: those inherit, and lifting them restyles the whole Stage inside the
  click.
- Right after the press, `prepareArmedFlight` builds the plane, the flyer and every track inside
  `holdHeroMotion` (created, parsed, paused at frame 0). The click adopts the armed id
  (`adoptArmed`), checks the card rect and viewport (`takePreparedFlight` — the landing box is *not*
  re-read: the held container tracks already scale it), applies the card leases and calls
  `HeroMotion.release()`. Anything else (pointercancel, another card, `HERO_ARM_TTL_MS`) disposes it.
- Nothing is fetched or decoded at the press; the flight-upgrade watch starts at launch.
- **Touch must build in a microtask.** While a finger is down and Blink does not yet know whether it
  is a scroll, it holds back timers, `scheduler.postTask` (even `user-blocking`) and frames. A mouse
  press builds in a `setTimeout(0)`.
- **Scalar tracks are two keyframes + `linear()`** (`ScalarTrack`): the plane's and the content's
  fades, the pull's, the chrome's. Same frames, far cheaper per `animate()`, and `linear()` timing
  runs on the compositor. The flyer and container tracks stay per-sample: they are arcs, not
  scalars.
- **Shared tracks are not deferred past the first frame**: the forward spring covers ~5% of its
  travel in one frame and ~17% in two, so a late window visibly lags the flyer.
- **Pull layers are promoted on the candidate pointerdown** (`data-image-hero-pull-ready`,
  `HeroPullController.prime`), so the first dragged frame moves layers instead of creating them.
- The drawer gesture's cleanup (`useDrawerSwipe`) hands styles back only when a gesture actually
  touched the panel (gated on `touched`), so opening does not restyle the page.

## Closing and the pull

- **A close never waits for a restyle.** The flight launches synchronously in the task that asked
  for the close (rect reads before the shell's microtask commit); a transparent shield
  (`routes.freeze({deferInert})`) holds the pointer; `HeroController.exposeGallery` — once the
  flyer's animation is ready, plus one frame — releases the gallery's `aria-hidden` and keyboard
  exclusion (`runtime.galleryExposed`, read by `AppLayout`'s `closeHoldsGallery`), and applies
  `aria-hidden` plus the leaving pointer marker to the detail. The open's freeze still uses
  `inert`; the close avoids its subtree restyle.
- **The gallery's content-visibility cover lasts through the return.** Only `coverGallery` and
  `uncoverGallery` own `data-gallery-covered`, never a React prop tied to input availability.
  Once `gallery-idle`, `uncoverGallery` restores four slots per idle slice, then removes the
  marker. Removing it when the pointer returns releases every off-screen slot inside the flight.
- **The rubber band stays** (owner decision): y = raw / (1 + raw / `DRAG_RESISTANCE_PX`), 360; x
  follows at the same ratio once the vertical drag is claimed. The axis-lock slop (6px) is
  subtracted at the slop boundary, Flutter-style, so the claim is not a jump. The 上一张/下一张
  swipe uses the same slop rule.
- **Release velocity is `HeroVelocityTracker`** (`lib/hero/velocity.ts`): 100ms horizon, 40ms stop
  rule (also against the pointerup's time), least-squares quadratic. A pointerup at the last move's
  position feeds only the stop rule. A release moving back (≥0.25px/ms against the drag) cancels
  both the dismiss and the step, however far it got.
- **The dismiss leaves at the finger's speed** when the release heads towards the card
  (`releaseSpeedAlong` → `createHeroLeg({speed})`). Away from the card (pulling down, card above) it
  launches from rest.
- **The sink has no velocity step** (`easeSinkWindow`): forward eases out to rest at p 0.6, back is a
  smoothstep from rest at p 0.4. Depth 0.95.

- **A tap the close's shield caught is replayed** (`watchShieldTap` in `routes.ts`,
  `HeroController.replayShieldTap`): a press that began on the shield is followed to its release on
  the window and delivered to the card under it once the gallery takes input again. Before, a
  re-tap within the shield's frame or two did nothing (~1 in 4 in a burst of open/close).
- **Nothing inside the window travels, either way.** The staircase (a 12–40px rise per block,
  staggered in reading order) and its mirror on a return (`sinkTrack`) are gone: the plane's
  morph *is* the reveal, so header, chrome and body are shown exactly as the window's edge
  uncovers them — the theme switch's circular reveal in a rounded rectangle. The content still
  *dissolves* (a plain opacity cross-fade, no travel): forward on `HERO_CONTENT_FADE.forward`,
  home on `HERO_RETURN_FADE`, which is narrower (0 → 0.3) on purpose — see the transparent-picture
  rule below. The floating back is outside the window and dissolves in place, since the mask
  cannot reach it.
- **A picture with transparency carries its surface home** (`createHeroFlight`). Its alpha
  composites over whatever is behind it; on the detail that is `surface`, and in flight behind
  it are the list's cards, tabs and chips. Through the hole of a ring that read as the page
  showing through the picture (reported from the app). A return leg therefore paints the flyer's
  clip with `--md-sys-color-surface`, and the plane and copy fade on `HERO_RETURN_FADE` (0 → 0.3)
  so the sheet behind the picture is gone before the picture is over the list. A forward leg
  keeps neither: the window's plane is already behind it, and at take-off that plane is the card.

## Data on open

- **A complete list row is the record's first paint** (`completeDetailRow`, `primeImageDetailFromRow`):
  installed provisional at the press, so the Stage and the route render header, votes, tags and
  description from the first frame; the open's own read revalidates it in place.
- **Stale-while-revalidate** in `lib/detail.ts`: an expired record (TTL 2 min) is still shown for
  `STALE_TTL` (30 min) while it is re-read; the screen never drops back to skeletons on a reopen.
- The comment thread is prefetched once the body publishes (`prefetchImageComments`) and shown at
  once when cached.
- What reaches the *settled* detail later arrives with an M3 entrance (`playDetailArrival`), never
  mid-flight.

## Settled states and recovery

- **`detail-idle` enforces a visible detail.** With no session running, `setPhase('detail-idle')`
  reveals the live route of `runtime.imageId` (owner checks bypassed, freeze lease released) and
  seals the rest (`settleDetailSurface`). This is what prevents "stuck on the list, address bar on
  `/pic/:id`" when a re-tap turns a close around and history walks forward into a newly mounted
  overlay registration.
- `recovering` with no session is not terminal: `scheduleIdleRecovery` restores the guard (or
  collapses from the provisional rung) once history is quiet, then drains a queued tap.
- **Scroll during the open:** the handoff holds the Stage while a scroll stream latched to it is
  still running (≤600ms, 120ms quiet).
- **Handoff:** the detail body is pre-rendered hidden (`<Activity mode="hidden">`) once the flight's
  record exists, so the post-landing publish is a visibility switch; the `PicDetail` chunk is warmed
  once on gallery idle.
- Known residual: open A → Back → open A → open B can leave A's detail entry under B, so one Back
  from B lands on A's detail (consistent and interactive, one extra Back).

## Sharpness

- The press-time capture sizes its canvas from the **decoded** pixels (`getMediaPixelSize`,
  `lib/hero/dom.ts`), never `naturalWidth`: for a `next/image` with a `w`-descriptor `srcset`,
  `naturalWidth` is density-corrected, so a 2× screen captured below the card's on-screen
  resolution. Production-only (dev serves bare `src`).
- **No pre-take-off warm** of the detail final (owner decision; see "Nothing sharper is required
  before take-off" in `docs/scrolling.md`). The flyer sharpens in the air from the routed final
  (`upgrade.ts`). The detail final is Derpibooru's own rendition, not re-encoded by `/_next/image`
  (`lib/detailFinalSource.ts`).

## Measuring

- `HERO_SCRIPT=scripts/probeHeroCost.py node scripts/reviewBrowser.mjs --mobile [--close|--pull]`
  (390px, 4× CPU): every main-thread task over 40ms with its children, plus User Timing marks.
- `scripts/acceptHeroMatrix.py` (via `HERO_SCRIPT`) is the acceptance harness: latency from the
  input's own `timeStamp` to the renderer's draw of the commit carrying the response
  (`heroProbeMark`, gated on `__HERO_PROBE__`); dropped frames during compositor animation; longest
  main-thread task; per-move p95; scroll-update latency from `InputLatency::GestureScrollUpdate`
  (`RENDERER_SWAP`). `--off=arm` turns the press build off for A/B.
- Two traps: `PipelineReporter`'s `scroll_state` says MAIN_THREAD on any page with a stylesheet (use
  the latency components' `RENDERING_SCHEDULED_MAIN`), and "presented" includes headless software-GL
  display — budget on the renderer's draw.
- `node scripts/reviewBrowser.mjs --hero-stress` (random open/Back/Esc/re-tap bursts, asserts a
  consistent settled screen); `--hero-open-probe [--cpu=4] [--no-scroll]` (phase timeline, body
  visibility). `HERO_BROWSER_CHANNEL=chromium` runs `test:hero` on bundled Chromium;
  `PYTHON=python3` overrides the interpreter. `test:hero` covers `pull-follow`, `pull-retreat`,
  `pull-frame`, `pull-loading`.

### 打开时不要在 `<main>` 上改继承属性

`scrollbar-color` 会继承。详情覆盖画廊时 `.app-scroller[data-scroll-hidden]` 会把它改成透明，结果整棵画廊子树（约 1,250 个元素）都要重算样式，在 4× CPU 下飞行中途卡约 190ms，返回时还会再来一次。现在由滚动容器唯一的子元素用 `:where(.app-scroller) > *` 固定住继承值，Blink 比较子元素样式发现没变就不再往下走。同一构建开关这条规则对比（390×844、4× CPU，每组 4 次全新加载）：首次打开呈现帧间隔超出部分 275ms → 21ms，最长间隔 196ms → 46ms。以后凡是跟随 hero 状态在 `<main>` 或 `<html>` 上切换的样式，都先确认改的不是继承属性。

### 首次打开不要在飞行中拉代码和字体

`PicDetail` 的 `import()` 预热并不覆盖首开要用的全部东西。生产构建抓网络发现，第一次点开时飞行途中还会下载、解析并执行：详情路由自己的 chunk 组（路由器加载的是页面的 client reference，Turbopack 把它和 `import()` 拆成了不同文件，约 110KB）、描述用的 Markdown 渲染器（`MarkdownDocument`，约 155KB，lazy），以及包含投票标签字形（`DetailVotes` 的读屏文字“踩”）的 Noto Sans SC 子集——它是 `font-display: swap`，到达后头部会再排一次版。

`lib/useHero.ts` 的 `scheduleDetailCodeWarm` 现在在画廊空闲后按顺序、每步一个 idle slice 预热：`PicDetail` 模块 → 第一张卡片的完整路由载荷（`prefetchRoutePayload`，服务端只渲染客户端页面，不读后端、不计浏览，同时让这张卡的打开直接走缓存）→ `PicDetail` 导出的 `warmDetailDeferredCode`（库不直接 import 组件）→ `document.fonts.load` 加载详情字形。之后首次点击不再有任何 script/字体请求。同条件（390×844、4× CPU，每组 8–10 次全新加载）：首开帧间隔超出部分 123ms → 73ms，最长间隔 95ms → 77ms，promote 618ms → 535ms；第二次打开不变（8–13ms）。

剩下的首开成本是详情路由第一次挂载的 React 渲染与随后一次样式/布局（JIT 尚冷），第二次打开同样的工作明显更快。要彻底去掉只能在后台离屏预渲染整个详情，会牵涉路由注册、数据读取和焦点，暂不这样做。

### 2026-11 第三轮：抬手即开、去掉构建里的强制布局、弧线求解只采样一次

**触摸点按在抬手（`pointerup`）时打开，不再等 `click`。** 生产构建 4× CPU 下追踪：手指抬起后 Blink 先出一帧，再跑兼容鼠标事件（`mouseover`/`mousedown`/`mouseup`）、移焦点、重算 `:hover`/`:active`/`:focus` 样式、再做一次命中测试，之后才派发 `click`——`touchend` → `click` 实测 29–122ms（中位约 65ms），这段时间画面完全不动。Flutter 的 `onTap` 就是手势竞技场裁决后的那次抬起。现在 `useHeroLink` 在按下时记下点（只在本次按下确实 arm 了 Stage 时——也就排除了按停惯性滚动的那一下，那种按下浏览器本来也不会派发 click），抬手时若仍在 Chrome 的点按容差内（15px）且按住不足 450ms（再长就是长按，抬手只会有 `contextmenu`），就直接调用与 click 相同的打开路径；随后那次 `click` 被吞掉（落在链接上由 `handleClick` 吞，落在已展开的 Stage 上则 `forwardOpeningCardClick` 本来就忽略对正在打开的那张卡的点击）。鼠标不变：`click` 与 `mouseup` 同一任务，没有可省的时间；键盘激活（`detail === 0`）永远不被吞。调用方在激活时要做的事（卡片 `openFromSequence`、横幅 `clearImageSequence`）通过 `onActivate` 传入，两条路径都会执行。

**打开过程中点另一张卡片不再切换。** 打开阶段（`opening.flight` / `landed` / `handoff`）收到别的图片的打开请求时，`requestOpen` 直接吞掉，当前这张照常打开完；中途换图（原 `retargetOpening`）已删除——真实使用里没有这个手势，它只会来自误触的第二下。Stage 的 `forwardOpeningCardClick` 只在 `armed` 时转发，路由接管后的 `guardAdoptedClicks` 只拦截不转发。关闭/回退中再点卡片（`retargetReversing`）保留。飞行中按下的那一下，其 `click` 在交接后仍会被吞掉（`HERO_PRESS_TAIL_MS`），不会落到刚到位的大图上打开灯箱。

**构建航班时不再插入布局读取。** `createHeroFlight` 会插入并设置飞行层的样式，之后 `HeroMotion` 构造里第一次 `screenRectToPlane` 读 `scrollTop`、`buildBackgroundAnimation` 读画廊滚动容器的 `scrollTop`/`clientHeight`，各触发一次完整的样式 + 布局（4× CPU 下约 5ms 和 16ms，打开与关闭都有）。现在调用方在写 DOM 之前、同一任务里读好这些值，通过 `HeroMotionOptions.preread` 传入，只供构造函数这一次使用；之后的重建、反转都照旧读实时值。

**弧线求解器只采样一次。** `heroPointArcAt` 是弦上点与圆弧点按 bow 的凸组合，只有组合系数依赖 bow。`solveHeroArcContainBows`（扫描 + 细分，上百次试探）和 `solveHeroArcBow`（二分）原来每次试探都重建弧线、重算三角函数并分配对象，按下时的构建里占 10–40ms（1×）。现在每对矩形采样一次（`sampleHeroRectArc`），每个 bow 只做加权；所有表达式与原实现逐项相同、求值顺序相同，随机 3000 组输入新旧结果逐位一致，`npm run hero:path` 全部通过。

### 2026-11 第四轮：把强制布局移出飞行帧；被取代的图片立刻淡出

**背景 sink 在飞行期间被提升。** sink 的缩放作用在整页列表上，不提升时浏览器每一帧都要为它重新分层：R5 240 @66Hz、1111×556 的一次打开约 79 次 Layerize。飞行期间（`html[data-image-hero-transition]`）给 `[data-image-detail-background-visual]` 加 `will-change: transform`，同一次构建里用运行时把它覆盖回 `auto` 的 A/B：60.6ms → 53.2ms 的 Layerize。提示只在飞行期间存在——常驻会让空闲的图库也保留一层列表大小的图层。

**详情描述卡的测量移到提交之后。** `DetailDescription` 原来在 `useLayoutEffect` 里读 `scrollHeight` 并写两个 state：详情路由挂载的那一帧里，这次读把刚提交的页面再排一遍，两次状态写又让这张卡在绘制前重渲染（追踪：3.5ms 样式 + 4.5ms 布局，都在飞行的帧里）。现在 rAF 之后再走 idle 测一次，ResizeObserver 的回调同样延后；折叠高度本来就是 160px，屏幕上没有东西依赖它跑在提交里。

**下拉识别器不再在绑定的下一帧读 `scrollTop`。** 绑定发生在揭示路由的那个写入里（adoption、landing），下一帧的读会强制新详情的样式重算（追踪：6.0 和 8.0ms 两次）。adoption 时调用方已经知道停靠的偏移（`promoteAdoption` 刚写进去），通过 `initialScrollTop` 传入；没有值的绑定（打开起点的 Stage）延到第二帧——那一帧浏览器已经排好版，读是免费的。

**viewport 重瞄的量测在 ResizeObserver 回调里做。** RO 在布局之后投递，此时 `getBoundingClientRect`/`getComputedStyle` 免费；放到下一帧的 read 阶段，读的是刚提交的新详情（追踪：333 个元素，9.1ms 样式 + 2.5ms 布局在 flush 里），随后 rebuild 的写入又把这些样式弄脏一次。窗口 resize 走的那条（`subscribeHeroViewportInvalidation`）照旧在调度器的读阶段。

**详情正文不再在飞行中挂载，并且分两帧发布。** `isDetailBodyPublishable` 原来在“路由跟随 Stage”时允许正文在飞行中挂载，理由是没有帧依赖主线程；漏掉的是挂载本身的成本——正文第一次样式 + 布局是同一帧里的约 9ms + 13ms（1111×556 追踪，1920×1080 上按比例更多），正好落在飞行正在配速的帧里，两台机器上“打开时那一帧”都是它。正文在整个飞行中都位于首屏下方（图片占满视口），提前挂载什么也看不到。现在它等 `detail-idle` 之后发布（`publishWhenHeroSettled`），由 `playDetailArrival` 按 M3 入场；`PicDetail` 再把首屏以下的尾部（描述、来源、评论）晚一帧发布，没有一帧要吞下全部。实测打开行（本机 66Hz、1111×556 与 1912×948 各三次运行）：冷开的头两次各丢 1–2 帧，其余多为 0；同一份报告里 8 项结论全部流畅（fixture 图片，避开真实后端 429/504 的干扰）。

**窗口是唯一的揭示，里面的元素一动也不动。** 现在是主题切换那种揭示：**目的地整页从第一帧就按最终尺寸和位置排好**，从卡片长出来的圆角窗口只是遮罩，走到哪里露出哪里；图片本身仍然飞（共享元素），其余元素没有位置轨道、没有楼梯。

- 补偿器（`.image-detail-unclip` 上的 transform）从「cover 拟合」改成**窗口变换的精确逆**：`scale(1/sx, 1/sy) translate(-x, -y)`，与窗口的 `translate3d(x,y,0) scale(sx,sy)` 复合为恒等。之前内容乘上 `max(sx,sy)` 的拟合比例，随窗口一起滑动、放大——header 会在窗口里滑上去，这就是要改掉的那件事。
- 飞行层的 counter 随之**整个删掉**：页面不动了，图片的坐标本来就在屏幕空间，不再需要按滚动条 gutter 调 `transform-origin`（`formatHeroContainerCounter` / `formatHeroContainerCounterOrigin` 一并移除）。
- 中点读取的落地目标框已经是它最终的位置（页面不动），`unprojectHeroContainerRect` 和 `HeroMotion.unprojectRect` 随之删除：视口重瞄直接用读到的框。
- **带透明的图片在返回时自带它的表面**（`createHeroFlight`）：返回 leg 给飞行体的 clip 铺 `--md-sys-color-surface`，并在同一任务里让页面与表面按 `HERO_RETURN_FADE`（0 → 0.3）隐去。以前透明区域后面是列表本身——环形图中间会看到 "本站讨论"、标签和卡片从表面下滑过（用户报的 bug）。现在它在飞行中看起来和停在详情里一样：图片在一张 surface 卡上。
- 楼梯（`revealTrack`）与返回时的下沉（`sinkTrack`）删除；浮动返回按钮在窗口之外，只淡入淡出。
- `npm run hero:path` 的容器断言随之改写：(e/still) **每一采样内容复合变换必须是恒等**（`1±1e-9`、位移 0），(e/gutter) 飞行层的落点不再受 gutter 影响，(e/landing) 落地字符串为 `scale(1, 1) translate(0px, 0px)`，(e/drift) 关键帧之间 WAAPI 线性插值造成的偏差——倒数的线性插值不是线性插值的倒数——实测 0.507% 帧宽（容差 0.6%）。401 个审计点全部通过。
- 观感实测（fixture 图、1111×556，seek 到 60/120/180ms）：60ms 时窗口是卡片大小的圆角框，框里是最终页面的那一块（投票条、图片区），120ms 露出 header 的固定位置，180ms 基本到位——内容没有任何滑动。帧预算与前面几项同一量级（这是结构与观感，不是丢帧来源）。

**被取代的图片立刻淡出，而不是在屏幕上等到自己落地。** 两条路径都改：一次关闭被新的打开取代时（`ensureRetirement`），原来等 `motion.landed` 再淡出，上一张图以不透明度 1 停留 150–270ms；一次反向中的打开被另一张卡取代时（`takePredecessorSurface`），原来**根本不淡出**，那张图以 `--z-hero-retiring`（43）压在详情层（40）之上走完整个飞行。现在前者一被取代就按 fastEffects（约 140ms）淡出，后者用 `fadeOutRetiring()`：只淡图层、不交出生命周期（卡片的租约仍然在它落地时释放）。实测快速序列（打开 A → 90ms 后 Esc → 30ms 后打开 B）：上一张的不透明度 243ms 时 1.0 → 290ms 0.44 → 337ms 0.02。

**还没解决、需要真机确认的：** 按下时 Stage 首次挂载后的那次布局（一次 15–65ms，4×）和 `drawImage` 截帧（软件画布下明显偏高，真机 GPU 画布应便宜得多）仍在按下的任务里；窗口圆角与飞行体的裁剪圆角是主线程动画（`borderRadius`），主线程被路由提交或关闭时解除 `inert` 的重算（约 600 个元素，4× 下 ~70ms）占住时，圆角会滞后几帧，变换本身仍在合成线程上平滑运行。

## On-device performance run (/perf)

设置 → 偏好 → 诊断 → 性能测试 opens `/perf`. 开始测试 loads `lib/perf/runner.ts` (a dynamic
import; nothing of it is in another route's bundle) and drives the real gallery with the same
synthetic input the browser tests use: a press and release on a card (touch on a coarse
pointer, so the release opens), a horizontal flick on the picture, Escape, `history.back()` and a
pointer pull. It watches `data-image-hero-state` on `<html>` — never the engine — and records
`requestAnimationFrame` timestamps plus long animation frames (long tasks where LoAF is missing).
It returns to `/perf` with a report (last one kept under `LS_KEYS.perfReport`) exportable as
Markdown or JSON, copied, or shared.

- The grid defaults to `/`; `/perf?gallery=/user/1` (any same-origin path) runs on another one.
- Scenarios: idle baseline (refresh-rate estimate), list scroll, open, step, close by Escape,
  pull and Back; N rounds each. Arithmetic and verdict thresholds live in `lib/perf/stats.ts`
  (`scripts/testPerf.mjs`).
- Frames are main-thread frames. A compositor-driven flight can stay smooth through a main-thread
  stall, so a drop is not always visible — but it always hits the finger-driven parts (pull,
  swipe, the corner radius) and the next input. Synthetic input skips the OS touch pipeline, so
  real taps add ~10–30ms to the reported response latency.
- A close or open that settles without a flight (card off screen, reduced motion) is reported
  as “没有飞行动画，直接切换”, not as a failure.
- An unavailable response latency does not lower a completed sample's verdict; its frame data
  still counts, and a timeout still fails. The latest report is also kept in memory so denied or
  full storage cannot discard the run before it can be viewed or exported.
