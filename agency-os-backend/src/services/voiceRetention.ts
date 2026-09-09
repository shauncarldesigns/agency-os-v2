export async function purgeExpiredVoiceContent(db: D1Database): Promise<number> {
  const result = await db.prepare(`
    UPDATE voice_calls
       SET transcript = NULL,
           recording_url = NULL,
           raw_metadata_json = '{"retention":"expired"}',
           updated_at = datetime('now')
     WHERE ended_at IS NOT NULL
       AND datetime(ended_at) < datetime(
         'now',
         '-' || COALESCE(
           (SELECT recording_retention_days FROM voice_business_profiles p WHERE p.id = voice_calls.voice_business_profile_id),
           30
         ) || ' days'
       )
       AND (transcript IS NOT NULL OR recording_url IS NOT NULL)
  `).run();
  return result.meta.changes ?? 0;
}

export async function voiceRetentionStatus(db: D1Database): Promise<{ retainedCalls: number; expiredPendingPurge: number; nextExpirationAt: string | null }> {
  const row = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transcript IS NOT NULL OR recording_url IS NOT NULL THEN 1 ELSE 0 END), 0) AS retained_calls,
      COALESCE(SUM(CASE WHEN (transcript IS NOT NULL OR recording_url IS NOT NULL)
        AND datetime(ended_at) < datetime('now', '-' || COALESCE((SELECT recording_retention_days FROM voice_business_profiles p WHERE p.id=voice_calls.voice_business_profile_id), 30) || ' days') THEN 1 ELSE 0 END), 0) AS expired_pending_purge,
      MIN(CASE WHEN transcript IS NOT NULL OR recording_url IS NOT NULL THEN datetime(ended_at, '+' || COALESCE((SELECT recording_retention_days FROM voice_business_profiles p WHERE p.id=voice_calls.voice_business_profile_id), 30) || ' days') END) AS next_expiration_at
    FROM voice_calls WHERE ended_at IS NOT NULL
  `).first<{ retained_calls: number; expired_pending_purge: number; next_expiration_at: string | null }>();
  return { retainedCalls: Number(row?.retained_calls ?? 0), expiredPendingPurge: Number(row?.expired_pending_purge ?? 0), nextExpirationAt: row?.next_expiration_at ?? null };
}
