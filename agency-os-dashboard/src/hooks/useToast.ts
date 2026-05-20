import { useState, useCallback } from 'react';

export interface Toast {
  id: string;
  message: string;
  type: 'default' | 'success' | 'error';
  hiding?: boolean;
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: Toast['type'] = 'default') => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, hiding: true } : t));
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 220);
    }, 2800);
  }, []);

  return { toasts, showToast };
}
