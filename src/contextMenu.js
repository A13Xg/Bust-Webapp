/*
 * Placement for the hidden debug context menu.
 *
 * The menu is rendered through a portal to <body> rather than inside the
 * overlay. That is not a style choice: `.overlay` carries `backdrop-filter`,
 * which makes it a containing block for `position: fixed` descendants, so a
 * fixed menu nested inside it resolves left/top against the overlay's scrolled
 * box instead of the viewport — the menu drifted by exactly the scroll offset.
 * Portalling to <body> puts it back in the viewport's coordinate space, which
 * is the space clientX/clientY are already expressed in.
 */

/** Keep the menu fully on screen no matter where it was summoned. */
export function clampMenuToViewport(x, y, menu, viewport, margin = 8) {
  const width = menu?.width || 0;
  const height = menu?.height || 0;
  const vw = viewport?.width || 0;
  const vh = viewport?.height || 0;

  // Prefer flipping to the other side of the cursor; only then clamp, so the
  // menu never sits under the finger that opened it.
  let left = x;
  if (left + width + margin > vw) left = x - width;
  let top = y;
  if (top + height + margin > vh) top = y - height;

  return {
    left: Math.max(margin, Math.min(left, Math.max(margin, vw - width - margin))),
    top: Math.max(margin, Math.min(top, Math.max(margin, vh - height - margin))),
  };
}
