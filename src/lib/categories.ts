/** The kind of kit an exercise needs, used to split the exercise list into sections. */
export const CATEGORIES = [
  'bodyweight',
  'kettlebell',
  'free_weights',
  'machine',
  'cable',
  'club',
  'mobility',
  'cardio',
  'other',
] as const;

export type ExerciseCategory = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<ExerciseCategory, string> = {
  bodyweight: 'Bodyweight',
  kettlebell: 'Kettlebell',
  free_weights: 'Free weights',
  machine: 'Machine',
  cable: 'Cable',
  club: 'Club',
  mobility: 'Mobility',
  cardio: 'Cardio',
  other: 'Other',
};

/** First match wins, so the more specific kit comes before the general words. */
const RULES: [ExerciseCategory, RegExp][] = [
  ['club', /\bclubs?\b|\bmace\b|shield cast/],
  ['kettlebell', /kettlebell|\bkb\b|turkish get-?up|armou?r building|\bswings?\b|\bsnatch\b|goblet|\bcarry\b|\bdouble\b|\bcleans?\b/],
  ['machine', /machine|smith|leg press|leg extension|leg curl|pec deck|belt squat|pulldown|hack squat|chest press|abductor|adductor/],
  ['cable', /\bcable\b|pushdown|face pull|\brope\b/],
  ['cardio', /\brun\b|running|\bjog|\bwalk|cycl|\bbike\b|\brow(ing)? machine|\bswim|sprint|zone 2|\bruck/],
  ['mobility', /stretch|mobility|rotation|open book|90\/90|rocking|\bcircles?\b|dorsiflexion|toe sit|breathing|wall slide|child'?s[- ]pose|cossack|hamstring shift/],
  ['free_weights', /dumbbell|\bdb\b|barbell|\bbb\b|deadlift|bench|\bcurl\b|\bpress\b|\brow\b|hip thrust|good morning|split squat|\bfly\b|upright row|tib bar|calf raise|\bplates?\b/],
  ['bodyweight', /bodyweight|pull-?ups?|chin-?ups?|push-?ups?|\bdips?\b|\bplanks?\b|bird dog|dead bugs?|ab wheel|l-sit|hyperextension|no load|\bbw\b/],
];

/** Best guess from the name and equipment text. Always editable afterwards. */
export function guessCategory(name: string, equipment?: string): ExerciseCategory {
  const text = `${name} ${equipment ?? ''}`.toLowerCase();
  for (const [category, pattern] of RULES) if (pattern.test(text)) return category;
  return 'other';
}
