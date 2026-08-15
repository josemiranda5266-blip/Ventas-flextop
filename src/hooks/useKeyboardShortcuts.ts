import { useEffect } from 'react';

interface KeyboardShortcuts {
  [key: string]: (e: KeyboardEvent) => void;
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcuts, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const handler = shortcuts[e.key];
      if (handler) {
        // Prevent default browser action (e.g. F5 refreshes, F6 selects URL bar)
        e.preventDefault();
        e.stopPropagation();
        handler(e);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [shortcuts, enabled]);
}
