import { useCallback, useLayoutEffect, useRef } from "react";

// Values from review-animations/STANDARDS.md: bounded UI timing and drawer easing.
const DRAWER_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const RETURN_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

/** Safari-safe left-edge interaction: track continuously, decide only on release. */
export default function useSwipeBack(onBack: () => void, blocked: boolean) {
  const back = useRef(onBack);
  const disabled = useRef(blocked);
  const close = useRef<(() => void) | null>(null);
  back.current = onBack;
  disabled.current = blocked;
  const requestBack = useCallback(() => {
    if (close.current) close.current();
    else back.current();
  }, []);

  useLayoutEffect(() => {
    if (process.env.TARO_ENV !== "h5") return;
    const sheet = document.getElementById("note-detail-sheet");
    const edge = document.getElementById("note-back-edge");
    if (!sheet || !edge) return;
    const overlay = sheet.parentElement!;
    const route = sheet.closest<HTMLElement>(".taro_page");
    // Move all of the detail page, including its fixed chrome, as one surface.
    const surface = route ?? overlay;
    const previous = route?.previousElementSibling instanceof HTMLElement
      ? route.previousElementSibling : null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animation: Animation | null = null;
    let underlayAnimation: Animation | null = null;
    let x = 0;
    let navigated = false;
    let suppressClick = false;
    let targetIsBack = false;
    let gesture: { id: number; startX: number; startY: number; origin: number; scrollY: number; axis: "pending" | "x" | "y" | "left"; samples: { x: number; time: number }[] } | null = null;
    const wasInert = previous?.inert ?? false;
    const previousTransform = previous?.style.transform ?? "";
    const previousWillChange = previous?.style.willChange ?? "";
    const underlayX = (position: number) => reduced.matches ? 0 : (position - window.innerWidth) * 0.24;

    function revealList() {
      if (!previous) return;
      previous.classList.add("note-back-underlay");
      previous.inert = true;
      previous.style.willChange = reduced.matches ? "auto" : "transform";
      surface.classList.add("note-back-foreground");
    }
    function hideList() {
      previous?.classList.remove("note-back-underlay");
      if (previous) {
        previous.inert = wasInert;
        previous.style.transform = previousTransform;
        previous.style.willChange = previousWillChange;
      }
      surface.classList.remove("note-back-foreground");
    }
    function paint() {
      surface.style.transform = reduced.matches ? "none" : `translate3d(${x}px, 0, 0)`;
      surface.style.opacity = reduced.matches ? String(1 - x / window.innerWidth * 0.35) : "1";
      if (previous) previous.style.transform = `translate3d(${underlayX(x)}px, 0, 0)`;
    }
    function stop() {
      if (underlayAnimation) {
        if (previous) previous.style.transform = getComputedStyle(previous).transform;
        underlayAnimation.cancel();
        underlayAnimation = null;
      }
      if (animation) {
        // Capture presentation, not the old destination, when the page is re-grabbed.
        const style = getComputedStyle(surface);
        if (!reduced.matches) x = new DOMMatrixReadOnly(style.transform).m41;
        surface.style.transform = style.transform;
        surface.style.opacity = style.opacity;
        animation.onfinish = null;
        animation.cancel();
        animation = null;
      }
      targetIsBack = false;
    }
    function finishBack() {
      if (navigated) return;
      navigated = true;
      back.current();
    }
    function settle(target: number, commit = false, entering = false) {
      stop();
      targetIsBack = commit;
      revealList();
      const from = x;
      const opacity = Number(getComputedStyle(surface).opacity);
      animation = surface.animate(
        reduced.matches
          ? [{ opacity }, { opacity: commit ? 0 : 1 }]
          : [{ transform: `translate3d(${from}px, 0, 0)` }, { transform: `translate3d(${target}px, 0, 0)` }],
        { duration: reduced.matches ? 100 : commit || entering ? 200 : 160, easing: commit || entering ? DRAWER_EASE : RETURN_EASE, fill: "both" },
      );
      if (previous && !reduced.matches) {
        underlayAnimation = previous.animate(
          [{ transform: `translate3d(${underlayX(from)}px, 0, 0)` }, { transform: `translate3d(${underlayX(target)}px, 0, 0)` }],
          { duration: commit || entering ? 200 : 160, easing: commit || entering ? DRAWER_EASE : RETURN_EASE, fill: "both" },
        );
      }
      animation.onfinish = () => {
        x = target;
        paint();
        if (commit) {
          // Keep the final frame in place until the route is removed.
          finishBack();
        } else {
          stop();
          x = 0;
          surface.style.removeProperty("transform");
          surface.style.removeProperty("opacity");
          surface.style.removeProperty("will-change");
          hideList();
        }
      };
    }
    close.current = () => {
      if (window.innerWidth > 1099) { back.current(); return; }
      if (navigated || targetIsBack) return;
      surface.style.willChange = "transform";
      settle(window.innerWidth, true);
    };

    function start(event: TouchEvent) {
      if (window.innerWidth > 1099 || navigated || (window.visualViewport?.scale ?? 1) > 1) return;
      if (event.touches.length !== 1) { cancel(); return; }
      const touch = event.touches[0];
      if (touch.clientX > 32) return;
      // Safari's browser-history recognizer must be stopped at touchstart,
      // before it takes over and cancels the application's pointer stream.
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
      if (disabled.current || window.getSelection()?.toString()) return;
      stop();
      gesture = { id: touch.identifier, startX: touch.clientX, startY: touch.clientY, origin: x, scrollY: sheet!.scrollTop, axis: "pending", samples: [{ x: touch.clientX, time: event.timeStamp }] };
    }
    function move(event: TouchEvent) {
      if (!gesture) return;
      if (event.touches.length !== 1) { cancel(); return; }
      const touch = Array.from(event.touches).find(touch => touch.identifier === gesture!.id);
      if (!touch) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;
      if (gesture.axis === "pending") {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
        gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? (dx > 0 || gesture.origin > 0 ? "x" : "left") : "y";
        if (gesture.axis === "x") {
          surface.style.willChange = reduced.matches ? "opacity" : "transform";
          revealList();
        }
      }
      if (gesture.axis === "y") {
        // Only the 28px edge claims touchstart; vertical drags there still scroll.
        sheet!.scrollTop = gesture.scrollY - dy;
        return;
      }
      if (gesture.axis !== "x") return;
      gesture.samples.push({ x: touch.clientX, time: event.timeStamp });
      gesture.samples = gesture.samples.filter(sample => event.timeStamp - sample.time <= 100);
      x = Math.min(window.innerWidth, Math.max(0, gesture.origin + dx));
      suppressClick = true;
      // Touchmove paints immediately: progress is visible while the finger is down.
      paint();
    }
    function end(event: TouchEvent) {
      if (!gesture) return;
      const touch = Array.from(event.changedTouches).find(touch => touch.identifier === gesture!.id);
      if (!touch) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      const ended = gesture;
      gesture = null;
      if (ended.axis !== "x") { if (x > 0) settle(0); return; }
      x = Math.min(window.innerWidth, Math.max(0, ended.origin + touch.clientX - ended.startX));
      const first = ended.samples[0];
      const last = ended.samples[ended.samples.length - 1];
      const elapsed = last.time - first.time;
      const velocity = event.timeStamp - last.time <= 100 && elapsed > 0 ? (last.x - first.x) / elapsed : 0;
      // A brief accidental movement cannot pop the page. Decide only on release.
      const commit = velocity >= -0.15 && (x >= window.innerWidth * 0.4 || (x >= 64 && velocity >= 0.65));
      paint();
      settle(commit ? window.innerWidth : 0, commit);
    }
    function cancel() {
      const horizontal = gesture?.axis === "x";
      gesture = null;
      if (horizontal || x > 0) { paint(); settle(0); }
    }
    function click(event: MouseEvent) {
      if (!suppressClick || event.detail === 0) return;
      event.preventDefault(); event.stopPropagation(); suppressClick = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || window.innerWidth > 1099) return;
      event.stopImmediatePropagation();
      // Keyboard navigation needs no decorative travel or waiting.
      stop(); finishBack();
    }
    edge.addEventListener("touchstart", start, { passive: false });
    edge.addEventListener("touchmove", move, { passive: false });
    edge.addEventListener("touchend", end, { passive: false });
    edge.addEventListener("touchcancel", cancel);
    sheet.addEventListener("click", click, true);
    window.addEventListener("keydown", escape, true);
    if (window.innerWidth <= 1099 && previous) {
      x = window.innerWidth;
      surface.style.willChange = reduced.matches ? "opacity" : "transform";
      revealList(); paint(); settle(0, false, true);
    }
    return () => {
      close.current = null;
      stop();
      hideList();
      surface.style.removeProperty("transform");
      surface.style.removeProperty("opacity");
      surface.style.removeProperty("will-change");
      edge.removeEventListener("touchstart", start);
      edge.removeEventListener("touchmove", move);
      edge.removeEventListener("touchend", end);
      edge.removeEventListener("touchcancel", cancel);
      sheet.removeEventListener("click", click, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, []);

  return requestBack;
}
