import { useState, useMemo } from 'react';
import type { ProspectResult, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { SearchForm } from './SearchForm';
import { ResultsTable } from './ResultsTable';
import { FilterPills, type ProspectFilter, type SortBy } from './FilterPills';

interface ProspectPanelProps {
  showToast: ShowToast;
  onLeadAdded?: () => void;
}

export function ProspectPanel({ showToast, onLeadAdded }: ProspectPanelProps) {
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ProspectResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [filter, setFilter] = useState<ProspectFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('score');
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());

  async function handleSearch(input: { location: string; industry: string; radius: number }) {
    setSearching(true);
    try {
      const res = await api.prospect.search(input);
      setResults(res.results);
      setHasSearched(true);
      setAddedIds(new Set());
      const newCount = res.results.filter(r => !r.alreadyInPipeline).length;
      const dupCount = res.total - newCount;
      showToast(
        `Found ${res.total} result${res.total === 1 ? '' : 's'}${dupCount > 0 ? ` · ${dupCount} already in pipeline` : ''}`,
        res.total > 0 ? 'success' : 'default',
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Search failed: ${msg}`, 'error');
    } finally {
      setSearching(false);
    }
  }

  async function handleAdd(placeId: string) {
    setAddingIds(prev => new Set(prev).add(placeId));
    try {
      const res = await api.prospect.addToPipeline([placeId]);
      if (res.added > 0) {
        setAddedIds(prev => new Set(prev).add(placeId));
        showToast('Added to pipeline', 'success');
        onLeadAdded?.();
      } else {
        showToast(res.errors[0] ?? 'Could not add (possibly a duplicate)', 'default');
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Add failed: ${msg}`, 'error');
    } finally {
      setAddingIds(prev => { const next = new Set(prev); next.delete(placeId); return next; });
    }
  }

  const visible = useMemo(() => {
    let list = results.filter(r => !r.alreadyInPipeline);
    switch (filter) {
      case 't3': list = list.filter(r => r.recommendedTier === 3); break;
      case 't2': list = list.filter(r => r.recommendedTier === 2); break;
      case 't1': list = list.filter(r => r.recommendedTier === 1); break;
      case 'unclaimed': list = list.filter(r => !r.claimed); break;
      case 'no-website': list = list.filter(r => !r.website); break;
    }
    switch (sortBy) {
      case 'score': list = [...list].sort((a, b) => b.opportunityScore - a.opportunityScore); break;
      case 'reviews': list = [...list].sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0)); break;
      case 'pagespeed': list = [...list].sort((a, b) => (a.website ? 1 : 0) - (b.website ? 1 : 0)); break;
    }
    return list;
  }, [results, filter, sortBy]);

  const inPipelineCount = results.filter(r => r.alreadyInPipeline).length;

  return (
    <>
      <div className="sec-header">
        <div>
          <div className="sec-title">Prospect</div>
          <div className="sec-sub">
            Search Google Places — auto-scored by website quality, GBP completeness, and review activity
          </div>
        </div>
      </div>

      <SearchForm onSearch={handleSearch} loading={searching} />

      {hasSearched && (
        <>
          <FilterPills
            results={results}
            active={filter}
            onChange={setFilter}
            filteredCount={visible.length}
            inPipelineCount={inPipelineCount}
            sortBy={sortBy}
            onSortChange={setSortBy}
          />
          <ResultsTable
            results={visible}
            addedIds={addedIds}
            addingIds={addingIds}
            onAdd={handleAdd}
          />
        </>
      )}

      {!hasSearched && (
        <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text3)' }}>
          <div style={{ fontSize: '2.4rem', opacity: 0.2, marginBottom: 14 }}>🔍</div>
          <div style={{ fontSize: '0.86rem', color: 'var(--text2)', fontWeight: 500, marginBottom: 5 }}>
            Search for new leads
          </div>
          <div style={{ fontSize: '0.7rem', lineHeight: 1.7 }}>
            Each result is auto-scored 0–100 based on website quality, GBP completeness, and review activity.<br />
            Color-coded by recommended pricing tier.
          </div>
        </div>
      )}
    </>
  );
}
