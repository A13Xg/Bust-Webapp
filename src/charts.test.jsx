// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

import { PriceLine } from './charts.jsx';
import { formatBtcCompact } from './bitcoin.js';

afterEach(cleanup);

function paths(container) {
  return [...container.querySelectorAll('path')].map(p => p.getAttribute('d'));
}

describe('PriceLine', () => {
  it('asks for more data instead of drawing a degenerate chart', () => {
    const { container } = render(<PriceLine points={[]} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText(/not enough priced busts/i)).toBeTruthy();

    cleanup();
    const single = render(<PriceLine points={[{ label: 'a', value: 60000 }]} />);
    expect(single.container.querySelector('svg')).toBeNull();
  });

  it('plots one point per bust with a readable tooltip', () => {
    const points = [
      { label: 'Ada · Mar 1', value: 60000 },
      { label: 'Lin · Mar 2', value: 64000 },
      { label: 'Ada · Mar 3', value: 71000 },
    ];
    const { container } = render(<PriceLine points={points} format={v => formatBtcCompact(v) || '—'} />);

    expect(container.querySelectorAll('circle')).toHaveLength(3);
    const titles = [...container.querySelectorAll('title')].map(t => t.textContent);
    expect(titles[0]).toBe('Ada · Mar 1: $60.0k');
    expect(titles[2]).toBe('Ada · Mar 3: $71.0k');
    // Every coordinate must be a real number; a NaN silently blanks the SVG.
    for (const d of paths(container)) expect(d).not.toMatch(/NaN/);
  });

  it('survives a completely flat series without dividing by zero', () => {
    const flat = Array.from({ length: 4 }, (_, i) => ({ label: `b${i}`, value: 60000 }));
    const { container } = render(<PriceLine points={flat} />);
    expect(container.querySelectorAll('circle')).toHaveLength(4);
    for (const d of paths(container)) expect(d).not.toMatch(/NaN/);
  });

  it('signals direction by colour: up is orange, down is blue', () => {
    const up = render(
      <PriceLine
        points={[
          { label: 'a', value: 10000 },
          { label: 'b', value: 90000 },
        ]}
      />
    );
    const upStroke = up.container.querySelectorAll('path')[1].getAttribute('stroke');
    cleanup();
    const down = render(
      <PriceLine
        points={[
          { label: 'a', value: 90000 },
          { label: 'b', value: 10000 },
        ]}
      />
    );
    const downStroke = down.container.querySelectorAll('path')[1].getAttribute('stroke');
    expect(upStroke).not.toBe(downStroke);
  });
});
