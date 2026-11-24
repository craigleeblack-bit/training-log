import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { formatSeconds } from './db/queries';
import { FeedbackProvider, Icon } from './ui';
import { TimerProvider, useTimer } from './timerContext';
import Home from './screens/Home';
import SpaceScreen from './screens/SpaceScreen';
import RoutineEdit from './screens/RoutineEdit';
import ProgrammeScreen from './screens/ProgrammeScreen';
import WorkoutScreen from './screens/WorkoutScreen';
import { ExerciseDetail, ExerciseList } from './screens/Exercises';
import TimerScreen from './screens/TimerScreen';
import { Library, NoteScreen } from './screens/Library';
import Settings from './screens/Settings';
import History from './screens/History';

const TABS = [
  { to: '/', label: 'Today', icon: Icon.today, end: true },
  { to: '/exercises', label: 'Exercises', icon: Icon.exercises },
  { to: '/timer', label: 'Timer', icon: Icon.timer },
  { to: '/library', label: 'Library', icon: Icon.library },
  { to: '/settings', label: 'Settings', icon: Icon.settings },
];

function TimerPill() {
  const t = useTimer();
  const nav = useNavigate();
  const { pathname } = useLocation();
  if (!t.active || !t.position || pathname === '/timer') return null;
  return (
    <button className="pill" onClick={() => (t.position?.done ? t.stop() : nav('/timer'))}>
      <span>{t.position.done ? `${t.name} done` : (t.position.phase?.label ?? t.name)}</span>
      {!t.position.done && <span>{formatSeconds(Math.ceil(t.position.remaining))}</span>}
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
          <nav className="nav" aria-label="Main">
            <div className="nav-inner">
              {TABS.map((t) => (
                <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {t.icon}
                  {t.label}
                </NavLink>
              ))}
            </div>
          </nav>
        </TimerProvider>
      </FeedbackProvider>
    </HashRouter>
  );
}
