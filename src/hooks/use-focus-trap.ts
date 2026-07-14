"use client";

/**
 * useFocusTrap
 *
 * Traps keyboard focus within a container element while it is open.
 *
 * Usage:
 *   const containerRef = useRef<HTMLDivElement>(null);
 *   useFocusTrap(containerRef, isOpen);
 *
 * When isOpen becomes true:
 *   - Focus is moved into the container (first focusable element).
 *   - Tab / Shift+Tab cycle is constrained to the container's focusable children.
 *   - The previously focused element is restored on close.
 *
 * Requirements:
 *   - The ref must be attached to the outermost container element.
 *   - The container must be rendered (not null) when isOpen is true.
 */

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTORS = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const container = containerRef.current;
    if (!container) return;

    // Remember what was focused before the trap opened
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus the first focusable element inside the container
    const focusableElements = Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
    ).filter((el) => !el.closest("[aria-hidden='true']"));

    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    } else {
      // Fall back to the container itself if nothing is focusable
      container.focus();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;

      const elements = Array.from(
        container!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
      ).filter((el) => !el.closest("[aria-hidden='true']"));

      if (elements.length === 0) {
        e.preventDefault();
        return;
      }

      const firstEl = elements[0];
      const lastEl = elements[elements.length - 1];
      const activeEl = document.activeElement as HTMLElement;

      if (e.shiftKey) {
        // Backward tab: if we're on the first element, wrap to last
        if (activeEl === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        // Forward tab: if we're on the last element, wrap to first
        if (activeEl === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Restore focus to the element that was active before the trap opened
      previousFocusRef.current?.focus();
    };
  }, [isOpen, containerRef]);
}
