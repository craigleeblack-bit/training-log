/**
 * A technique video for common exercises, matched by name (case and punctuation ignored).
 * A video saved on the exercise itself always wins over these.
 *
 * Each link was checked to load on 25 November 2026. Videos do get taken down: when one goes,
 * save a replacement on the exercise, or use "Find a video" there.
 */
const yt = (id: string): string => `https://www.youtube.com/watch?v=${id}`;

export const SUGGESTED_VIDEOS: Record<string, string> = {
  // Kettlebell
  'Double kettlebell military press': yt('gBAMwxHyXcw'), // Fabio Zonin (Strong And Fit)
  'Goblet squat': yt('gCESNsDsbqk'), // BuiltLean
  'Suitcase carry': yt('y-hn_Ha1-RE'), // Dr. Carl Baird
  'Armor Building Complex': yt('9H3bBEKQKuM'), // Hunter Physio: double and single bell versions
  'Two-handed kettlebell swing': yt('YNwvx12oV2M'), // StrongFirst coaching (Rafal Matuszewski)
  'Zone 2 swings': yt('YNwvx12oV2M'),
  'Single-arm swing': yt('BXrXhyudA80'), // Pavel Tsatsouline (Strong And Fit)
  'Turkish get-up': yt('ZutpEZ2B7Uc'), // Nuffield Health
  'Kettlebell snatch (alternating hands)': yt('XHlXPW8R3OU'), // Pat Flynn
  'Rack carry': yt('CJ-F_Xg9fJY'), // Prototype Training Systems
  'Overhead carry': yt('54POVWkWjEs'), // [P]rehab
  'Clean + push press': yt('12NoAYiGzVc'), // Chris Lopez
  'Double front squat': yt('7AETiEZEOVQ'), // Fabio Zonin (Strong And Fit)
  'KB row': yt('hYzh_TgHXnM'), // Travis Tarrant

  // Club
  'Two-handed club front swings': yt('9JHFkrjW4_Y'), // Onnit Academy
  'Shield casts': yt('CKMDy9NeA7U'), // Adex Clubs & Maces

  // Bodyweight
  'Pull-ups': yt('TMnxKjdYcME'), // Myprotein masterclass
  'Bird dog': yt('S1QbyYZaXIg'), // McGill Big 3 (Northern Nevada Chiropractic)
  'Ab wheel rollout': yt('nCh8VfWY5_g'), // Redefining Strength
  'Bodyweight dip': yt('hsEKg3M45dc'), // MuscleWiki
  'L-sit / single-leg L-sit': yt('j-w-eS2i2cE'), // Evolve Functional Fitness
  'Reverse hyperextensions': yt('igj6_GWSt3I'), // Hammer Fitness
  'Dead bugs': yt('g_BYB0R-4Ws'), // Children's Hospital Colorado
  'Side planks': yt('VAPN4CmUWqk'), // McGill Big 3 (Northern Nevada Chiropractic)

  // Free weights
  'Single-leg calf raise': yt('_rKgZMP1X5o'), // Horton Barbell
  'Good morning': yt('BJ0G0d_iOdo'), // Barbell Logic
  'Tib bar raise': yt('1nZgmPik6Mk'), // Slant Board
  'Incline DB biceps curl': yt('0dT4L6Lsi80'), // NASM
  'Incline dumbbell press': yt('hChjZQhX1Ls'), // ScottHermanFitness
  'DB preacher curl': yt('lLmYH1bOIz4'), // KevinLisakFitness
  'Rear delt fly': yt('2LWJ5KlFqk4'), // J2FIT Strength & Conditioning
  'Romanian deadlift': yt('yjqRj72AuaE'), // Nat Wilson Fitness
  'Bulgarian split squat': yt('VPhhE6bBzZE'), // Jack Hanrahan Fitness
  'Hip thrust': yt('Zp26q4BY5HE'), // Girls Gone Strong

  // Machine
  'Chest press (Smith machine)': yt('KJSgqUDFe00'), // MuscleSquad
  'Lat pulldown': yt('0lNuPeUdKpk'), // Hammer Fitness
  'Pec deck': yt('hZ0CGRaKwbQ'), // Hammer Fitness
  'Leg press': yt('uRFWe2nOUjg'), // Tim Bullici
  'Leg extension': yt('iW83kMs0OHw'), // Jayd Harrison
  'Leg curl': yt('Z5pRnXaCjpM'), // Hammer Fitness
  'Abductor machine': yt('5O_Y9l__iao'), // Hammer Fitness
  'Adductor machine': yt('ScqpbvOZWe8'), // Hammer Fitness
  'Calf raise (Smith machine)': yt('rh8L34lAKC0'), // Russell Personal Training
  'Belt squat': yt('c6AtfEDcOyk'), // J2FIT Strength & Conditioning

  // Cable
  'Face pull': yt('7z65m-qWJrA'), // Horton Barbell
  'Triceps pushdown': yt('_w-HpW70nSQ'), // ScottHermanFitness
  'Upright row': yt('68fQ7AXW0Os'), // Hammer Fitness

  // Mobility
  'Cossack squat': yt('JaCbmoDqUc4'), // Flexibility Maestro
  'Ankle dorsiflexion rock/stand': yt('Gs4AyvJpG1M'), // Train With Cuz
  'Toe sit / toe stretch': yt('I9akEI0gKqA'), // Move With Nick
  'Original Strength rocking + neck': yt('5e08_N8Ca7M'), // Original Strength
  "Prayer/child's-pose lat stretch": yt('GRUbJjv8tBs'), // DrivenFit
  'Open books': yt('917w2gqZwZQ'), // Petroski Physio
  'Elevated 90/90 rotations': yt('kvyYhCbOUaQ'), // Horton Barbell
  'Scapular push-ups / wall slides': yt('QzLwH-i0vLk'), // Precision Nutrition
  '90/90 wall hip lift + breathing': yt('8MiyCcrqTtU'), // Daniel Bove
};
