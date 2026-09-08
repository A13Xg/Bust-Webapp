/*
 * Long-press gesture for touch, so the hidden debug menu is reachable on a
 * phone at all.
 *
 * `onContextMenu` alone is a desktop-only gesture. iOS Safari answers a long
 * press with its own text-selection / callout UI and never fires `contextmenu`,
 * which is why holding DELETE ACCOUNT used to just highlight the words. Pointer
 * events give us the same gesture on every platform; the CSS side of the fix
 * (`-webkit-touch-callout: none`, `user-select: none`) is what stops the OS
 * from competing with us for the hold.
 */
import { useCallback, useEffect, useRef } from 'react';

export const LONG_PRESS_MS = 500;
/* A hold that drifts further than this was a scroll, not a press. */
export const MOVE_CANCEL_PX = 10;

export function useLongPress(onLongPress, { delay = LONG_PRESS_MS } = {}) {
  const timer = useRef(null);
  const origin = useRef(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    event => {
      // Right-click stays with onContextMenu; only a primary press holds.
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      fired.current = false;
      const point = { x: event.clientX, y: event.clientY };
      origin.current = point;
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress(point);
      }, delay);
    },
    [delay, onLongPress]
  );

  const onPointerMove = useCallback(
    event => {
      if (!origin.current) return;
      const dx = event.clientX - origin.current.x;
      const dy = event.clientY - origin.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > MOVE_CANCEL_PX) cancel();
    },
    [cancel]
  );

  /*
   * A completed long press is followed by a synthetic click on touch. The
   * caller asks whether to swallow it, so holding to open the debug menu does
   * not also trigger the button's real action.
   */
  const consumeClick = useCallback(() => {
    if (!fired.current) return false;
    fired.current = false;
    return true;
  }, []);

  return {
    consumeClick,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
    },
  };
}
