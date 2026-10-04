import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronUp, X } from 'lucide-react';
import { haptic } from './haptics.js';

/** Keep the header outside the scroll area and the entire drawer outside the
 * shaking dashboard. Transformed ancestors otherwise capture fixed children. */
export function Overlay({ title, onClose, children, showScrollTop = false }) {
  const scrollRef = useRef(null);
  const closeRef = useRef(null);
  const titleId = useId();
  const reduced = useReducedMotion();
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus({ preventScroll: true });
    haptic('selection');
    return () => {
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  const close = () => {
    haptic('selection');
    onClose();
  };
  return createPortal(
    <motion.div className="drawer-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="dashboard-scrim" onClick={close} aria-hidden="true" />
      <motion.section
        className="overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={{ y: reduced ? 0 : '100%' }}
        animate={{ y: 0 }}
        exit={{ y: reduced ? 0 : '100%' }}
        transition={{ duration: reduced ? 0 : 0.24 }}
        onKeyDown={event => {
          // Portalled child dialogs bubble through React; they own their Escape.
          if (!event.currentTarget.contains(event.target)) return;
          if (event.key === 'Escape') {
            event.stopPropagation();
            close();
          }
          if (event.key === 'Tab') {
            const buttons = [
              ...event.currentTarget.querySelectorAll(
                'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'
              ),
            ].filter(el => el.getClientRects().length);
            const first = buttons[0],
              last = buttons.at(-1);
            if (event.shiftKey && event.target === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && event.target === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="overlay-head">
          <h1 id={titleId}>{title}</h1>
          <button ref={closeRef} type="button" className="close" onClick={close} aria-label={`Close ${title}`}>
            <X />
          </button>
        </div>
        <div className="overlay-content" ref={scrollRef}>
          {children}
          {showScrollTop && (
            <button
              type="button"
              className="scroll-top"
              aria-label="Back to top"
              onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })}
            >
              <ChevronUp />
            </button>
          )}
        </div>
      </motion.section>
    </motion.div>,
    document.body
  );
}
