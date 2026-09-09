import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { LONG_PRESS_MS, useLongPress } from './useLongPress.js';

function Harness({ onLongPress, onActivate }) {
  const longPress = useLongPress(onLongPress);
  return (
    <button
      {...longPress.handlers}
      onClick={() => {
        if (longPress.consumeClick()) return;
        onActivate();
      }}
    >
      HOLD ME
    </button>
  );
}

const hold = ms => act(() => void vi.advanceTimersByTime(ms));

describe('useLongPress', () => {
  let onLongPress;
  let onActivate;

  beforeEach(() => {
    vi.useFakeTimers();
    onLongPress = vi.fn();
    onActivate = vi.fn();
    render(<Harness onLongPress={onLongPress} onActivate={onActivate} />);
  });

  afterEach(() => vi.useRealTimers());

  const button = () => screen.getByText('HOLD ME');

  it('fires after a sustained hold, reporting where the press started', () => {
    fireEvent.pointerDown(button(), { clientX: 120, clientY: 300, pointerType: 'touch' });
    hold(LONG_PRESS_MS);
    expect(onLongPress).toHaveBeenCalledWith({ x: 120, y: 300 });
  });

  it('does not fire before the delay elapses', () => {
    fireEvent.pointerDown(button(), { clientX: 10, clientY: 10, pointerType: 'touch' });
    hold(LONG_PRESS_MS - 50);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels a hold that turns into a scroll', () => {
    fireEvent.pointerDown(button(), { clientX: 10, clientY: 10, pointerType: 'touch' });
    fireEvent.pointerMove(button(), { clientX: 10, clientY: 60, pointerType: 'touch' });
    hold(LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('tolerates the small drift of a real finger', () => {
    fireEvent.pointerDown(button(), { clientX: 10, clientY: 10, pointerType: 'touch' });
    fireEvent.pointerMove(button(), { clientX: 13, clientY: 14, pointerType: 'touch' });
    hold(LONG_PRESS_MS);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('cancels when the press is released early', () => {
    fireEvent.pointerDown(button(), { clientX: 10, clientY: 10, pointerType: 'touch' });
    hold(200);
    fireEvent.pointerUp(button());
    hold(LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('swallows the click that follows a completed long press', () => {
    fireEvent.pointerDown(button(), { clientX: 10, clientY: 10, pointerType: 'touch' });
    hold(LONG_PRESS_MS);
    fireEvent.pointerUp(button());
    fireEvent.click(button());
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('leaves an ordinary tap alone', () => {
    fireEvent.pointerDown(button(), { clientX: 10, clientY: 10, pointerType: 'touch' });
    hold(80);
    fireEvent.pointerUp(button());
    fireEvent.click(button());
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('ignores a right-click press, which onContextMenu owns', () => {
    fireEvent.pointerDown(button(), { clientX: 10, clientY: 10, pointerType: 'mouse', button: 2 });
    hold(LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('fires once when a second finger lands mid-hold, and leaves no orphan timer', () => {
    fireEvent.pointerDown(button(), { clientX: 10, clientY: 10, pointerType: 'touch' });
    hold(200);
    fireEvent.pointerDown(button(), { clientX: 12, clientY: 12, pointerType: 'touch' });
    hold(LONG_PRESS_MS);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    // The first timer must not still be pending behind the second.
    fireEvent.pointerUp(button());
    hold(LONG_PRESS_MS * 2);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });
});
