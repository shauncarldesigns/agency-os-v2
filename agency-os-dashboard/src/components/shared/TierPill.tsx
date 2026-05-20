interface TierPillProps {
  tier: 1 | 2 | 3;
  label?: string;
}

export function TierPill({ tier, label }: TierPillProps) {
  return (
    <span className={`tier-pill t${tier}`}>
      <span className="tier-icon" />
      {label ?? `Tier ${tier}`}
    </span>
  );
}
