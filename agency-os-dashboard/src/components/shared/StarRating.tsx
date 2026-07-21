import { Star } from 'lucide-react';

// Five-star strip with fractional fill: a slate outline row underneath and
// an amber filled row clipped to (rating / 5) width on top — so 4.6 renders
// four full stars and a 60%-filled fifth instead of a lone ★ glyph.
export function StarRating({ rating, size = 3 }: { rating: number; size?: 3 | 3.5 | 4 }) {
  const pct = Math.max(0, Math.min(100, (rating / 5) * 100));
  const cls = size === 4 ? 'h-4 w-4' : size === 3.5 ? 'h-3.5 w-3.5' : 'h-3 w-3';
  return (
    <span className="relative inline-flex shrink-0 align-middle" aria-label={`${rating} out of 5 stars`}>
      <span className="flex text-slate-300">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} className={`${cls} shrink-0`} />
        ))}
      </span>
      <span
        className="absolute inset-y-0 left-0 flex overflow-hidden text-amber-400"
        style={{ width: `${pct}%` }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} className={`${cls} shrink-0 fill-amber-400`} />
        ))}
      </span>
    </span>
  );
}
