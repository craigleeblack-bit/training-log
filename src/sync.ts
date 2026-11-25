/**
 * Sync between devices is optional, and off unless this copy of the app was built with the
 * address of a Dexie Cloud database (VITE_SYNC_URL in the .env file; see the README).
 * The address is not a secret: it only says where signed-in users' data is kept.
 */
const raw = (import.meta.env?.VITE_SYNC_URL as string | undefined)?.trim();

export const SYNC_URL: string | undefined = raw && /^https:\/\/[\w-]+\.dexie\.cloud\/?$/.test(raw) ? raw.replace(/\/$/, '') : undefined;
