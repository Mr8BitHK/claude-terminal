import { useEffect, RefObject } from 'react';

/**
 * Calls `onClose` when a mousedown occurs outside the referenced element.
 * Only attaches the listener when `active` is true.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, active, onClose]);
}
