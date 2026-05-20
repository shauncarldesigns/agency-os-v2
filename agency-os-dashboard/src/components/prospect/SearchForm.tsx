import { useState } from 'react';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';

interface SearchFormProps {
  onSearch: (input: { location: string; industry: string; radius: number }) => Promise<void>;
  loading: boolean;
}

const RADIUS_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '10 mi', value: 16093 },
  { label: '25 mi', value: 40234 },
  { label: '50 mi', value: 80467 },
];

export function SearchForm({ onSearch, loading }: SearchFormProps) {
  const [location, setLocation] = useState('Manitowoc, WI');
  const [industry, setIndustry] = useState('');
  const [radius, setRadius] = useState<number>(40234); // 25 mi default

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!location.trim() || !industry.trim() || loading) return;
    onSearch({ location: location.trim(), industry: industry.trim(), radius });
  }

  return (
    <div className="search-card">
      <h3>SEARCH BUSINESSES</h3>
      <form className="search-form" onSubmit={handleSubmit}>
        <div className="fg">
          <label className="flabel">Location</label>
          <input
            className="finput"
            type="text"
            value={location}
            onChange={e => setLocation(e.target.value)}
            placeholder="City, State"
          />
        </div>
        <div className="fg">
          <label className="flabel">Industry / Type</label>
          <input
            className="finput"
            type="text"
            value={industry}
            onChange={e => setIndustry(e.target.value)}
            placeholder="plumber, roofer, electrician..."
          />
        </div>
        <div className="fg">
          <label className="flabel">Radius</label>
          <select className="finput" value={radius} onChange={e => setRadius(parseInt(e.target.value, 10))}>
            {RADIUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <Button variant="primary" type="submit" disabled={loading || !industry.trim()}>
          {loading ? <><Spinner /> Searching…</> : <>🔍 Search</>}
        </Button>
      </form>
    </div>
  );
}
