import type { ProspectResult } from '../../lib/types';
import { ResultRow } from './ResultRow';

interface ResultsTableProps {
  results: ProspectResult[];
  addedIds: Set<string>;
  addingIds: Set<string>;
  onAdd: (placeId: string) => void;
}

export function ResultsTable({ results, addedIds, addingIds, onAdd }: ResultsTableProps) {
  if (results.length === 0) {
    return (
      <div className="twrap" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text3)' }}>
        No results match the current filter.
      </div>
    );
  }

  return (
    <div className="twrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: 32 }}></th>
            <th>Business</th>
            <th>Score</th>
            <th>Tier</th>
            <th>GBP Status</th>
            <th>Website</th>
            <th>Reviews</th>
            <th style={{ width: 140 }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {results.map(r => (
            <ResultRow
              key={r.placeId}
              result={r}
              added={addedIds.has(r.placeId)}
              adding={addingIds.has(r.placeId)}
              onAdd={onAdd}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
