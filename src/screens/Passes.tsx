import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import qrcode from 'qrcode-generator';
import JsBarcode from 'jsbarcode';
import { db, uid, type Pass } from '../db/schema';
import { copyText } from '../lib/claude';
import { toDataUrl } from '../lib/image';
import { canRedraw, decodeFile, detectCodes, linearFormat, linkIn, type Scanned } from '../lib/scan';
import { useWakeLock } from '../lib/wakeLock';
import { Field, Icon, Page, Sheet, useFeedback } from '../ui';

/* ── Drawing a code from its text ─────────────────────────── */

function QrArt({ text }: { text: string }) {
  const art = useMemo(() => {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      return { n, d };
    } catch {
      return undefined; // more text than a QR code can hold
    }
  }, [text]);
  if (!art) return <p className="code-text">{text}</p>;
  // Four modules of white all round: scanners need the quiet zone.
  return (
    <svg className="code-art" viewBox={`-4 -4 ${art.n + 8} ${art.n + 8}`} shapeRendering="crispEdges" role="img" aria-label="QR code">
      <rect x={-4} y={-4} width={art.n + 8} height={art.n + 8} fill="#fff" />
      <path d={art.d} fill="#000" />
    </svg>
  );
}

function BarcodeArt({ text, format }: { text: string; format: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, text, { format, displayValue: true, margin: 12, height: 110, width: 2, fontSize: 18 });
      setFailed(false);
    } catch {
      setFailed(true); // the text does not fit this barcode type
    }
  }, [text, format]);
  return failed ? <QrArt text={text} /> : <svg ref={ref} className="code-art wide" role="img" aria-label="Barcode" />;
}

function PassArt({ pass }: { pass: Pass }) {
  if (pass.kind === 'image' && pass.image) return <img className="code-art photo" src={pass.image} alt={pass.name} />;
  if (!pass.text) return null;
  const linear = linearFormat(pass.format);
  return linear ? <BarcodeArt text={pass.text} format={linear} /> : <QrArt text={pass.text} />;
}

/* ── Showing a pass to a reader ───────────────────────────── */

function PassView({ pass, onClose, onEdit }: { pass: Pass; onClose: () => void; onEdit: () => void }) {
  useWakeLock(true);
  return (
    <div className="pass-view" role="dialog" aria-label={pass.name}>
      <div className="pass-bar">
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          {Icon.close}
        </button>
        <b>{pass.name}</b>
        <button className="icon-btn" aria-label="Edit this pass" onClick={onEdit}>
          {Icon.pencil}
        </button>
      </div>
      <div className="pass-stage">
        <PassArt pass={pass} />
      </div>
      <p className="pass-hint">{pass.note || 'Turn the screen brightness up if the reader struggles.'}</p>
    </div>
  );
}

/* ── The camera ───────────────────────────────────────────── */

function Scanner({ onFound, onClose }: { onFound: (code: Scanned, frame: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string>();
  const found = useRef(onFound);
  found.current = onFound;

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let over = false;

    const look = async () => {
      const el = video.current;
      if (over || !el) return;
      try {
        if (el.readyState >= 2 && el.videoWidth) {
          const [code] = await detectCodes(el);
          if (code && !over) {
            over = true;
            found.current(code, await toDataUrl(el, 1200));
            return;
          }
        }
      } catch {
        setProblem('The scanner could not start. Choose a photo of the code instead.');
        return;
      }
      timer = window.setTimeout(look, 220);
    };

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (over || !video.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.current.srcObject = stream;
        await video.current.play();
        void look();
      } catch {
        setProblem('The camera is not available. Allow camera access for this app, or choose a photo of the code instead.');
      }
    })();

    return () => {
      over = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="pass-view dark" role="dialog" aria-label="Scan a code">
      <div className="pass-bar">
        <button className="icon-btn" aria-label="Close the scanner" onClick={onClose}>
          {Icon.close}
        </button>
        <b>Scan a code</b>
        <span className="icon-btn" />
      </div>
      <div className="pass-stage">
        {problem ? <p className="pass-hint">{problem}</p> : <video ref={video} className="scan-video" playsInline muted />}
      </div>
      {!problem && <p className="pass-hint">Point the camera at a QR code or barcode.</p>}
    </div>
  );
}

/* ── Naming, saving, removing ─────────────────────────────── */

function PassForm({ pass, isNew, onClose }: { pass: Pass; isNew: boolean; onClose: (saved: boolean) => void }) {
  const { confirm } = useFeedback();
  const [name, setName] = useState(pass.name);
  const [note, setNote] = useState(pass.note ?? '');

  const save = async () => {
    await db.passes.put({ ...pass, name: name.trim() || 'Pass', note: note.trim() || undefined });
    onClose(true);
  };

  const remove = async () => {
    const ok = await confirm({ title: `Delete ${pass.name}?`, action: 'Delete pass', danger: true });
    if (ok) {
      await db.passes.delete(pass.id);
      onClose(false);
    }
  };

  return (
    <Sheet title={isNew ? 'New pass' : 'Edit pass'} onClose={() => onClose(false)}>
      <div className="pass-preview">
        <PassArt pass={pass} />
      </div>
      <Field label="Name">
        <input value={name} autoFocus={isNew} placeholder="Gym entry" onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Note (optional)">
        <input value={note} placeholder="Shown under the code" onChange={(e) => setNote(e.target.value)} />
      </Field>
      <button className="btn primary block" onClick={save}>
        Save
      </button>
      {!isNew && (
        <button className="btn ghost danger" onClick={remove}>
          Delete this pass
        </button>
      )}
    </Sheet>
  );
}

/** What a scan found, and what to do with it. */
function ScanResult({ code, onSave, onClose }: { code: Scanned; onSave: () => void; onClose: () => void }) {
  const { toast } = useFeedback();
  const link = linkIn(code.text);
  return (
    <Sheet title="Code found" onClose={onClose}>
      <p className="code-text">{code.text}</p>
      <button className="btn primary block" onClick={onSave}>
        Save as a pass
      </button>
      <div className="grid-2">
        {link && (
          <a className="btn" href={link} target="_blank" rel="noopener noreferrer" onClick={onClose}>
            Open link
          </a>
        )}
        <button className="btn" onClick={async () => toast((await copyText(code.text)) ? 'Copied.' : 'Could not copy.')}>
          Copy
        </button>
      </div>
      {link && <p className="sub">Only open links from codes you trust.</p>}
    </Sheet>
  );
}

/* ── The Passes screen ────────────────────────────────────── */

export default function Passes() {
  const { toast } = useFeedback();
  const passes = useLiveQuery(() => db.passes.orderBy('order').toArray(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showing, setShowing] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const [draft, setDraft] = useState<{ pass: Pass; isNew: boolean }>();
  const [result, setResult] = useState<{ code: Scanned; frame?: string }>();
  // With a single pass there is nothing to choose: open the app, tap once, show it.
  const auto = useRef(false);
  useEffect(() => {
    if (passes && !auto.current) {
      auto.current = true;
      if (passes.length === 1) setShowing(passes[0].id);
    }
  }, [passes]);

  if (!passes) return null;
  const shown = passes.find((p) => p.id === showing);

  /** A pass from a scanned code: redrawn from its text when possible, else the picture it came from. */
  const fromCode = (code: Scanned, frame?: string): Pass =>
    canRedraw(code.format) || !frame
      ? { id: uid(), name: '', kind: 'code', format: code.format, text: code.text, order: passes.length }
      : { id: uid(), name: '', kind: 'image', image: frame, order: passes.length };

  const onFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    try {
      const image = await toDataUrl(file);
      let code: Scanned | undefined;
      try {
        [code] = await decodeFile(file);
      } catch {
        /* no reader available: keep the picture */
      }
      setDraft({
        isNew: true,
        pass: code && canRedraw(code.format) ? fromCode(code) : { id: uid(), name: '', kind: 'image', image, order: passes.length },
      });
    } catch {
      toast('That picture could not be read.');
    }
  };

  return (
    <Page title="Passes" back="/">
      <div className="grid-2">
        <button className="btn primary big" onClick={() => setScanning(true)}>
          {Icon.scan}
          Scan
        </button>
        <button className="btn big" onClick={() => fileRef.current?.click()}>
          {Icon.plus}
          Add picture
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />

      {passes.length > 0 ? (
        <div className="pass-grid">
          {passes.map((p) => (
            <button key={p.id} className="pass-card" onClick={() => setShowing(p.id)}>
              <span className="pass-thumb">
                <PassArt pass={p} />
              </span>
              <b>{p.name}</b>
            </button>
          ))}
        </div>
      ) : (
        <div className="card">
          <p>
            Keep your gym entry code here. Scan it, or add a screenshot or photo of it, then show it at the gate with one
            tap from Today.
          </p>
          <p className="sub" style={{ marginTop: 8 }}>
            Scan also reads the codes on machines and posters, and offers to open their link.
          </p>
        </div>
      )}
      <p className="sub">
        A code that changes every time, as some gym apps show, cannot be stored: use a fixed code or card number.
      </p>

      {shown && (
        <PassView
          pass={shown}
          onClose={() => setShowing(undefined)}
          onEdit={() => {
            setShowing(undefined);
            setDraft({ pass: shown, isNew: false });
          }}
        />
      )}
      {scanning && (
        <Scanner
          onClose={() => setScanning(false)}
          onFound={(code, frame) => {
            setScanning(false);
            setResult({ code, frame });
          }}
        />
      )}
      {result && (
        <ScanResult
          code={result.code}
          onClose={() => setResult(undefined)}
          onSave={() => {
            setDraft({ pass: fromCode(result.code, result.frame), isNew: true });
            setResult(undefined);
          }}
        />
      )}
      {draft && (
        <PassForm
          pass={draft.pass}
          isNew={draft.isNew}
          onClose={(saved) => {
            if (saved && draft.isNew) toast('Pass saved.');
            setDraft(undefined);
          }}
        />
      )}
    </Page>
  );
}
