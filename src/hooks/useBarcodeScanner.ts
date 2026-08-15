import { useEffect, useRef } from 'react';

interface BarcodeScannerOptions {
  onScan: (barcode: string) => void;
  minLength?: number;
  timeGapLimitMs?: number; // threshold in ms to distinguish keyboard from scanner
}

export function useBarcodeScanner({
  onScan,
  minLength = 4,
  timeGapLimitMs = 50,
}: BarcodeScannerOptions) {
  const bufferRef = useRef<string[]>([]);
  const lastKeyTimeRef = useRef<number>(0);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip modifier keys
      if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      const currentTime = Date.now();
      const timeGap = currentTime - lastKeyTimeRef.current;
      lastKeyTimeRef.current = currentTime;

      // If it is a normal text character
      if (event.key.length === 1) {
        // If the gap is too large, reset buffer (implies human typing, unless buffer is empty)
        if (bufferRef.current.length > 0 && timeGap > timeGapLimitMs) {
          bufferRef.current = [];
        }
        bufferRef.current.push(event.key);
      } else if (event.key === 'Enter') {
        const barcode = bufferRef.current.join('').trim();
        bufferRef.current = []; // Clear buffer immediately

        if (barcode.length >= minLength) {
          event.preventDefault();
          event.stopPropagation();
          onScan(barcode);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onScan, minLength, timeGapLimitMs]);
}
