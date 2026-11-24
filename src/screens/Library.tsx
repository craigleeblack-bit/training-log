import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type Note, type NoteKind } from '../db/schema';
import { useAskClaude } from '../actions';
import { Field, Icon, Page, SectionTitle, Sheet, useFeedback } from '../ui';

/** Turns bare http(s) addresses into links; everything else stays text. */
function linkify(text: string): ReactNode[] {
  return text.split(/(https?:\/\/[^\s)]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} className="link" href={part} target="_blank" rel="noopener noreferrer">
        {part.replace(/^https?:\/\//, '')}
      </a>
    ) : (
      part
    ),
  );
}

/** Minimal formatting: "# Heading", "- bullet", blank-line paragraphs. Everything else is plain text. */
function renderBody(body: string): ReactNode[] {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      out.push(
        <ul key={`u${out.length}`}>
          {bullets.map((b, i) => (
            <li key={i}>{linkify(b)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    if (/^[-•]\s+/.test(line)) {
      bullets.push(line.replace(/^[-•]\s+/, ''));
      continue;
    }
    flush();
    if (/^#+\s+/.test(line)) out.push(<h3 key={`h${out.length}`}>{line.replace(/^#+\s+/, '')}</h3>);
    else if (line.trim()) out.push(<p key={`p${out.length}`}>{linkify(line)}</p>);
  }
  flush();
  return out;
}

function NoteForm({ note, kind, onClose }: { note?: Note; kind: NoteKind; onClose: (id?: string) => void }) {
  const count = useLiveQuery(() => db.notes.count(), []) ?? 0;
  const [title, setTitle] = useState(note?.title ?? '');
  const [author, setAuthor] = useState(note?.author ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const save = async () => {
    const next: Note = {
      id: note?.id ?? uid(),
      kind,
      title: title.trim(),
      author: author.trim() || undefined,
      body,
      order: note?.order ?? count,
    };
    await db.notes.put(next);
    onClose(next.id);
  };
  return (
    <Sheet title={`${note ? 'Edit' : 'New'} ${kind === 'book' ? 'resource' : 'note'}`} onClose={() => onClose()}>
      <Field label="Title">
        <input value={title} autoFocus={!note} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      {kind === 'book' && (
        <Field label="Author">
          <input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </Field>
      )}
      <Field label={kind === 'book' ? 'What it covers / why you use it' : 'Note'}>
        <textarea
          style={{ minHeight: kind === 'book' ? 90 : 220 }}
          value={body}
          placeholder={kind === 'note' ? '# Heading\n- bullet\nPlain text' : ''}
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>
      <button className="btn primary block" disabled={!title.trim()} onClick={save}>
        Save
      </button>
    </Sheet>
  );
}

export function Library() {
  const notes = useLiveQuery(() => db.notes.orderBy('order').toArray(), []);
  const exerciseCount = useLiveQuery(() => db.exercises.count(), []) ?? 0;
  const [adding, setAdding] = useState<NoteKind>();
  const ask = useAskClaude();
  if (!notes) return null;
  const mine = notes.filter((n) => n.kind === 'note');
  const books = notes.filter((n) => n.kind === 'book');
  return (
    <Page title="Library" large>
      <div className="card flush">
        <Link to="/exercises" className="row">
          {Icon.exercises}
          <div className="grow">
            <div className="title">Exercises</div>
            <div className="sub">{exerciseCount} with cues, links and history</div>
          </div>
          {Icon.chevRight}
        </Link>
        <button className="row" onClick={() => ask(() => 'My question: ')}>
          {Icon.library}
          <div className="grow">
            <div className="title">Ask Claude</div>
            <div className="sub">Opens your Claude Project</div>
          </div>
          {Icon.chevRight}
        </button>
      </div>

      <SectionTitle action={<button onClick={() => setAdding('note')}>+ Add</button>}>My notes</SectionTitle>
      <div className="card flush">
        {mine.map((n) => (
          <Link key={n.id} to={`/note/${n.id}`} className="row">
            <div className="grow">
              <div className="title">{n.title}</div>
            </div>
            {Icon.chevRight}
          </Link>
        ))}
        {!mine.length && <div className="empty">Protocols, rules and reminders you want to hand.</div>}
      </div>

      <SectionTitle action={<button onClick={() => setAdding('book')}>+ Add</button>}>Books and resources</SectionTitle>
      <div className="card flush">
        {books.map((n) => (
          <Link key={n.id} to={`/note/${n.id}`} className="row">
            <div className="grow">
              <div className="title">{n.title}</div>
              {n.author && <div className="sub">{n.author}</div>}
            </div>
            {Icon.chevRight}
          </Link>
        ))}
        {!books.length && <div className="empty">List the books in your Claude Project to ask about them from here.</div>}
      </div>
      <p className="sub">
        The books themselves live in your Claude Project, not in this app. Opening a resource gives you a button that
        starts a question about it.
      </p>

      {adding && <NoteForm kind={adding} onClose={() => setAdding(undefined)} />}
    </Page>
  );
}

export function NoteScreen() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { confirm } = useFeedback();
  const ask = useAskClaude();
  const note = useLiveQuery(async () => (await db.notes.get(id)) ?? null, [id]);
  const [editing, setEditing] = useState(false);
  if (note === undefined) return null;
  if (!note) {
    return (
      <Page title="Library" back="/library">
        <div className="empty">This item no longer exists.</div>
      </Page>
    );
  }
  const context =
    note.kind === 'book'
      ? `About "${note.title}"${note.author ? ` by ${note.author}` : ''} (it is in this project's files).\n\nMy question: `
      : `From my training notes — ${note.title}:\n\n${note.body}\n\nMy question: `;

  const remove = async () => {
    const ok = await confirm({ title: `Delete “${note.title}”?`, action: 'Delete', danger: true });
    if (ok) {
      await db.notes.delete(id);
      nav('/library');
    }
  };

  return (
    <Page
      title={note.title}
      back="/library"
      actions={
        <button className="icon-btn" aria-label="Edit" onClick={() => setEditing(true)}>
          {Icon.pencil}
        </button>
      }
    >
      {note.author && <p className="muted" style={{ marginTop: -8 }}>{note.author}</p>}
      {note.body.trim() && <div className="card note-body">{renderBody(note.body)}</div>}
      <button className="btn primary" onClick={() => ask(() => context)}>
        Ask Claude about this
      </button>
      <button className="btn ghost danger" onClick={remove}>
        Delete
      </button>
      {editing && <NoteForm note={note} kind={note.kind} onClose={() => setEditing(false)} />}
    </Page>
  );
}
