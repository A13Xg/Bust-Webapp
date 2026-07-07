# BUST — Remaining Asset Wishlist

Assets already in place: logo (`public/bust-logo.png`), favicon (`public/favicon.png`), tier medals (`public/badges/*.png`, auto-optimized 512px copies in `public/badges/512/`), button model (`public/models/bust-button.glb`), and all four SFX (`public/sfx/`).

Everything below is optional — the app currently covers these with procedural/code-generated stand-ins.

| Name | Location | Type | Description |
|---|---|---|---|
| `milk-splat-decal` | `public/textures/milk-splat.png` | PNG, 1024×1024, **transparent bg** | Irregular white/cream liquid splatter. Would replace the procedural wall/floor splats in the 3D cooldown scene. |
| `milk-normal-map` | `public/textures/milk-normal.png` | PNG, 1024×1024, tileable | Normal map of gentle liquid ripples to give the 3D puddle realistic surface detail. |
| `button-press` | `public/sfx/button-press.mp3` | Sound, ~0.3s | Chunky mechanical click for the instant the BUST button is first tapped (before the charge loop). |
| `ui-tick` | `public/sfx/ui-tick.mp3` | Sound, ~0.1s | Soft tick for opening overlays / closing toasts. |
| `level-up` | `public/sfx/level-up.mp3` | Sound, ~1.5s | Bigger fanfare than badge-unlock, reserved for XP level-ups (Dripling → Puddle Scout, etc.). |
| `avatar-frames` | `public/frames/{1..10}.png` | PNG set, 512×512, transparent center | Decorative rings/frames per XP level to wrap operator avatars. |
| `empty-state-art` | `public/art/empty-bay.png` | PNG, ~800×600, transparent bg | Moody illustration of an empty hangar bay with a lone drip, for empty feeds/charts. |
| `bust-logo-wide` | `public/bust-logo-wide.png` | PNG, ~1200×300, transparent bg | Horizontal wordmark variant for the top bar on desktop (current logo is square). |
| `bust-button-lowpoly` | `public/models/bust-button-low.glb` | GLB, <500 KB | Decimated version of the 9 MB button model for faster loads on mobile data (say the word and I'll wire it in as the mobile default). |

## Notes
- Badge PNGs came in as opaque RGB — worked around it: their near-black background matches the app background, and they're clipped to circles. Transparent-background versions would let them sit on lighter cards too.
- The 9 MB GLB loads lazily (only during cooldown) and falls back to a procedural button on slow/failed loads, but a compressed (Draco/quantized) export would help mobile a lot.
