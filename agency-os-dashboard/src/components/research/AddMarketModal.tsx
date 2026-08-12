import { useEffect, useRef, useState } from 'react';
import { X, MapPin, Check } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { ShowToast } from '../../lib/types';
import { Spinner } from '../shared/Spinner';

// The home-services list from routes/settings.ts, plus research-only
// industries (markets aren't limited to the Lead Finder discovery set).
// Keep in sync with DEFAULTS.research.industryTerms so each entry expands
// with the right customer search term.
const INDUSTRIES = [
  'Plumbing', 'HVAC', 'Electrical', 'Roofing', 'General Contracting',
  'Landscaping', 'Painting', 'Flooring', 'Concrete and Masonry', 'Siding',
  'Gutters', 'Garage Doors', 'Fencing', 'Remodeling',
  'Kitchen and Bathroom Remodeling', 'Water Damage Restoration',
  'Pest Control', 'Tree Services', 'Septic Services', 'Drain and Sewer Services',
  'Collision Repair',
];

interface CityOption {
  criteria_id: string;
  name: string;
  canonical_name: string;
  state: string;
}

interface AddMarketModalProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  showToast: ShowToast;
}

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100';

/**
 * Industry + city, nothing else. Cities come from the seeded Wisconsin geo
 * target lookup (Google's geotargets CSV), which carries the criteria ID;
 * coordinates are resolved server-side. The operator never sees an ID.
 */
export function AddMarketModal({ open, onClose, onAdded, showToast }: AddMarketModalProps) {
  const [industry, setIndustry] = useState(INDUSTRIES[0]);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<CityOption[]>([]);
  const [selected, setSelected] = useState<CityOption | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    if (selected && query === `${selected.name}, ${selected.state}`) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setOptions([]); return; }
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.research.geoTargets(q);
        setOptions(res.targets);
      } catch {
        setOptions([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [query, open, selected]);

  if (!open) return null;

  function pick(option: CityOption) {
    setSelected(option);
    setQuery(`${option.name}, ${option.state}`);
    setOptions([]);
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    try {
      await api.research.addMarket({ industry, geo_target_id: selected.criteria_id });
      showToast(`Added ${industry} × ${selected.name}, ${selected.state}`, 'success');
      setQuery(''); setSelected(null); setOptions([]);
      onAdded();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex bg-slate-950/45 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="m-auto w-[min(480px,94vw)] overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-sm font-bold text-slate-900">Add a market</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 px-5 py-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-600">Industry</span>
            <select value={industry} onChange={e => setIndustry(e.target.value)} className={inputClass}>
              {INDUSTRIES.map(item => <option key={item}>{item}</option>)}
            </select>
          </label>
          <div className="relative">
            <span className="mb-1.5 block text-xs font-semibold text-slate-600">City</span>
            <div className="relative">
              <input
                value={query}
                onChange={e => { setQuery(e.target.value); setSelected(null); }}
                placeholder="Start typing a Wisconsin city…"
                className={`${inputClass} pr-9`}
                autoFocus
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                {searching ? <Spinner /> : selected ? <Check className="h-4 w-4 text-emerald-500" /> : <MapPin className="h-4 w-4" />}
              </span>
            </div>
            {options.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                {options.map(option => (
                  <li key={option.criteria_id}>
                    <button
                      type="button"
                      onClick={() => pick(option)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-blue-50"
                    >
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="font-medium">{option.name}</span>
                      <span className="text-xs text-slate-400">{option.state}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <span className="mt-1.5 block text-[11px] leading-4 text-slate-400">
              Search volume is scoped to this city and the map pack is captured at its center — both resolved automatically.
            </span>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
          <button onClick={onClose} className="rounded-xl px-3.5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button
            onClick={() => void save()}
            disabled={saving || !selected}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving && <Spinner />} {saving ? 'Adding…' : 'Add market'}
          </button>
        </div>
      </div>
    </div>
  );
}
