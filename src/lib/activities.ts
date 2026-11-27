/** What a session is: the kind of exercise, shown as an icon on the week. */
export const ACTIVITIES = [
  { key: 'strength', label: 'Strength' },
  { key: 'kettlebell', label: 'Kettlebell' },
  { key: 'bodyweight', label: 'Bodyweight' },
  { key: 'core', label: 'Core' },
  { key: 'hiit', label: 'HIIT' },
  { key: 'run', label: 'Run' },
  { key: 'walk', label: 'Walk' },
  { key: 'hike', label: 'Hike' },
  { key: 'cycle', label: 'Cycle' },
  { key: 'swim', label: 'Swim' },
  { key: 'row', label: 'Row' },
  { key: 'yoga', label: 'Yoga' },
  { key: 'mobility', label: 'Stretch and mobility' },
  { key: 'climb', label: 'Climb' },
  { key: 'boxing', label: 'Boxing' },
  { key: 'racket', label: 'Racket sports' },
  { key: 'team', label: 'Team sports' },
  { key: 'dance', label: 'Dance' },
  { key: 'snow', label: 'Ski and snow' },
  { key: 'skate', label: 'Skate' },
  { key: 'golf', label: 'Golf' },
  { key: 'rest', label: 'Rest' },
  { key: 'other', label: 'Other' },
] as const;

export type ActivityKey = (typeof ACTIVITIES)[number]['key'];

/** Where a space is, shown as its icon. */
export const SPACE_ICONS = [
  { key: 'home', label: 'Home' },
  { key: 'gym', label: 'Gym' },
  { key: 'garage', label: 'Garage' },
  { key: 'studio', label: 'Studio' },
  { key: 'pool', label: 'Pool' },
  { key: 'outdoors', label: 'Outdoors' },
  { key: 'park', label: 'Park' },
  { key: 'track', label: 'Track' },
  { key: 'hills', label: 'Trail and hills' },
  { key: 'beach', label: 'Beach and sea' },
  { key: 'court', label: 'Court' },
  { key: 'travel', label: 'Travel' },
] as const;

export type SpaceIconKey = (typeof SPACE_ICONS)[number]['key'];

const ACTIVITY_KEYS = new Set<string>(ACTIVITIES.map((a) => a.key));
const SPACE_KEYS = new Set<string>(SPACE_ICONS.map((a) => a.key));

export const activityLabel = (key: ActivityKey): string => ACTIVITIES.find((a) => a.key === key)?.label ?? 'Other';

/** First match wins, so the specific sports come before the general words. */
const ACTIVITY_RULES: [ActivityKey, RegExp][] = [
  ['rest', /^rest\b|\brest day\b|recovery day/],
  ['swim', /\bswim|\bpool\b|\blengths\b/],
  ['run', /\brun\b|\bruns\b|running|\bjog|sprint|tempo|parkrun|\b\d+ ?k\b|race day/],
  ['walk', /\bwalk|\bruck/],
  ['cycle', /cycl|\bbike\b|\bride\b|\bspin\b/],
  ['hike', /\bhike|hiking|\btrek/],
  ['row', /rowing|\berg\b|row machine|concept ?2/],
  ['yoga', /yoga|pilates/],
  ['mobility', /mobility|stretch|flexib|prehab|rehab|warm-?up|cool-?down|physio/],
  ['climb', /climb|boulder/],
  ['boxing', /\bbox(ing)?\b|kickbox|martial|\bbjj\b|judo|karate|muay/],
  ['racket', /tennis|squash|badminton|padel|pickleball/],
  ['team', /football|soccer|rugby|basketball|netball|hockey|cricket|volleyball/],
  ['dance', /danc|zumba/],
  ['snow', /\bski|snowboard/],
  ['skate', /skat/],
  ['golf', /golf/],
  ['kettlebell', /kettlebell|\bkb\b|swings?\b|simple ?(&|and) ?sinister|armou?r building/],
  ['hiit', /hiit|tabata|emom|amrap|metcon|conditioning/],
  ['core', /\bcore\b|\babs?\b/],
  ['bodyweight', /bodyweight|calisthenics|circuit|push-?ups?|pull-?ups?/],
  ['strength', /strength|\blift|\bgym\b|weights?|squat|deadlift|bench|press|upper|lower|\bpush\b|\bpull\b|\blegs\b|full body|hypertrophy|club/],
  ['walk', /aerobic|endurance|zone ?2|cardio/],
];

/**
 * Best guess at what a session is from its names, tried in order: the routine, the session title,
 * the programme, the space. Always editable afterwards.
 */
export function guessActivity(...names: (string | undefined)[]): ActivityKey {
  for (const name of names) {
    const text = name?.toLowerCase();
    if (!text) continue;
    for (const [key, pattern] of ACTIVITY_RULES) if (pattern.test(text)) return key;
  }
  return 'strength';
}

const SPACE_RULES: [SpaceIconKey, RegExp][] = [
  ['pool', /pool|swim|aquatic|lido/],
  ['gym', /\bgym|fitness|leisure|crossfit|\bbox\b/],
  ['garage', /garage|shed|basement|cellar/],
  ['studio', /studio|yoga|pilates|dojo|mobility|mat\b/],
  ['park', /\bpark\b/],
  ['track', /\btrack\b|stadium/],
  ['hills', /trail|hill|mountain|\bfell/],
  ['beach', /beach|\bsea\b|coast|lake/],
  ['court', /court|tennis|squash|\bhall\b/],
  ['travel', /hotel|travel|away|holiday/],
  ['outdoors', /outdoor|outside|garden|road|street|\brun/],
  ['home', /home|house|\bflat\b|living|bedroom/],
];

/** Best guess at a space's icon from its name. */
export function guessSpaceIcon(name: string): SpaceIconKey {
  const text = name.toLowerCase();
  for (const [key, pattern] of SPACE_RULES) if (pattern.test(text)) return key;
  return 'home';
}

/** A stored activity, or undefined when it is missing or one this version does not know. */
export const knownActivity = (key?: string): ActivityKey | undefined =>
  key && ACTIVITY_KEYS.has(key) ? (key as ActivityKey) : undefined;

export const knownSpaceIcon = (key?: string): SpaceIconKey | undefined =>
  key && SPACE_KEYS.has(key) ? (key as SpaceIconKey) : undefined;

/** What a programme day is: its own choice, else its routine's, else a guess from the names. */
export function activityOf(
  slot: { title: string; activity?: string; rest?: boolean } | undefined,
  routine?: { name: string; activity?: string },
  context: { programme?: string; space?: string } = {},
): ActivityKey {
  if (slot?.rest) return 'rest';
  return (
    knownActivity(slot?.activity) ??
    knownActivity(routine?.activity) ??
    guessActivity(routine?.name, slot?.title, context.programme, context.space)
  );
}

/** A space's icon: its own choice, else a guess from its name. */
export const spaceIconOf = (space: { name: string; icon?: string }): SpaceIconKey =>
  knownSpaceIcon(space.icon) ?? guessSpaceIcon(space.name);
