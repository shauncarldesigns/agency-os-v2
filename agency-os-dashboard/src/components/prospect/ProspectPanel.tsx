import { useState, useMemo } from 'react';
import type { ProspectResult, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { SearchForm, type SearchInput } from './SearchForm';
import { ResultsTable } from './ResultsTable';
import { FilterPills, type ProspectFilter, type SortBy } from './FilterPills';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';

interface ProspectPanelProps {
  showToast: ShowToast;
  onLeadAdded?: () => void;
}

export function ProspectPanel({ showToast, onLeadAdded }: ProspectPanelProps) {
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [results, setResults] = useState<ProspectResult[]>([]);
  const [lastSearch, setLastSearch] = useState<SearchInput | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [filter, setFilter] = useState<ProspectFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('score');
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());

  async function handleSearch(input: SearchInput) {
    setSearching(true);
    try {
      // When the "no website only" checkbox is on, most candidates will be
      // filtered out — auto-fetch all 3 pages so the operator sees a useful
      // count without having to click Load More repeatedly.
      const maxPages = input.noWebsiteOnly ? 3 : 1;
      const res = await api.prospect.search({
        location: input.location,
        industry: input.industry,
        radius: input.radius,
        maxPages,
      });
      setResults(res.results);
      setHasSearched(true);
      setAddedIds(new Set());
      setLastSearch(input);
      setNextPageToken(res.nextPageToken);
      // Auto-apply the no-website pill so the operator sees only the target audience.
      setFilter(input.noWebsiteOnly ? 'no-website' : 'all');
      const newCount = res.results.filter(r => !r.alreadyInPipeline).length;
      const dupCount = res.total - newCount;
      const noWebsiteCount = res.results.filter(r => !r.website && !r.alreadyInPipeline).length;
      const summary = input.noWebsiteOnly
        ? `Found ${res.total} candidate${res.total === 1 ? '' : 's'} · ${noWebsiteCount} without a website`
        : `Found ${res.total} result${res.total === 1 ? '' : 's'}${dupCount > 0 ? ` · ${dupCount} already in pipeline` : ''}${res.nextPageToken ? ' · more available' : ''}`;
      showToast(summary, res.total > 0 ? 'success' : 'default');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Search failed: ${msg}`, 'error');
    } finally {
      setSearching(false);
    }
  }

  async function handleLoadMore() {
    if (!lastSearch || !nextPageToken) return;
    setLoadingMore(true);
    try {
      const res = await api.prospect.search({
        location: lastSearch.location,
        industry: lastSearch.industry,
        radius: lastSearch.radius,
        pageToken: nextPageToken,
        maxPages: 1,
      });
      // Dedupe by placeId in case Google returns overlaps.
      const seen = new Set(results.map(r => r.placeId));
      const merged = [...results, ...res.results.filter(r => !seen.has(r.placeId))];
      setResults(merged);
      setNextPageToken(res.nextPageToken);
      showToast(`+${res.results.length} more${res.nextPageToken ? ' · more available' : ' · end of results'}`, 'success');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Load more failed: ${msg}`, 'error');
    } finally {
      setLoadingMore(false);
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
          {(nextPageToken || loadingMore) && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '14px 0 8px' }}>
              <Button variant="ghost" size="sm" disabled={loadingMore} onClick={handleLoadMore}>
                {loadingMore ? <><Spinner /> Loading more…</> : `Load more results · ${results.length} so far`}
              </Button>
            </div>
          )}
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
