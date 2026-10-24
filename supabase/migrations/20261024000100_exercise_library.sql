-- Shared exercise library (owner_id null). Variations reference their parent movement.
insert into public.exercises (slug, name, primary_muscle, category, equipment, measure) values
  ('barbell-bench-press',   'Bench Press',            'Chest',      'compound',  'barbell',    'weight_reps'),
  ('barbell-back-squat',    'Back Squat',             'Quads',      'compound',  'barbell',    'weight_reps'),
  ('barbell-deadlift',      'Deadlift',               'Posterior',  'compound',  'barbell',    'weight_reps'),
  ('overhead-press',        'Overhead Press',         'Shoulders',  'compound',  'barbell',    'weight_reps'),
  ('barbell-row',           'Barbell Row',            'Back',       'compound',  'barbell',    'weight_reps'),
  ('pull-up',               'Pull-up',                'Back',       'compound',  'bodyweight', 'bodyweight_reps'),
  ('dip',                   'Dip',                    'Chest',      'compound',  'bodyweight', 'bodyweight_reps'),
  ('push-up',               'Push-up',                'Chest',      'compound',  'bodyweight', 'bodyweight_reps'),
  ('lat-pulldown',          'Lat Pulldown',           'Back',       'compound',  'cable',      'weight_reps'),
  ('seated-cable-row',      'Seated Cable Row',       'Back',       'compound',  'cable',      'weight_reps'),
  ('leg-press',             'Leg Press',              'Quads',      'compound',  'machine',    'weight_reps'),
  ('hip-thrust',            'Hip Thrust',             'Glutes',     'compound',  'barbell',    'weight_reps'),
  ('lateral-raise',         'Lateral Raise',          'Shoulders',  'isolation', 'dumbbell',   'weight_reps'),
  ('face-pull',             'Face Pull',              'Rear delts', 'isolation', 'cable',      'weight_reps'),
  ('barbell-curl',          'Barbell Curl',           'Biceps',     'isolation', 'barbell',    'weight_reps'),
  ('triceps-pushdown',      'Triceps Pushdown',       'Triceps',    'isolation', 'cable',      'weight_reps'),
  ('leg-curl',              'Leg Curl',               'Hamstrings', 'isolation', 'machine',    'weight_reps'),
  ('leg-extension',         'Leg Extension',          'Quads',      'isolation', 'machine',    'weight_reps'),
  ('standing-calf-raise',   'Standing Calf Raise',    'Calves',     'isolation', 'machine',    'weight_reps'),
  ('goblet-squat',          'Goblet Squat',           'Quads',      'compound',  'dumbbell',   'weight_reps'),
  ('dumbbell-row',          'One-arm Dumbbell Row',   'Back',       'compound',  'dumbbell',   'weight_reps'),
  ('chest-fly',             'Cable Chest Fly',        'Chest',      'isolation', 'cable',      'weight_reps')
on conflict do nothing;

-- Variations
insert into public.exercises (slug, name, primary_muscle, category, equipment, measure, variation_of)
select v.slug, v.name, v.muscle, v.category, v.equipment, 'weight_reps', p.id
from (values
  ('incline-bench-press',    'Incline Bench Press',    'Chest',      'compound',  'barbell',  'barbell-bench-press'),
  ('dumbbell-bench-press',   'Dumbbell Bench Press',   'Chest',      'compound',  'dumbbell', 'barbell-bench-press'),
  ('incline-dumbbell-press', 'Incline Dumbbell Press', 'Chest',      'compound',  'dumbbell', 'barbell-bench-press'),
  ('close-grip-bench-press', 'Close-grip Bench Press', 'Triceps',    'compound',  'barbell',  'barbell-bench-press'),
  ('front-squat',            'Front Squat',            'Quads',      'compound',  'barbell',  'barbell-back-squat'),
  ('romanian-deadlift',      'Romanian Deadlift',      'Hamstrings', 'compound',  'barbell',  'barbell-deadlift'),
  ('trap-bar-deadlift',      'Trap Bar Deadlift',      'Posterior',  'compound',  'barbell',  'barbell-deadlift'),
  ('dumbbell-shoulder-press','Dumbbell Shoulder Press','Shoulders',  'compound',  'dumbbell', 'overhead-press'),
  ('machine-shoulder-press', 'Machine Shoulder Press', 'Shoulders',  'compound',  'machine',  'overhead-press'),
  ('chest-supported-row',    'Chest-supported Row',    'Back',       'compound',  'dumbbell', 'barbell-row'),
  ('dumbbell-curl',          'Dumbbell Curl',          'Biceps',     'isolation', 'dumbbell', 'barbell-curl'),
  ('hammer-curl',            'Hammer Curl',            'Biceps',     'isolation', 'dumbbell', 'barbell-curl'),
  ('overhead-triceps-ext',   'Overhead Triceps Extension', 'Triceps','isolation', 'cable',    'triceps-pushdown'),
  ('cable-lateral-raise',    'Cable Lateral Raise',    'Shoulders',  'isolation', 'cable',    'lateral-raise')
) as v(slug, name, muscle, category, equipment, parent)
join public.exercises p on p.slug = v.parent and p.owner_id is null
on conflict do nothing;

insert into public.exercises (slug, name, primary_muscle, category, equipment, measure, variation_of)
select 'chin-up', 'Chin-up', 'Back', 'compound', 'bodyweight', 'bodyweight_reps', id
from public.exercises where slug = 'pull-up' and owner_id is null
on conflict do nothing;
