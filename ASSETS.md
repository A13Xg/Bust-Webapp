# BUST — Remaining Asset Wishlist

Assets already in place: logo (`public/bust-logo.png`), app icons (`public/icons/`, generated — see below), tier medals (`public/badges/*.png`, auto-optimized 512px copies in `public/badges/512/`), and all four SFX (`public/sfx/`).

## Icons

Everything in `public/icons/` except `badge-96.png` is **generated** — edit the
masters in `art/`, never the output:

```
python scripts/generate-icons.py
```

| Master | Feeds | Used by |
|---|---|---|
| `art/Favicon.png` | `favicon-{16,32,48,192}.png` | browser tabs (`<link rel="icon">`) |
| `art/PWA-icon.png` | `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` | installed app on every OS — manifest for Android/desktop, `apple-touch-icon` for iOS |

The two are independent on purpose: the tab icon and the installed-app icon are
separate mechanisms, so the favicon art never reaches a home screen and vice
versa. `art/` sits outside `public/` so the multi-megabyte masters are not
deployed. `badge-96.png` is hand-made (monochrome notification badge) and is not
regenerated.

Alpha is preserved except on `icon-maskable-512.png` and `apple-touch-icon.png`,
which are flattened onto `#0a0a0b` because Android applies its own mask to
maskable art and iOS ignores alpha entirely. See the script's docstring.

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

## Notes
- Badge PNGs came in as opaque RGB — worked around it: their near-black background matches the app background, and they're clipped to circles. Transparent-background versions would let them sit on lighter cards too.
