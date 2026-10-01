'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from './Button';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

export interface ModalProps {
  title: string;
  closeLabel: string;
  onClose(): void;
  /**
   * Emergency entry point shown inside the dialog. Every modal except the
   * emergency dialog itself must provide it, so help is never covered.
   */
  emergency?: { label: string; onOpen(): void };
  /** `top` sits above ordinary modals. Reserved for emergency help. */
  layer?: 'modal' | 'top';
  /** Disables the dialog while another one is stacked above it. */
  inert?: boolean;
  children: ReactNode;
}

/** Accessible dialog: labelled, traps Tab, closes on Escape, and returns focus to where it came from. */
export function Modal({ title, closeLabel, onClose, emergency, layer = 'modal', inert = false, children }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={`fixed inset-0 flex items-end justify-center bg-ink/70 backdrop-blur-sm sm:items-center ${layer === 'top' ? 'z-50' : 'z-40'}`}
      inert={inert}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="max-h-dvh w-full max-w-xl overflow-y-auto rounded-t-[2rem] bg-surface p-5 shadow-float sm:rounded-[2rem]"
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <h2 id={titleId} className="text-2xl font-extrabold tracking-tight">
            {title}
          </h2>
          <div className="flex flex-wrap gap-2">
            {emergency && (
              <Button variant="danger" size="md" icon="phone" onClick={emergency.onOpen}>
                {emergency.label}
              </Button>
            )}
            <Button variant="quiet" size="md" icon="close" onClick={onClose}>
              {closeLabel}
            </Button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
