"use client";

import { useEffect, useRef, useState } from "react";

const SPOTLIGHT_RADIUS = 140; // px

/**
 * Covers the viewer with a blur, leaving a clear circle around the pointer
 * (or the last touch). Before any pointer movement everything is blurred.
 * The overlay ignores pointer events, so scrolling and clicks go through.
 */
export function ConfidentialViewOverlay({
  navbarAbove = false,
}: {
  navbarAbove?: boolean;
  rotation?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const move = (x: number, y: number) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      setPoint({ x: x - rect.left, y: y - rect.top });
    };
    const onPointer = (e: PointerEvent) => move(e.clientX, e.clientY);
    const onLeave = () => setPoint(null);
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("pointerdown", onPointer);
    document.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  const mask = point
    ? `radial-gradient(circle ${SPOTLIGHT_RADIUS}px at ${point.x}px ${point.y}px, transparent 0, transparent ${SPOTLIGHT_RADIUS - 20}px, black ${SPOTLIGHT_RADIUS}px)`
    : undefined;

  return (
    <div
      ref={ref}
      data-confidential-view=""
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-40"
      style={{
        top: navbarAbove ? "var(--confidential-view-offset, 0px)" : 0,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    />
  );
}
