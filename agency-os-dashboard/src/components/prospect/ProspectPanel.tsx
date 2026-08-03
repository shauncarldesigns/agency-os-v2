import { useState, useMemo, useCallback, useEffect } from 'react';
import type { ProspectCandidate, ProspectInboxSummary, ProspectResult, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { SearchForm, type SearchInput } from './SearchForm';
import { ResultsTable } from './ResultsTable';
import { FilterPills, type ProspectFilter, type SortBy } from './FilterPills';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { Search, Sparkles } from 'lucide-react';
import { CandidateInbox } from './CandidateInbox';

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
  const [candidates, setCandidates] = useState<ProspectCandidate[]>([]);
  const [inboxSummary, setInboxSummary] = useState<ProspectInboxSummary | null>(null);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [runningDiscovery, setRunningDiscovery] = useState(false);
  const [inboxActing, setInboxActing] = useState(false);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set());

  const loadInbox = useCallback(async () => {
    setInboxLoading(true);
    try {
      const [candidateResponse, summaryResponse] = await Promise.all([
        api.prospect.candidates(),
        api.prospect.inboxSummary(),
      ]);
      setCandidates(candidateResponse.candidates);
      setInboxSummary(summaryResponse);
      setSelectedCandidates((previous) => new Set([...previous].filter((id) => candidateResponse.candidates.some((candidate) => candidate.id === id))));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Could not load prospect inbox: ${msg}`, 'error');
    } finally {
      setInboxLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void loadInbox(); }, [loadInbox]);

  async function handleRunDiscovery() {
    setRunningDiscovery(true);
    try {
      const result = await api.prospect.runDiscovery();
      const message = result.reason === 'inbox_limit'
        ? 'Inbox is at its configured limit. Review candidates before searching again.'
        : `Discovery complete · ${result.newCandidates} new · ${result.refreshedCandidates} refreshed`;
      showToast(message, result.reason ? 'default' : 'success');
      await loadInbox();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Discovery failed: ${msg}`, 'error');
    } finally {
      setRunningDiscovery(false);
    }
  }

  function toggleCandidate(id: number) {
    setSelectedCandidates((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else if (next.size < 25) next.add(id);
      return next;
    });
  }

  function selectAllCandidates() {
    const selectable = candidates.slice(0, 25).map((candidate) => candidate.id);
    const allSelected = selectable.every((id) => selectedCandidates.has(id));
    setSelectedCandidates(allSelected ? new Set() : new Set(selectable));
  }

  async function handleCandidateAction(action: 'approve' | 'reject') {
    const ids = [...selectedCandidates].slice(0, 25);
    if (!ids.length) return;
    setInboxActing(true);
    try {
      if (action === 'approve') {
        const result = await api.prospect.approveCandidates(ids);
        showToast(`${result.added} lead${result.added === 1 ? '' : 's'} added to the pipeline${result.skipped ? ` · ${result.skipped} skipped` : ''}`, result.added ? 'success' : 'default');
        if (result.errors.length) showToast(result.errors[0], 'error');
        if (result.added) onLeadAdded?.();
      } else {
        const result = await api.prospect.rejectCandidates(ids);
        showToast(`${result.rejected} candidate${result.rejected === 1 ? '' : 's'} rejected`, 'success');
      }
      setSelectedCandidates(new Set());
      await loadInbox();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`${action === 'approve' ? 'Approval' : 'Rejection'} failed: ${msg}`, 'error');
    } finally {
      setInboxActing(false);
    }
  }

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
      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><Sparkles size={19} /></span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-950">Lead Finder</h1>
            <p className="mt-0.5 text-sm text-slate-500">Discover local businesses and prioritize the strongest opportunities.</p>
          </div>
        </div>
      </section>

      <SearchForm onSearch={handleSearch} loading={searching} />

      <CandidateInbox
        candidates={candidates}
        summary={inboxSummary}
        loading={inboxLoading}
        running={runningDiscovery}
        acting={inboxActing}
        selected={selectedCandidates}
        onToggle={toggleCandidate}
        onSelectAll={selectAllCandidates}
        onRun={handleRunDiscovery}
        onApprove={() => void handleCandidateAction('approve')}
        onReject={() => void handleCandidateAction('reject')}
        onRefresh={() => void loadInbox()}
      />

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
            <div className="flex justify-center py-4">
              <Button variant="ghost" size="sm" disabled={loadingMore} onClick={handleLoadMore}>
                {loadingMore ? <><Spinner /> Loading more…</> : `Load more results · ${results.length} so far`}
              </Button>
            </div>
          )}
        </>
      )}

      {!hasSearched && (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Search size={22} /></span>
          <h2 className="mt-4 text-sm font-semibold text-slate-800">Need a one-off search?</h2>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">Use the search form above for a specific trade or location. Scheduled discovery results appear in the prospect inbox.</p>
        </div>
      )}
    </>
  );
}
