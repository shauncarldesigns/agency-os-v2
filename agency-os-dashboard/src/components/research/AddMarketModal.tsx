import { useState } from 'react';
import { X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { ShowToast } from '../../lib/types';
import { Spinner } from '../shared/Spinner';

// Mirrors the server-curated home-services list in routes/settings.ts.
const INDUSTRIES = [
  'Plumbing', 'HVAC', 'Electrical', 'Roofing', 'General Contracting',
  'Landscaping', 'Painting', 'Flooring', 'Concrete and Masonry', 'Siding',
  'Gutters', 'Garage Doors', 'Fencing', 'Remodeling',
  'Kitchen and Bathroom Remodeling', 'Water Damage Restoration',
  'Pest Control', 'Tree Services', 'Septic Services', 'Drain and Sewer Services',
];

interface AddMarketModalProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  showToast: ShowToast;
}

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100';

export function AddMarketModal({ open, onClose, onAdded, showToast }: AddMarketModalProps) {
  const [industry, setIndustry] = useState(INDUSTRIES[0]);
  const [locationLabel, setLocationLabel] = useState('');
  const [geoTargetId, setGeoTargetId] = useState('');
  const [coords, setCoords] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  async function save() {
    // "44.5133, -88.0133" — the format Google Maps copies on right-click.
    const match = coords.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) {
      showToast('Coordinates must be "latitude, longitude" — right-click the city center in Google Maps to copy them', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.research.addMarket({
        industry,
        location_label: locationLabel.trim(),
        geo_target_id: geoTargetId.trim(),
        latitude: Number(match[1]),
        longitude: Number(match[2]),
      });
      showToast(`Added ${industry} × ${locationLabel.trim()}`, 'success');
      setLocationLabel(''); setGeoTargetId(''); setCoords('');
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
      <div className="m-auto w-[min(520px,94vw)] overflow-hidden rounded-2xl bg-white shadow-2xl">
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
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-600">Location</span>
            <input value={locationLabel} onChange={e => setLocationLabel(e.target.value)} placeholder="Green Bay, WI" className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-600">Google Ads geo target ID</span>
            <input value={geoTargetId} onChange={e => setGeoTargetId(e.target.value)} placeholder="e.g. 1018429" inputMode="numeric" className={inputClass} />
            <span className="mt-1.5 block text-[11px] leading-4 text-slate-400">
              The city's numeric criteria ID from Google's{' '}
              <a href="https://developers.google.com/google-ads/api/data/geotargets" target="_blank" rel="noreferrer" className="font-semibold text-blue-600 hover:underline">geo targets list</a>
              . Search the CSV for the city name and use the Criteria ID column.
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-600">City-center coordinates</span>
            <input value={coords} onChange={e => setCoords(e.target.value)} placeholder="44.5133, -88.0133" className={inputClass} />
            <span className="mt-1.5 block text-[11px] leading-4 text-slate-400">
              Right-click the city center in Google Maps and click the coordinates to copy them. Map pack scrapes are anchored here — “near me” results are worthless without a real location.
            </span>
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
          <button onClick={onClose} className="rounded-xl px-3.5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button
            onClick={() => void save()}
            disabled={saving || !locationLabel.trim() || !/^\d+$/.test(geoTargetId.trim()) || !coords.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving && <Spinner />} {saving ? 'Adding…' : 'Add market'}
          </button>
        </div>
      </div>
    </div>
  );
}
