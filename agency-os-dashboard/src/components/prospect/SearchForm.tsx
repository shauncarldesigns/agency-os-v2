import { useState } from 'react';
import { Spinner } from '../shared/Spinner';
import { Building2, MapPin, Search, SlidersHorizontal } from 'lucide-react';

export interface SearchInput {
  location: string;
  industry: string;
  radius: number;
  noWebsiteOnly: boolean;
}

interface SearchFormProps {
  onSearch: (input: SearchInput) => Promise<void>;
  loading: boolean;
}

const RADIUS_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '10 mi', value: 16093 },
  { label: '25 mi', value: 40234 },
  { label: '50 mi', value: 80467 },
];

export function SearchForm({ onSearch, loading }: SearchFormProps) {
  const [location, setLocation] = useState('Green Bay, WI');
  const [industry, setIndustry] = useState('');
  const [radius, setRadius] = useState<number>(40234); // 25 mi default
  const [noWebsiteOnly, setNoWebsiteOnly] = useState<boolean>(true);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!location.trim() || !industry.trim() || loading) return;
    onSearch({ location: location.trim(), industry: industry.trim(), radius, noWebsiteOnly });
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Search size={18} /></span>
        <div><h2 className="text-base font-semibold text-slate-950">Find local businesses</h2><p className="text-xs text-slate-500">Search Google Places and score new opportunities.</p></div>
      </div>
      <form className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_150px_auto] lg:items-end" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600">Location</span>
          <span className="relative block"><MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <input
            className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            type="text"
            value={location}
            onChange={e => setLocation(e.target.value)}
            placeholder="City, State"
          />
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600">Industry or trade</span>
          <span className="relative block"><Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <input
            className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            type="text"
            value={industry}
            onChange={e => setIndustry(e.target.value)}
            placeholder="plumber, roofer, electrician..."
          />
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600">Search radius</span>
          <span className="relative block"><SlidersHorizontal className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <select className="h-10 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" value={radius} onChange={e => setRadius(parseInt(e.target.value, 10))}>
            {RADIUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          </span>
        </label>
        <button className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={loading || !industry.trim()}>
          {loading ? <><Spinner /> Searching…</> : <><Search size={15} /> Search</>}
        </button>
      </form>
      <label
        className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
      >
        <input
          type="checkbox"
          checked={noWebsiteOnly}
          onChange={(e) => setNoWebsiteOnly(e.target.checked)}
          disabled={loading}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
        />
        <span><span className="block text-sm font-medium text-slate-700">Only businesses without a website</span><span className="mt-0.5 block text-xs text-slate-500">Searches up to 60 candidates to produce a useful filtered list.</span></span>
      </label>
    </section>
  );
}
