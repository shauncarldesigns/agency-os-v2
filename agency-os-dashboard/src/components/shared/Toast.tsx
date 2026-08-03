import { useState } from 'react';
import type { Toast } from '../../hooks/useToast';

function ToastItem({ toast }: { toast: Toast }) {
  const [running, setRunning] = useState(false);
  const [used, setUsed] = useState(false);

  return (
    <div className={`toast ${toast.type === 'error' ? 'error' : toast.type === 'success' ? 'success' : ''} ${toast.hiding ? 'hiding' : ''}`}>
      <span className="toast-status-dot" aria-hidden="true" />
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          disabled={running || used}
          onClick={() => {
            setRunning(true);
            void Promise.resolve(toast.action?.onClick()).finally(() => {
              setRunning(false);
              setUsed(true);
            });
          }}
        >
          {running ? 'Undoing…' : used ? 'Undone' : toast.action.label}
        </button>
      )}
    </div>
  );
}

export function ToastContainer({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
