import type { ReactNode } from 'react';
import { useEffect } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  width?: number | string;
  children: ReactNode;
}

export function Modal({ open, onClose, width = 640, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <div
      className={`modal-overlay ${open ? 'open' : ''}`}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" style={{ width: typeof width === 'number' ? `${width}px` : width }}>
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ title, onClose, children }: { title?: string; onClose: () => void; children?: ReactNode }) {
  return (
    <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
        {title && <span style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text)' }}>{title}</span>}
        {children}
      </div>
      <button className="mclose" onClick={onClose}>✕</button>
    </div>
  );
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
      {children}
    </div>
  );
}
