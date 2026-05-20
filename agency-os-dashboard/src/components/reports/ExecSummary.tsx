interface ExecSummaryProps {
  businessName: string;
  period: string; // already formatted ("April 2026")
  text: string | null | undefined;
  loading?: boolean;
  onRegenerate?: () => void;
  regenerating?: boolean;
}

export function ExecSummary({ businessName, period, text, loading, onRegenerate, regenerating }: ExecSummaryProps) {
  const empty = !text || !text.trim();

  return (
    <div style={{
      background: 'linear-gradient(135deg, var(--tier3-bg), rgba(167,139,250,0.04))',
      border: '1px solid rgba(167,139,250,0.25)',
      borderRadius: 'var(--rl)',
      padding: '18px 20px',
      marginBottom: 18,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 10 }}>
        <div style={{
          fontSize: '0.6rem', fontWeight: 600, letterSpacing: '1.5px',
          textTransform: 'uppercase', color: 'var(--tier3)',
        }}>
          📊 Executive Summary — {businessName} · {period}
        </div>
        {onRegenerate && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={onRegenerate}
            disabled={regenerating || loading}
            style={{ flexShrink: 0 }}
          >
            {regenerating ? '⏳ …' : empty ? '✦ Generate' : '↻ Regenerate'}
          </button>
        )}
      </div>
      <div style={{ fontSize: '0.88rem', color: 'var(--text)', lineHeight: 1.7 }}>
        {loading
          ? <em style={{ color: 'var(--text3)' }}>Loading…</em>
          : empty
            ? <em style={{ color: 'var(--text3)' }}>No summary yet — click Generate to have Claude write one from this period's data.</em>
            : text}
      </div>
    </div>
  );
}
