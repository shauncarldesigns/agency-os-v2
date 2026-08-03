import type { ProspectResult } from '../../lib/types';
import { ResultRow } from './ResultRow';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';

interface ResultsTableProps {
  results: ProspectResult[];
  addedIds: Set<string>;
  addingIds: Set<string>;
  onAdd: (placeId: string) => void;
  selectedIds: Set<string>;
  onToggle: (placeId: string) => void;
  onSelectAll: () => void;
  onBulkAdd: () => void;
  bulkAdding: boolean;
}

export function ResultsTable({ results, addedIds, addingIds, onAdd, selectedIds, onToggle, onSelectAll, onBulkAdd, bulkAdding }: ResultsTableProps) {
  if (results.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center text-sm text-slate-500">
        No results match the current filter.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
        <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={results.some((result) => !addedIds.has(result.placeId)) && results.filter((result) => !addedIds.has(result.placeId)).every((result) => selectedIds.has(result.placeId))}
            onChange={onSelectAll}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          Select visible
        </label>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500"><strong className="text-slate-800">{selectedIds.size}</strong> selected</span>
          <Button variant="primary" size="sm" disabled={!selectedIds.size || bulkAdding} onClick={onBulkAdd}>
            {bulkAdding ? <><Spinner /> Adding…</> : `Add ${selectedIds.size || ''} to pipeline`}
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
      <table className="min-w-[940px]">
        <thead>
          <tr>
            <th style={{ width: 44 }}></th>
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
              selected={selectedIds.has(r.placeId)}
              onToggle={onToggle}
            />
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
