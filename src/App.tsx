import { HashRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { formatSeconds } from './db/queries';
import { FeedbackProvider, Icon } from './ui';
import { TimerProvider, useTimer } from './timerContext';
import { TrackProvider, useDistanceUnit, useTrack } from './trackContext';
import { formatDistance } from './lib/track';
import Home from './screens/Home';
import SpaceScreen from './screens/SpaceScreen';
import RoutineEdit from './screens/RoutineEdit';
import ProgrammeScreen from './screens/ProgrammeScreen';
import PlanScreen from './screens/Plan';
import WorkoutScreen, { DayScreen, ExerciseScreen } from './screens/WorkoutScreen';
import Review from './screens/Review';
import { useCloseStale } from './useCloseStale';
import { ExerciseDetail, ExerciseList } from './screens/Exercises';
import TimerScreen from './screens/TimerScreen';
import { Library, NoteScreen } from './screens/Library';
import Settings from './screens/Settings';
import History from './screens/History';
import Calendar from './screens/Calendar';
import PlanWorkspace from './screens/PlanWorkspace';
import { useWide } from './useWide';

// Screens with heavy libraries of their own load when first opened, so the app starts fast.
const Passes = lazy(() => import('./screens/Passes'));
const TrackScreen = lazy(() => import('./screens/TrackScreen'));

/** A recording under way follows you round the app, one tap from its screen. */
function TrackPill() {
  const t = useTrack();
  const timer = useTimer();
  const [unit] = useDistanceUnit();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const rec = t.recording;
  if (!rec || pathname.startsWith('/track/')) return null;
  return (
    <button className={`pill${timer.active && pathname !== '/timer' ? ' second' : ''}`} onClick={() => nav(`/track/${rec.workoutId}`)}>
      {Icon.route}
      <span>{rec.paused ? 'Paused' : 'Recording'}</span>
      <span>{formatDistance(t.metres, unit)}</span>
    </button>
  );
}

/** Five places to be. Every other screen belongs to one of them, which stays lit while you are there. */
const TABS = [
  { to: '/', label: 'Week', icon: Icon.today, owns: /^\/($|day\/|workout\/|settings|pass|track\/)/ },
  { to: '/plan', label: 'Plan', icon: Icon.plan, owns: /^\/(plan|programme\/|space\/|routine\/)/ },
  { to: '/review', label: 'Review', icon: Icon.chart, owns: /^\/(review|progress|history|calendar|exercise\/)/ },
  { to: '/timer', label: 'Timer', icon: Icon.timer, owns: /^\/timer/ },
  { to: '/library', label: 'Library', icon: Icon.library, owns: /^\/(library|note\/|exercises)/ },
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

/** On a wide window Plan and its routines open as one workspace; on a phone, as pages. */
function AppRoutes() {
  const wide = useWide();
  useCloseStale();
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/space/:id" element={<SpaceScreen />} />
      <Route path="/routine/:id" element={wide ? <PlanWorkspace /> : <RoutineEdit />} />
      <Route path="/plan" element={wide ? <PlanWorkspace /> : <PlanScreen />} />
      <Route path="/programme/:id" element={<ProgrammeScreen />} />
      <Route path="/day/:date/:routineId" element={<DayScreen />} />
      <Route path="/workout/:id" element={<WorkoutScreen />} />
      <Route path="/workout/:id/exercise/:itemId" element={<ExerciseScreen />} />
      <Route path="/review" element={<Review />} />
      <Route path="/exercises" element={<ExerciseList />} />
      <Route path="/exercise/:id" element={<ExerciseDetail />} />
      <Route path="/history" element={<History />} />
      <Route path="/calendar" element={<Calendar />} />
      <Route path="/progress" element={<Review />} />
      <Route path="/timer" element={<TimerScreen />} />
      <Route path="/library" element={<Library />} />
      <Route path="/note/:id" element={<NoteScreen />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/pass" element={<Passes />} />
      <Route path="/track/:id" element={<TrackScreen />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

export default function App() {
  return (
    <HashRouter>
      <FeedbackProvider>
        <TimerProvider>
          <TrackProvider>
          <ScrollReset />
          <div className="app">
            <Suspense fallback={null}>
            <AppRoutes />
            </Suspense>
          </div>
          <TimerPill />
          <TrackPill />
          <TabBar />
          </TrackProvider>
        </TimerProvider>
      </FeedbackProvider>
    </HashRouter>
  );
}
