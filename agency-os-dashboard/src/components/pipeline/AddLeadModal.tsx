import { useState, useEffect, useRef } from 'react';
import type { ProspectResult, ShowToast } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { TierPill } from '../shared/TierPill';
import { formatPhone } from '../../lib/format';

interface AddLeadModalProps {
  open: boolean;
  onClose: () => void;
  showToast: ShowToast;
  onAdded: () => void;
}

const DEBOUNCE_MS = 500;

export function AddLeadModal({ open, onClose, showToast, onAdded }: AddLeadModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProspectResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const lastQueryRef = useRef('');

  // Reset on open/close
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setLoading(false);
      setAdding(null);
      lastQueryRef.current = '';
    }
  }, [open]);

  // Debounced search — split query into "name in city" by looking for 2+ words; otherwise treat whole thing as the name
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (trimmed.length < 3) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      // Heuristic: last word(s) after a comma or "in" → location; rest → industry/name
      let location = '';
      let industry = trimmed;
      const commaIdx = trimmed.lastIndexOf(',');
      const inIdx = trimmed.toLowerCase().lastIndexOf(' in ');
      if (commaIdx > 0) {
        industry = trimmed.slice(0, commaIdx).trim();
        location = trimmed.slice(commaIdx + 1).trim();
      } else if (inIdx > 0) {
        industry = trimmed.slice(0, inIdx).trim();
        location = trimmed.slice(inIdx + 4).trim();
      } else {
        // No location given — try the whole string as text query, with empty location
        // The backend search needs both, so fall back to a heuristic: pull last 2 words as location
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 3) {
          location = parts.slice(-2).join(' ');
          industry = parts.slice(0, -2).join(' ');
        } else {
          location = trimmed;
        }
      }

      if (!industry || !location) {
        setResults([]);
        return;
      }

      lastQueryRef.current = trimmed;
      setLoading(true);
      try {
        const res = await api.prospect.search({ location, industry, radius: 16093 });
        if (lastQueryRef.current === trimmed) {
          setResults(res.results.slice(0, 6));
        }
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : (err as Error).message;
        showToast(`Search failed: ${msg}`, 'error');
        setResults([]);
      } finally {
        if (lastQueryRef.current === trimmed) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, open, showToast]);

  async function handleSelect(r: ProspectResult) {
    if (r.alreadyInPipeline) {
      showToast('Already in pipeline', 'default');
      return;
    }
    setAdding(r.placeId);
    try {
      const res = await api.prospect.addToPipeline([r.placeId]);
      if (res.added > 0) {
        showToast(`Added ${r.name}`, 'success');
        onAdded();
        onClose();
      } else {
        showToast(res.errors[0] ?? 'Could not add (possibly a duplicate)', 'default');
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(`Add failed: ${msg}`, 'error');
    } finally {
      setAdding(null);
    }
  }

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} width={540}>
      <div style={{ padding: '20px 22px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem', letterSpacing: '2px' }}>Add Lead</div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text3)', marginTop: 2 }}>Search Google Places to find and import a business</div>
        </div>
        <button className="mclose" onClick={onClose}>✕</button>
      </div>

      <div style={{ padding: '18px 22px' }}>
        <div style={{ marginBottom: 14 }}>
          <label className="flabel" style={{ marginBottom: 6, display: 'block' }}>Business name + city</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--text3)' }}>🔍</span>
            <input
              type="text"
              className="finput"
              placeholder="e.g. Lakeshore Plumbing in Manitowoc"
              style={{ paddingLeft: 36 }}
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          <div style={{ fontSize: '0.62rem', color: 'var(--text3)', marginTop: 5 }}>
            Both claimed and unclaimed GBP listings show up — unclaimed are highlighted
          </div>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '14px 0', color: 'var(--text3)', fontSize: '0.74rem' }}>
            <Spinner /> Searching Places…
          </div>
        )}

        {!loading && results.length > 0 && (
          <div>
            <div style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 8 }}>
              {results.length} match{results.length === 1 ? '' : 'es'}
            </div>
            {results.map(r => (
              <div
                key={r.placeId}
                className="addlead-result"
                onClick={() => handleSelect(r)}
                style={{
                  background: !r.claimed ? 'rgba(167,139,250,0.04)' : undefined,
                  borderColor: !r.claimed ? 'rgba(167,139,250,0.2)' : undefined,
                  opacity: r.alreadyInPipeline ? 0.55 : adding === r.placeId ? 0.65 : 1,
                  pointerEvents: adding === r.placeId ? 'none' : 'auto',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text)', fontWeight: 500, marginBottom: 2 }}>
                    {r.name}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text3)' }}>
                    {[r.address, formatPhone(r.phone)].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  {r.alreadyInPipeline ? (
                    <span style={{ fontSize: '0.6rem', color: 'var(--text3)' }}>In pipeline</span>
                  ) : (
                    <span className={`gbp-pill ${r.claimed ? 'claimed' : 'unclaimed'}`}>
                      {r.claimed ? '✓ Claimed' : '⭐ Unclaimed'}
                    </span>
                  )}
                  <TierPill tier={r.recommendedTier} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && results.length === 0 && (
          <div style={{ textAlign: 'center', padding: '24px 14px', color: 'var(--text3)' }}>
            <div style={{ fontSize: '1.6rem', opacity: 0.3, marginBottom: 8 }}>🔎</div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text2)', fontWeight: 500, marginBottom: 3 }}>
              {query.trim().length < 3
                ? 'Start typing to search Google Places'
                : 'No matches yet — try refining your search'}
            </div>
            <div style={{ fontSize: '0.62rem', lineHeight: 1.6 }}>
              Lead data, GBP details, and reviews will be imported automatically
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '13px 22px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '0.65rem', color: 'var(--text3)' }}>Can't find them? Add manually after import.</div>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}
