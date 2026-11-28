import { describe, expect, it } from 'vitest';
import { guessNeeds, kitList, missingIn, needsOf } from './equipment';
import { TimerIcon } from '../icons';
import { MODE_LABEL, type TimerMode } from './timer';

const ex = (name: string, equipment?: string) => ({ name, equipment });

describe('what an exercise needs', () => {
  it('reads the starter exercises', () => {
    expect(guessNeeds(ex('Goblet squat', '16–24 kg KB'))).toEqual(['kettlebell']);
    expect(guessNeeds(ex('Double kettlebell military press', '2 × 16 kg'))).toEqual(['kettlebell']);
    expect(guessNeeds(ex('Turkish get-up'))).toEqual(['kettlebell']);
    expect(guessNeeds(ex('Romanian deadlift'))).toEqual(['barbell']);
    expect(guessNeeds(ex('Hip thrust'))).toEqual(['barbell', 'bench']);
    expect(guessNeeds(ex('Incline dumbbell press'))).toEqual(['dumbbell', 'bench']);
    expect(guessNeeds(ex('Bulgarian split squat', '2 dumbbells'))).toEqual(['dumbbell']);
    expect(guessNeeds(ex('Pull-ups', 'Pull-up bar'))).toEqual(['pullup']);
    expect(guessNeeds(ex('Leg press'))).toEqual(['machine']);
    expect(guessNeeds(ex('Calf raise (Smith machine)'))).toEqual(['machine']);
    expect(guessNeeds(ex('Face pull'))).toEqual(['cable']);
    expect(guessNeeds(ex('Shield casts', 'One 6 kg club'))).toEqual(['clubs']);
  });

  it('names no kit when the words do not make it plain', () => {
    expect(guessNeeds(ex('Bird dog', 'Bodyweight'))).toEqual([]);
    expect(guessNeeds(ex('Single-leg calf raise'))).toEqual([]);
    expect(guessNeeds(ex('Split squat → hamstring shift'))).toEqual([]);
    expect(guessNeeds(ex('Cossack squat'))).toEqual([]);
  });

  it('prefers what was chosen for the exercise', () => {
    expect(needsOf({ name: 'Goblet squat', needs: ['dumbbell'] })).toEqual(['dumbbell']);
    expect(needsOf({ name: 'Goblet squat', needs: [] })).toEqual([]);
    expect(needsOf({ name: 'Goblet squat', needs: ['dumbbell', 'nonsense' as 'dumbbell'] })).toEqual(['dumbbell']);
  });
});

describe('what a space can do', () => {
  const goblet = ex('Goblet squat', 'KB');
  const rdl = ex('Romanian deadlift');
  const bird = ex('Bird dog');

  it('holds back what needs kit the space does not have', () => {
    const home = { equipment: ['kettlebell' as const] };
    expect(missingIn(goblet, home)).toEqual([]);
    expect(missingIn(rdl, home)).toEqual(['barbell']);
    expect(missingIn(bird, home)).toEqual([]);
  });

  it('holds nothing back in a space that has not said what it has', () => {
    expect(missingIn(rdl, {})).toEqual([]);
    expect(missingIn(rdl, undefined)).toEqual([]);
  });

  it('leaves only bodyweight work in a space with no kit', () => {
    expect(missingIn(goblet, { equipment: [] })).toEqual(['kettlebell']);
    expect(missingIn(bird, { equipment: [] })).toEqual([]);
  });

  it('lists kit in words', () => {
    expect(kitList(['barbell'])).toBe('Barbell');
    expect(kitList(['barbell', 'bench'])).toBe('Barbell and bench');
    expect(kitList(['dumbbell', 'bench', 'pullup'])).toBe('Dumbbells, bench and pull-up bar');
  });
});

describe('timer kinds', () => {
  it('has an icon for every kind of timer', () => {
    for (const mode of Object.keys(MODE_LABEL) as TimerMode[]) expect(TimerIcon[mode]).toBeTruthy();
  });
});
