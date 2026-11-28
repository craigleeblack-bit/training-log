import { useEffect, useRef, useState } from 'react';
import { useLiveQuery, useObservable } from 'dexie-react-hooks';
import { SYNC_URL } from '../sync';
import { db, TABLES } from '../db/schema';
import { backupFilename, exportBackup, importBackup, validateBackup, type ImportMode } from '../db/backup';
import { addDays, daysBetween, isoDate, relativeDay } from '../lib/dates';
import { buildLogMarkdown, CLAUDE_URL_KEY, copyText, normaliseClaudeUrl } from '../lib/claude';
import { setSetting } from '../actions';
import { download } from '../lib/download';
import { Field, NumInput, Page, SectionTitle, useFeedback } from '../ui';
import { BODY_WEIGHT_KEY } from '../lib/stats';

const LAST_BACKUP_KEY = 'lastBackup';

const PHASE: Record<string, string> = {
  initial: 'Starting',
  'not-in-sync': 'Changes waiting to sync',
  pushing: 'Sending changes',
  pulling: 'Fetching changes',
  'in-sync': 'Up to date',
  error: 'Sync problem',
  offline: 'Offline: will sync when back online',
};

/** Sign in to keep this device in step with your others. Shown only when sync is configured. */
function SyncCard({ onBackup }: { onBackup: () => Promise<void> }) {
  const { toast, confirm } = useFeedback();
  const user = useObservable(db.cloud.currentUser);
  const state = useObservable(db.cloud.syncState);
  const signedIn = !!user?.isLoggedIn;

  const signIn = async () => {
    const ok = await confirm({
      title: 'Turn on sync?',
      body: 'Your log will be stored on Dexie Cloud so your devices can share it. A backup file is saved first. You sign in with a code sent to your email.',
      action: 'Back up and sign in',
    });
    if (!ok) return;
    await onBackup();
    try {
      await db.cloud.login();
    } catch {
      toast('Sign-in did not finish.');
    }
  };

  const signOut = async () => {
    const ok = await confirm({
      title: 'Sign out of sync?',
      body: 'This device stops syncing and its copy of your synced log is cleared. It stays in your account and on your other devices.',
      action: 'Sign out',
      danger: true,
    });
    if (!ok) return;
    try {
      await db.cloud.logout();
    } catch {
      toast('Could not sign out: there are changes still waiting to sync.');
    }
  };

  return (
    <div className="card stack">
      <div className="spread">
        <span>{signedIn ? (user?.email ?? 'Signed in') : 'Not signed in'}</span>
        {signedIn && <span className={`badge${state?.phase === 'in-sync' ? ' ok' : state?.phase === 'error' ? ' warn' : ''}`}>{PHASE[state?.phase ?? 'initial']}</span>}
      </div>
      <p className="sub">
        {signedIn
          ? 'This device syncs whenever the app is open and online. Sign in with the same email on another device to share the log.'
          : 'Sign in on your phone and your computer with the same email, and changes on one appear on the other. Until you do, nothing leaves this device.'}
      </p>
      {state?.phase === 'error' && state.error && <p className="sub">{state.error.message}</p>}
      {signedIn ? (
        <div className="grid-2">
          <button className="btn" onClick={() => db.cloud.sync().catch(() => toast('Could not sync just now.'))}>
            Sync now
          </button>
          <button className="btn ghost danger" onClick={signOut}>
            Sign out
          </button>
        </div>
      ) : (
        <button className="btn primary" onClick={signIn}>
          Sign in to sync
        </button>
      )}
    </div>
  );
}

export default function Settings() {
  const { toast, confirm } = useFeedback();
  const fileRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<ImportMode>('replace');
  const [persisted, setPersisted] = useState<boolean>();

  const info = useLiveQuery(async () => {
    const [url, lastBackup, workouts, bodyWeight] = await Promise.all([
      db.settings.get(CLAUDE_URL_KEY),
      db.settings.get(LAST_BACKUP_KEY),
      db.workouts.count(),
      db.settings.get(BODY_WEIGHT_KEY),
    ]);
    return {
      url: (url?.value as string) ?? '',
      lastBackup: lastBackup?.value as string | undefined,
      workouts,
      bodyWeight: typeof bodyWeight?.value === 'number' ? bodyWeight.value : undefined,
    };
  }, []);

  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (info && url === undefined) setUrl(info.url);
  }, [info, url]);

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted);
  }, []);

  if (!info) return null;
  const today = isoDate();
  const backupAge = info.lastBackup ? daysBetween(info.lastBackup, today) : undefined;
  const typed = (url ?? '').trim();
  const valid = normaliseClaudeUrl(typed);

  const saveUrl = async () => {
    if (!typed) {
      await setSetting(CLAUDE_URL_KEY, '');
      toast('Claude link cleared.');
      return;
    }
    if (!valid) {
      toast('That is not a claude.ai link.');
      return;
    }
    await setSetting(CLAUDE_URL_KEY, valid);
    setUrl(valid);
    toast('Claude Project link saved.');
  };

  const doExport = async () => {
    const backup = await exportBackup(db);
    download(backupFilename(today), JSON.stringify(backup), 'application/json');
    await setSetting(LAST_BACKUP_KEY, today);
    toast('Backup saved to your downloads.');
  };

  const pick = (mode: ImportMode) => {
    modeRef.current = mode;
    fileRef.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      const backup = validateBackup(raw);
      const rows = TABLES.reduce((n, t) => n + (backup.data[t]?.length ?? 0), 0);
      const mode = modeRef.current;
      const ok = await confirm({
        title: mode === 'replace' ? 'Replace everything?' : 'Merge this file in?',
        body:
          mode === 'replace'
            ? `Everything in the app now (${info.workouts} sessions) is replaced by this file (${rows} records, saved ${relativeDay(backup.exportedAt.slice(0, 10)).toLowerCase()}).`
            : `${rows} records are added. Anything with the same identity is overwritten; everything else is kept.`,
        action: mode === 'replace' ? 'Replace' : 'Merge',
        danger: mode === 'replace',
      });
      if (!ok) return;
      await importBackup(db, raw, mode);
      setUrl(undefined);
      toast('Import complete.');
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err instanceof Error ? err.message : 'Import failed.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const copyLog = async (weeks?: number) => {
    const md = await buildLogMarkdown(db, weeks ? addDays(today, -7 * weeks) : undefined);
    if (weeks) toast((await copyText(md)) ? 'Log copied — paste it into Claude.' : 'Could not copy.');
    else download(`training-log-${today}.md`, md, 'text/markdown');
  };

  const keepSafe = async () => {
    const ok = await navigator.storage?.persist?.();
    setPersisted(!!ok);
    toast(ok ? 'Storage is now protected.' : 'The browser declined. Installing the app usually fixes this.');
  };

  const erase = async () => {
    const ok = await confirm({
      title: 'Erase everything?',
      body: 'All spaces, routines, programmes, sessions and notes on this device are deleted. Export a backup first if you might want them back.',
      action: 'Erase all data',
      danger: true,
    });
    if (!ok) return;
    await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
      for (const t of TABLES) await db.table(t).clear();
    });
    setUrl('');
    toast('All data erased.');
  };

  return (
    <Page title="Settings" back>
      <SectionTitle>You</SectionTitle>
      <div className="card stack">
        <Field label="Body weight">
          <NumInput
            ariaLabel="Body weight"
            unit="kg"
            value={info.bodyWeight}
            onCommit={(v) => void (v ? setSetting(BODY_WEIGHT_KEY, v) : db.settings.delete(BODY_WEIGHT_KEY))}
          />
        </Field>
        <p className="sub">Optional. With it, bodyweight exercises get an approximate workload: body weight plus anything added, times reps.</p>
      </div>

      <SectionTitle>Claude</SectionTitle>
      <div className="card stack">
        <Field label="Claude Project link">
          <input
            value={url ?? ''}
            inputMode="url"
            placeholder="https://claude.ai/project/…"
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <p className="sub">
          Open your exercise project on claude.ai, copy the address, and paste it here. “Ask Claude” buttons copy the
          relevant context and open that project.
        </p>
        <div className="grid-2">
          <button className="btn primary" onClick={saveUrl}>
            Save
          </button>
          <a
            className="btn"
            href={normaliseClaudeUrl(info.url) ?? 'https://claude.ai/projects'}
            target="_blank"
            rel="noopener noreferrer"
          >
            {info.url ? 'Open' : 'My projects'}
          </a>
        </div>
      </div>

      <SectionTitle>Give Claude my log</SectionTitle>
      <div className="card stack">
        <p className="sub">A readable summary of your sessions, to paste into a chat or add to the project's files.</p>
        <button className="btn" onClick={() => copyLog(6)}>
          Copy last 6 weeks
        </button>
        <button className="btn" onClick={() => copyLog()}>
          Download full log
        </button>
      </div>

      <SectionTitle>Sync</SectionTitle>
      {SYNC_URL ? (
        <SyncCard onBackup={doExport} />
      ) : (
        <div className="card stack">
          <span>Not set up in this copy of the app</span>
          <p className="sub">
            Sync keeps a phone and a computer in step through Dexie Cloud. It needs a database address adding once, as described in
            the README; until then everything stays on this device and backup files move it.
          </p>
        </div>
      )}

      <SectionTitle>Backup</SectionTitle>
      <div className="card stack">
        <div className="spread">
          <span>
            {info.lastBackup ? `Last backup ${relativeDay(info.lastBackup, today).toLowerCase()}` : 'No backup yet'}
          </span>
          {info.workouts > 0 && (backupAge === undefined || backupAge > 14) && <span className="badge warn">Due</span>}
        </div>
        <p className="sub">
          A backup file is a complete copy of your log that you keep yourself. Without sync it is the only copy off this device;
          with sync it is still worth having.
        </p>
        <button className="btn primary" onClick={doExport}>
          Export backup
        </button>
        <button className="btn" onClick={() => pick('replace')}>
          Import a file (replace everything)
        </button>
        <button className="btn" onClick={() => pick('merge')}>
          Import a file (merge in)
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </div>

      <SectionTitle>Storage</SectionTitle>
      <div className="card stack">
        <div className="spread">
          <span>{persisted ? 'Protected from automatic clean-up' : 'Not yet protected'}</span>
          {persisted ? <span className="badge ok">OK</span> : <button className="btn small" onClick={keepSafe}>Protect</button>}
        </div>
        <button className="btn ghost danger" onClick={erase}>
          Erase all data
        </button>
      </div>
    </Page>
  );
}
