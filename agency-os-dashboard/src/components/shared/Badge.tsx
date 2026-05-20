import type { ReactNode } from 'react';

type BadgeColor = 'green' | 'yellow' | 'red' | 'blue' | 'gray' | 'tier1' | 'tier2' | 'tier3';

export function Badge({ color = 'gray', children }: { color?: BadgeColor; children: ReactNode }) {
  return <span className={`badge badge-${color}`}>{children}</span>;
}
