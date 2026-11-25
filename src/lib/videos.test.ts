import { describe, expect, it } from 'vitest';
import { SUGGESTED_VIDEOS } from '../data/videos';
import { cleanUrl, videoFor, videoSearchUrl } from './videos';
import { canRedraw, linearFormat, linkIn } from './scan';

describe('exercise videos', () => {
  it('prefers the saved video, then a video link, then the suggestion for the name', () => {
    const base = { name: 'Goblet squat', links: [] };
    expect(videoFor(base)).toBe(SUGGESTED_VIDEOS['Goblet squat']);
    expect(videoFor({ ...base, name: 'goblet  SQUAT!' })).toBe(SUGGESTED_VIDEOS['Goblet squat']);
    const linked = { ...base, links: [{ label: 'Article', url: 'https://example.com/a' }, { label: 'Clip', url: 'https://youtu.be/abc' }] };
    expect(videoFor(linked)).toBe('https://youtu.be/abc');
    expect(videoFor({ ...linked, video: 'https://vimeo.com/1' })).toBe('https://vimeo.com/1');
    expect(videoFor({ name: 'Something of my own', links: [] })).toBeUndefined();
  });

  it('only suggests YouTube watch links', () => {
    for (const url of Object.values(SUGGESTED_VIDEOS)) expect(url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/);
  });

  it('cleans typed links and builds a search', () => {
    expect(cleanUrl(' youtube.com/watch?v=1 ')).toBe('https://youtube.com/watch?v=1');
    expect(cleanUrl('not a link')).toBeUndefined();
    expect(cleanUrl('')).toBeUndefined();
    expect(videoSearchUrl('Clean + push press')).toBe('https://www.youtube.com/results?search_query=Clean%20%2B%20push%20press%20technique');
  });
});

describe('scanned codes', () => {
  it('knows which formats can be redrawn from their text', () => {
    expect(canRedraw('qr_code')).toBe(true);
    expect(linearFormat('code_128')).toBe('CODE128');
    expect(canRedraw('pdf417')).toBe(false);
  });

  it('only treats web addresses as links', () => {
    expect(linkIn('https://gym.example/m/42')).toBe('https://gym.example/m/42');
    expect(linkIn('MEMBER-123456')).toBeUndefined();
    expect(linkIn('javascript:alert(1)')).toBeUndefined();
  });
});
