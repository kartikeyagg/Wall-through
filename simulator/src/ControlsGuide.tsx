"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CONTROL_GROUPS, formatKeys } from "./controls.js";
import "./controls-guide.css";

type ControlsGuideProps = {
  className?: string;
};

const focusableSelector = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export default function ControlsGuide({ className }: ControlsGuideProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const headingId = useId();
  const rootClassName = className ? `controls-guide ${className}` : "controls-guide";

  const close = useCallback(() => {
    setIsOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    const openWithShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const isTyping = target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("input, textarea, select")));
      if (event.key !== "?" || isTyping || document.pointerLockElement) return;
      event.preventDefault();
      setIsOpen(true);
    };

    window.addEventListener("keydown", openWithShortcut);
    return () => window.removeEventListener("keydown", openWithShortcut);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
      (firstFocusable ?? dialogRef.current)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  const trapFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && currentIndex <= 0) {
      event.preventDefault();
      focusable.at(-1)?.focus();
    } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
      event.preventDefault();
      focusable[0].focus();
    }
  };

  return <div className={rootClassName}>
    <button
      ref={triggerRef}
      type="button"
      className="controls-guide-button"
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-label="Show keyboard and mouse controls"
      onClick={() => setIsOpen(true)}
    >
      <span aria-hidden="true">⌨</span> Controls
    </button>
    {isOpen ? <div className="controls-guide-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialogRef} className="controls-guide-panel" role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} onKeyDown={trapFocus}>
        <header className="controls-guide-header">
          <div><p>INPUT REFERENCE</p><h2 id={headingId}>Keyboard and mouse controls</h2></div>
          <button type="button" className="controls-guide-close" aria-label="Close controls guide" onClick={close}>×</button>
        </header>
        <div className="controls-guide-body">
          {CONTROL_GROUPS.map((group) => <section className="controls-guide-group" key={group.id}>
            <h3>{group.title}</h3>
            {group.note ? <p className="controls-guide-note">{group.note}</p> : null}
            <ul>
              {group.controls.map((control) => <li key={`${group.id}-${control.action}`}>
                <span className="controls-guide-keys" aria-label={`Keys: ${formatKeys(control.keys, control.keyStyle)}`}>
                  {control.keys.map((key, index) => <span className="controls-guide-key" key={key}>
                    {index ? <span className="controls-guide-separator" aria-hidden="true">{control.keyStyle === "chord" ? "+" : "/"}</span> : null}
                    <kbd>{key}</kbd>
                  </span>)}
                </span>
                <span className="controls-guide-action">{control.action}{control.context ? <small>{control.context}</small> : null}</span>
              </li>)}
            </ul>
          </section>)}
        </div>
      </section>
    </div> : null}
  </div>;
}
