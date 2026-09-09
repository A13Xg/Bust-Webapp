/*
 * Minimal image lightbox: the picture, and an orange X. Nothing else.
 *
 * Deliberately not wired to any app behaviour yet — the debug menu's Tools tab
 * is the only thing that opens it. `src` is a plain prop so whatever opens it
 * later decides what it shows.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Lightbox({ src, alt = '', onClose }) {
  useEffect(() => {
    const onKey = event => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="lightbox-back"
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'Image preview'}
      onClick={onClose}
    >
      <button className="lightbox-close" onClick={onClose} aria-label="Close image">
        <X />
      </button>
      {/* Clicking the picture itself must not count as clicking the backdrop. */}
      <img className="lightbox-img" src={src} alt={alt} onClick={event => event.stopPropagation()} />
    </div>,
    document.body
  );
}
