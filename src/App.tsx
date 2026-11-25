import { HashRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { formatSeconds } from './db/queries';
import { FeedbackProvider, Icon } from './ui';
import { TimerProvider, useTimer } from './timerContext';
import Home from './screens/Home';
import SpaceScreen from './screens/SpaceScreen';
import RoutineEdit from './screens/RoutineEdit';
import ProgrammeScreen, { PlanScreen } from './screens/ProgrammeScreen';
import WorkoutScreen from './screens/WorkoutScreen';
import { ExerciseDetail, ExerciseList } from './screens/Exercises';
import TimerScreen from './screens/TimerScreen';
import { Library, NoteScreen } from './screens/Library';
import Settings from './screens/Settings';
import History from './screens/History';

/** Four places to be. Every other screen belongs to one of them, which stays lit while you are there. */
const TABS = [
  { to: '/', label: 'Today', icon: Icon.today, owns: /^\/($|space\/|routine\/|workout\/|settings)/ },
  { to: '/plan', label: 'Plan', icon: Icon.plan, owns: /^\/(plan|programme\/|history)/ },
  { to: '/timer', label: 'Timer', icon: Icon.timer, owns: /^\/timer/ },
  { to: '/library', label: 'Library', icon: Icon.library, owns: /^\/(library|note\/|exercises|exercise\/)/ },
];

function TimerPill() {
  const t = useTimer();
  const nav = useNavigate();
  const { pathname } = useLocation();
  if (!t.active || !t.position || pathname === '/timer') return null;
  const phase = t.position.phase;
  // A stopwatch shows the time so far; everything else, the time left.
  const shown = phase?.open ? phase.seconds - t.position.remaining : Math.ceil(t.position.remaining);
  return (
    <button className="pill" onClick={() => (t.position?.done ? t.stop() : nav('/timer'))}>
      <span>{t.position.done ? `${t.name} done` : (phase?.label ?? t.name)}</span>
      {!t.position.done && <span>{formatSeconds(shown)}</span>}
    </button>
  );
}

function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function TabBar() {
  const { pathname } = useLocation();
  return (
    <nav className="nav" aria-label="Main">
      <div className="nav-inner">
        {TABS.map((t) => {
          const active = t.owns.test(pathname);
          return (
            <Link key={t.to} to={t.to} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
              {t.icon}
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <HashRouter>
      <FeedbackProvider>
        <TimerProvider>
          <ScrollReset />
          <div className="app">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/space/:id" element={<SpaceScreen />} />
              <Route path="/routine/:id" element={<RoutineEdit />} />
              <Route path="/plan" element={<PlanScreen />} />
              <Route path="/programme/:id" element={<ProgrammeScreen />} />
              <Route path="/workout/:id" element={<WorkoutScreen />} />
              <Route path="/exercises" element={<ExerciseList />} />
              <Route path="/exercise/:id" element={<ExerciseDetail />} />
              <Route path="/history" element={<History />} />
              <Route path="/timer" element={<TimerScreen />} />
              <Route path="/library" element={<Library />} />
              <Route path="/note/:id" element={<NoteScreen />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Home />} />
            </Routes>
          </div>
          <TimerPill />
          <TabBar />
        </TimerProvider>
      </FeedbackProvider>
    </HashRouter>
  );
}
