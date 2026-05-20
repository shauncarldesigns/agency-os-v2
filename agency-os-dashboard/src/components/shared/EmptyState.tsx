interface EmptyStateProps {
  icon: string;
  title: string;
  sub: string;
}

export function EmptyState({ icon, title, sub }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-sub">{sub}</div>
    </div>
  );
}
