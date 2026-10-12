import { useCallback, useEffect, useRef, useState } from "react";

// Must match --dur-base. Keep the panel mounted until its exit finishes.
const EXIT_MS = 240;
function reducedMotion() {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export default function useSheetMotion(open: boolean, onClose: () => void) {
  const [visible, setVisible] = useState(open);
  const [entered, setEntered] = useState(false);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeCallback = useRef(onClose);
  const closing = useRef(false);
  closeCallback.current = onClose;

  function clearTimers() {
    if (enterTimer.current) clearTimeout(enterTimer.current);
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }

  useEffect(() => {
    clearTimers();
    closing.current = false;
    if (open) {
      setVisible(true);
      setEntered(false);
      // A separate paint gives CSS transitions an initial state on both targets.
      enterTimer.current = setTimeout(() => setEntered(true), 32);
    } else {
      setEntered(false);
      exitTimer.current = setTimeout(() => setVisible(false), reducedMotion() ? 0 : EXIT_MS);
    }
    return clearTimers;
  }, [open]);

  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    clearTimers();
    setEntered(false);
    exitTimer.current = setTimeout(() => {
      setVisible(false);
      closeCallback.current();
    }, reducedMotion() ? 0 : EXIT_MS);
  }, []);

  useEffect(() => {
    if (!visible || typeof window === "undefined") return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [visible, requestClose]);

  return { visible, entered, requestClose };
}
