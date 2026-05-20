import type { Toast } from '../../hooks/useToast';

export function ToastContainer({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type === 'error' ? 'error' : t.type === 'success' ? 'success' : ''} ${t.hiding ? 'hiding' : ''}`}>
          <span>{t.type === 'error' ? '✗' : t.type === 'success' ? '✓' : '·'}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
