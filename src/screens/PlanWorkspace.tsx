import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { useMedia } from '../useWide';
import PlanScreen from './Plan';
import RoutineEdit from './RoutineEdit';
import LibraryPanel from './LibraryPanel';
import { addToRoutine } from './RoutineTable';

/** Wide enough for the library to stay open beside the routine table. */
const ROOMY = '(min-width: 1280px)';

/**
 * Plan on a wide window: the week and routines on the left, the chosen routine's editor in the
 * middle, and the exercise library on the right to drag exercises in from.
 */
export default function PlanWorkspace() {
  const { id } = useParams();
  const roomy = useMedia(ROOMY);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const routine = useLiveQuery(() => (id ? db.routines.get(id) : undefined), [id]);
  const showLibrary = !!routine && (roomy || libraryOpen);

  return (
    <div className={`workspace${showLibrary && roomy ? ' with-library' : ''}`}>
      <PlanScreen embedded />
      {id ? (
        <RoutineEdit key={id} embedded onAddExercises={roomy ? undefined : () => setLibraryOpen(true)} />
      ) : (
        <section className="ws-col ws-editor ws-none">
          <p>Pick a routine on the left to edit it here, or + beside Routines to make one.</p>
        </section>
      )}
      {showLibrary && routine && (
        <div className={roomy ? 'ws-library-slot' : 'ws-library-float'}>
          <LibraryPanel
            spaceId={routine.spaceId}
            onAdd={(e) => void addToRoutine(routine.id, e)}
            onClose={roomy ? undefined : () => setLibraryOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
