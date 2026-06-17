// usePlaybook — lazily loads scripts + objections-by-category once per
// app session and caches them in module-level state. The calling cockpit
// (Phase 4b) needs these every time it mounts; the content doesn't change
// at runtime, so a single fetch per session is plenty.

import { useEffect, useState } from 'react';
import { api } from './api';
import type { Script, ScriptSummary, ObjectionsByCategory } from './playbook';

interface PlaybookContent {
  scripts: ScriptSummary[];
  defaultScriptId: string | null;
  defaultScript: Script | null;
  objections: ObjectionsByCategory;
}

let cache: PlaybookContent | null = null;
let inflight: Promise<PlaybookContent> | null = null;

async function loadPlaybook(): Promise<PlaybookContent> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const [scriptsResp, objectionsResp] = await Promise.all([
      api.playbook.scripts(),
      api.playbook.objections(),
    ]);
    const defaultScriptId = scriptsResp.scripts.find((s) => s.default)?.id
      ?? scriptsResp.scripts[0]?.id
      ?? null;
    const defaultScript = defaultScriptId
      ? (await api.playbook.script(defaultScriptId)).script
      : null;
    const content: PlaybookContent = {
      scripts: scriptsResp.scripts,
      defaultScriptId,
      defaultScript,
      objections: objectionsResp.by_category,
    };
    cache = content;
    inflight = null;
    return content;
  })();

  return inflight;
}

interface UsePlaybookResult {
  loading: boolean;
  error: Error | null;
  data: PlaybookContent | null;
  reload: () => Promise<void>;
}

export function usePlaybook(): UsePlaybookResult {
  const [data, setData] = useState<PlaybookContent | null>(cache);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    loadPlaybook()
      .then((content) => {
        if (!cancelled) setData(content);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = async () => {
    cache = null;
    inflight = null;
    setLoading(true);
    setError(null);
    try {
      const content = await loadPlaybook();
      setData(content);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, data, reload };
}
