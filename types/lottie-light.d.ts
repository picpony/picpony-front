/**
 * The "light" ESM build ships without a sibling `.d.ts`, so re-export the package's own
 * types (the build only drops expression evaluation and non-SVG renderers) to keep
 * `loadAnimation` and its `AnimationItem` fully typed instead of `any`.
 */
declare module 'lottie-web/build/player/esm/lottie_light.min.js' {
  export * from 'lottie-web';
  export { default } from 'lottie-web';
}
