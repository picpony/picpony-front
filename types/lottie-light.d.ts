/**
 * The "light" ESM build of lottie-web ships without a sibling `.d.ts` — only
 * the full `build/player/lottie.d.ts` has one — so importing the small build
 * for the logo trace resolves to `any` and `noImplicitAny` rejects it.
 *
 * The build differs from the full one only in dropping expression evaluation
 * (which the logo does not use) and the non-SVG renderers, so the package's own
 * types describe it exactly. Re-exporting them keeps `loadAnimation` and the
 * `AnimationItem` it returns fully typed rather than silencing the error.
 */
declare module 'lottie-web/build/player/esm/lottie_light.min.js' {
  export * from 'lottie-web';
  export { default } from 'lottie-web';
}
