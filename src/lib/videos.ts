import type { Exercise } from '../db/schema';
import { SUGGESTED_VIDEOS } from '../data/videos';

const isVideo = (url: string): boolean => /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/i.test(hostOf(url));

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** Only web addresses are kept, so a stray note in the field never becomes a link. */
export function cleanUrl(raw?: string): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  return hostOf(url).includes('.') ? url : undefined;
}

const key = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const SUGGESTED = new Map(Object.entries(SUGGESTED_VIDEOS).map(([name, url]) => [key(name), url]));

/**
 * The video to show for an exercise: the one saved on it, else a video among its links,
 * else the suggestion that ships with the app for that exercise name.
 */
export function videoFor(e: Pick<Exercise, 'name' | 'video' | 'links'>): string | undefined {
  return e.video ?? e.links.find((l) => isVideo(l.url))?.url ?? SUGGESTED.get(key(e.name));
}

/** A search to run when there is no video yet. */
export const videoSearchUrl = (name: string): string =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} technique`)}`;
