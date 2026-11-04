# Companion asset provenance

Source and licensing information for the Browser Ponies engine and character previews. Runtime rules are in [Companions](../../docs/companions.md).

## Browser Ponies engine

`browserponies.js` was copied from the original PicPony frontend at [picpony.top/assets/lib/browserponies.js?v=2](https://picpony.top/assets/lib/browserponies.js?v=2).

Browser Ponies is by Mathias Panzenböck, copyright 2011–2013. Its MIT license is retained verbatim at the top of the file.

One compatibility change uses native effect images in every browser instead of the historical nested-iframe GIF workaround. The wrapper accepts no executable configuration callbacks or external URLs. Engine listeners and timers stay inside the disposable sandbox.

## Preview artwork

`previews/*.png` contains 36 original Desktop Ponies character sprites served by PicPony's public `get_pony_configs` on 2026-10-03. Each PNG is the source sprite's first frame, with no resizing, recolouring, redrawing or other visual modification.

[previews/provenance.json](previews/provenance.json) records source URLs, source SHA-256 hashes, original dimensions and output paths. [previewCatalog.ts](../../lib/desktopPonies/previewCatalog.ts) names the same preview files.

The public API does not identify individual sprite artists or per-artwork licenses. The engine's MIT license does **not** establish a license for the artwork; no Creative Commons license is asserted. The site's terms, section 5.4, make the same distinction.

These are the original site's assets reused for the owner's requested PicPony reproduction. Provenance is retained, no new ownership is claimed, and My Little Pony character rights remain with their respective holders.
