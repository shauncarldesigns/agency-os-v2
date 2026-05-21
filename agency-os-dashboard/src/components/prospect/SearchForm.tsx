import { useState } from 'react';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';

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
  const [noWebsiteOnly, setNoWebsiteOnly] = useState<boolean>(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!location.trim() || !industry.trim() || loading) return;
    onSearch({ location: location.trim(), industry: industry.trim(), radius, noWebsiteOnly });
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
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          marginTop: 10,
          fontSize: '0.72rem',
          color: 'var(--text2)',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={noWebsiteOnly}
          onChange={(e) => setNoWebsiteOnly(e.target.checked)}
          disabled={loading}
        />
        🚫 Only businesses <strong>without a website</strong>
        <span style={{ fontSize: '0.62rem', color: 'var(--text3)', marginLeft: 4 }}>
          (pulls up to 60 candidates so the filter has results to work with)
        </span>
      </label>
    </div>
  );
}
