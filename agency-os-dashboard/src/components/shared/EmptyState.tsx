import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  sub: string;
}

export function EmptyState({ icon, title, sub }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">{icon}</div>
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-sub">{sub}</div>
    </div>
  );
}
