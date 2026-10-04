import { useState } from 'react';
import { createPortal } from 'react-dom';

/** Sample once per burst: dashboard ticks must not reroll particle trajectories. */
export function Explosion() {
  const [drops] = useState(() =>
    Array.from({ length: 64 }, (_, i) => {
      const angle = Math.random() * Math.PI * 2;
      const distance = 12 + Math.random() * 58;
      return {
        '--dx': `${Math.cos(angle) * distance}vmax`,
        '--dy': `${Math.sin(angle) * distance * 0.7}vmax`,
        '--fall': `${14 + Math.random() * 22}vh`,
        '--size': `${i % 5 === 0 ? 18 + Math.random() * 18 : 4 + Math.random() * 12}px`,
        '--angle': `${(angle * 180) / Math.PI + 90}deg`,
        '--delay': `${Math.random() * 0.16}s`,
        '--duration': `${1.1 + Math.random() * 0.7}s`,
      };
    })
  );
  const [splats] = useState(() =>
    Array.from({ length: 12 }, () => ({
      left: `${5 + Math.random() * 90}%`,
      top: `${8 + Math.random() * 72}%`,
      '--size': `${14 + Math.random() * 36}px`,
      '--delay': `${0.2 + Math.random() * 0.45}s`,
      '--drip': `${20 + Math.random() * 65}px`,
      '--tilt': `${Math.random() * 70 - 35}deg`,
    }))
  );
  return createPortal(
    <div className="explosion liquid-burst" aria-hidden="true">
      <div className="liquid-impact" />
      {drops.map((style, i) => (
        <i key={i} className="liquid-drop" style={style} />
      ))}
      {splats.map((style, i) => (
        <b key={i} className="liquid-splat" style={style} />
      ))}
    </div>,
    document.body
  );
}
