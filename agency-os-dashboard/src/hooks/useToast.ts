import { useState, useCallback, useEffect, useRef } from 'react';
import type { ToastAction, ToastType } from '../lib/types';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
  hiding?: boolean;
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const cleanupRef = useRef(new Map<string, () => void>());

  useEffect(() => () => {
    cleanupRef.current.forEach((cleanup) => cleanup());
    cleanupRef.current.clear();
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, hiding: true } : t));
    window.setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 220);
  }, []);

  const showToast = useCallback((message: string, type: Toast['type'] = 'default', action?: ToastAction) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, type, action }]);
    if (!action) {
      window.setTimeout(() => removeToast(id), 2800);
      return;
    }

    // Actionable toasts must remain reachable while an external-protocol
    // prompt or app (for example Messages) has control. Count down only while
    // this page is both visible and focused, then resume with the time left.
    let remaining = 12000;
    let startedAt = 0;
    let timer: number | null = null;

    const pause = () => {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };
    const resume = () => {
      if (timer !== null || document.hidden || !document.hasFocus()) return;
      startedAt = Date.now();
      timer = window.setTimeout(() => {
        cleanup();
        removeToast(id);
      }, remaining);
    };
    const handleVisibility = () => document.hidden ? pause() : resume();
    const cleanup = () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('blur', pause);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', handleVisibility);
      cleanupRef.current.delete(id);
    };

    window.addEventListener('blur', pause);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', handleVisibility);
    cleanupRef.current.set(id, cleanup);
    resume();
  }, [removeToast]);

  return { toasts, showToast };
}
