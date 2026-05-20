import type { HeaderStats } from '../../lib/types';

interface HeaderProps {
  stats: HeaderStats;
  coworkConnected: boolean;
}

export function Header({ stats, coworkConnected }: HeaderProps) {
  const mrr = stats.mrrUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  return (
    <div className="header">
      <div className="logo">
        SCD <span className="logo-badge">v2</span>
      </div>
      <div className="header-right">
        <div className={`cowork-status ${coworkConnected ? '' : 'disconnected'}`}>
          <span className="cowork-dot" />
          <span>{coworkConnected ? 'Cowork worker connected' : 'Cowork worker offline'}</span>
        </div>
        <div className="hstat"><strong>{stats.totalClients}</strong> clients</div>
        <span className="hsep">·</span>
        <div className="hstat"><strong>{mrr}</strong> MRR</div>
        <div className="avatar">SG</div>
      </div>
    </div>
  );
}
