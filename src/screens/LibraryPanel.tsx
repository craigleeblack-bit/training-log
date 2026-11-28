import type { Exercise } from '../db/schema';
import { Icon } from '../ui';
import { ExerciseBrowser } from './RoutineEdit';

/**
 * The exercise library as a column beside the routine being edited: drag an exercise into the
 * table, or + to add it at the end. Only what the routine's space has kit for, unless asked.
 */
export default function LibraryPanel({
  spaceId,
  onAdd,
  onClose,
}: {
  spaceId?: string;
  onAdd: (e: Exercise) => void;
  /** Given when the panel floats over the editor on a narrower window. */
  onClose?: () => void;
}) {
  return (
    <aside className="ws-col ws-library" aria-label="Exercise library">
      <div className="ws-head">
        <h2>Exercises</h2>
        {onClose && (
          <button className="icon-btn" aria-label="Close the exercise library" onClick={onClose}>
            {Icon.close}
          </button>
        )}
      </div>
      <ExerciseBrowser onPick={onAdd} spaceId={spaceId} panel />
    </aside>
  );
}
