const STORAGE_PREFIX = 'r2://';
const PUBLIC_R2_HOST_SUFFIX = '.r2.dev';
const AUTHENTICATED_PATH = '/api/recordings/file/';

function safeRecordingKey(value: string): string | null {
  const key = value.replace(/^\/+/, '');
  if (!key.startsWith('calls/') || key.includes('..') || key.includes('\\')) return null;
  return key;
}

export function recordingKeyFromValue(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith(STORAGE_PREFIX)) return safeRecordingKey(value.slice(STORAGE_PREFIX.length));
  try {
    const url = new URL(value);
    if (url.pathname.startsWith(AUTHENTICATED_PATH)) {
      return safeRecordingKey(decodeURIComponent(url.pathname.slice(AUTHENTICATED_PATH.length)));
    }
    if (url.hostname.endsWith(PUBLIC_R2_HOST_SUFFIX)) {
      return safeRecordingKey(decodeURIComponent(url.pathname));
    }
  } catch {
    return safeRecordingKey(value);
  }
  return null;
}

export function recordingStorageRef(key: string): string {
  const safeKey = safeRecordingKey(key);
  if (!safeKey) throw new Error('Invalid recording key');
  return `${STORAGE_PREFIX}${safeKey}`;
}

export function authenticatedRecordingUrl(requestUrl: string, key: string): string {
  const safeKey = safeRecordingKey(key);
  if (!safeKey) throw new Error('Invalid recording key');
  const encoded = safeKey.split('/').map(encodeURIComponent).join('/');
  return `${new URL(requestUrl).origin}${AUTHENTICATED_PATH}${encoded}`;
}

export function recordingResponseUrl(requestUrl: string, stored: string | null): string | null {
  if (!stored) return null;
  const key = recordingKeyFromValue(stored);
  return key ? authenticatedRecordingUrl(requestUrl, key) : stored;
}

export function normalizeRecordingStorageValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = recordingKeyFromValue(value);
  return key ? recordingStorageRef(key) : null;
}
