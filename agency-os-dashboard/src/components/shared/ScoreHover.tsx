import { useState, useRef, useEffect } from 'react';

interface ScoreHoverProps {
  score: number;
  /** Joined factor string from calculateOpportunityScore — "·"-separated. */
  reasoning: string | null;
  color?: string;
  /** Optional summary line shown above the bullet list (e.g. "Tier 3 · enriched 2026-05-21"). */
  meta?: string;
}

/**
 * Renders a score number with a hover popover that breaks down which factors
 * contributed to the score. The reasoning text comes from
 * calculateOpportunityScore().factors.join(' · ') — we split it back into
 * bullet points here for readability.
 */
export function ScoreHover({ score, reasoning, color, meta }: ScoreHoverProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Anchor below-right of the score number, clamped to the viewport
    const popoverWidth = 320;
    const left = Math.min(window.innerWidth - popoverWidth - 12, r.left + 8);
    setPosition({ top: r.bottom + 6, left });
  }, [open]);

  const bullets = (reasoning ?? '').split('·').map((s) => s.trim()).filter(Boolean);

  return (
    <span
      ref={wrapRef}
      style={{ display: 'inline-block', position: 'relative', cursor: bullets.length > 0 ? 'help' : 'default' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="score-num" style={{ color: color ?? 'var(--text2)' }}>
        {score}
      </span>
      {open && bullets.length > 0 && position && (
        <span
          style={{
            position: 'fixed',
            top: position.top,
            left: position.left,
            width: 320,
            background: 'var(--surface)',
            border: '1px solid var(--border2)',
            borderRadius: 'var(--r)',
            padding: '10px 12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            zIndex: 1000,
            fontSize: '0.72rem',
            color: 'var(--text2)',
            lineHeight: 1.5,
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
            Score breakdown · {score}/100
          </div>
          {meta && (
            <div style={{ fontSize: '0.62rem', color: 'var(--text3)', marginBottom: 6 }}>{meta}</div>
          )}
          <ul style={{ margin: 0, paddingLeft: 14, listStyle: 'disc' }}>
            {bullets.map((b, i) => (
              <li key={i} style={{ marginBottom: 2 }}>{b}</li>
            ))}
          </ul>
        </span>
      )}
    </span>
  );
}
