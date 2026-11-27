import { describe, expect, it } from 'vitest';
import { ACTIVITIES, activityOf, guessActivity, guessSpaceIcon, knownActivity, SPACE_ICONS, spaceIconOf } from './activities';
import { ActivityIcon, SpaceIcon } from '../icons';

describe('activity guesses', () => {
  it('reads the starter routines', () => {
    expect(guessActivity('Strength A — press')).toBe('strength');
    expect(guessActivity('Upper B')).toBe('strength');
    expect(guessActivity('Kettlebell menu')).toBe('kettlebell');
    expect(guessActivity('Clubs + mobility')).toBe('mobility');
    expect(guessActivity('Bike — Norwegian 4×4')).toBe('cycle');
    expect(guessActivity('Dog walk + loaded carries')).toBe('walk');
    expect(guessActivity('Easy walk / hike / cycle')).toBe('walk');
    expect(guessActivity('Easy run')).toBe('run');
    expect(guessActivity('Swim session')).toBe('swim');
    expect(guessActivity('Basic warm-up')).toBe('mobility');
  });

  it('falls back on the later names in turn', () => {
    expect(guessActivity(undefined, 'Intervals', '5K in 25 minutes', 'Outdoors')).toBe('run');
    expect(guessActivity('Evening routine', 'Mobility')).toBe('mobility');
    expect(guessActivity('Session 1', '6 weeks to 1,000 m', 'Swim')).toBe('swim');
    expect(guessActivity('Something new')).toBe('strength');
  });

  it('does not take kilograms for kilometres', () => {
    expect(guessActivity('Goblet squat 16 kg')).toBe('strength');
    expect(guessActivity('Tempo 5 k')).toBe('run');
  });

  it('resolves a programme day: rest, its own choice, the routine, then a guess', () => {
    expect(activityOf({ title: 'Rest', rest: true })).toBe('rest');
    expect(activityOf({ title: 'Easy run', activity: 'walk' }, { name: 'x', activity: 'swim' })).toBe('walk');
    expect(activityOf({ title: 'Easy run' }, { name: 'x', activity: 'swim' })).toBe('swim');
    expect(activityOf({ title: 'Long run' })).toBe('run');
    expect(activityOf({ title: 'Long run', activity: 'nonsense' })).toBe('run');
    expect(knownActivity('nonsense')).toBeUndefined();
  });
});

describe('space icon guesses', () => {
  it('reads the starter spaces', () => {
    expect(['Home', 'Gym', 'Outdoors', 'Swim', 'Mobility'].map(guessSpaceIcon)).toEqual(['home', 'gym', 'outdoors', 'pool', 'studio']);
    expect(guessSpaceIcon('Garage gym')).toBe('gym');
    expect(guessSpaceIcon('The shed')).toBe('garage');
    expect(guessSpaceIcon('Hotel')).toBe('travel');
    expect(guessSpaceIcon('Somewhere')).toBe('home');
  });

  it('prefers the icon chosen for a space', () => {
    expect(spaceIconOf({ name: 'Gym', icon: 'park' })).toBe('park');
    expect(spaceIconOf({ name: 'Gym' })).toBe('gym');
  });
});

describe('icon bank', () => {
  it('has a drawing for every activity and space icon', () => {
    for (const a of ACTIVITIES) expect(ActivityIcon[a.key]).toBeTruthy();
    for (const s of SPACE_ICONS) expect(SpaceIcon[s.key]).toBeTruthy();
  });
});
