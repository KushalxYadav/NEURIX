"use client";

import { Loader2, Save, Trash2 } from "lucide-react";
import { useActionState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { deleteNote, saveNote, type NoteFormState } from "@/modules/learning/actions";

export function NoteEditor({
  note,
  sessionKey,
  sessions,
  canSave,
  saveHint,
}: {
  note?: { id: string; title: string; body: string; sessionKey: string | null };
  sessionKey?: string | null;
  sessions?: { key: string; label: string }[];
  canSave: boolean;
  saveHint?: string;
}) {
  const [state, action, pending] = useActionState<NoteFormState, FormData>(saveNote, { ok: false });
  const [deleting, startDelete] = useTransition();
  const formKey = note?.id ?? "new";

  return (
    <form action={action} key={formKey} className="flex flex-col gap-3">
      {note && <input type="hidden" name="id" value={note.id} />}
      {sessions ? (
        <div>
          <Label htmlFor={`session-${formKey}`}>Session</Label>
          <select
            id={`session-${formKey}`}
            name="sessionKey"
            defaultValue={note?.sessionKey ?? sessionKey ?? ""}
            className="mt-1.5 h-10 w-full rounded-xl border border-border-strong bg-surface px-3 text-[13.5px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">General note</option>
            {sessions.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <input type="hidden" name="sessionKey" value={sessionKey ?? ""} />
      )}
      <div>
        <Label htmlFor={`title-${formKey}`}>Title</Label>
        <Input id={`title-${formKey}`} name="title" defaultValue={note?.title} required maxLength={160} placeholder="e.g. Why caches work" className="mt-1.5" />
      </div>
      <div>
        <Label htmlFor={`body-${formKey}`}>Note</Label>
        <textarea
          id={`body-${formKey}`}
          name="body"
          defaultValue={note?.body}
          required
          rows={note ? 8 : 5}
          maxLength={20000}
          placeholder="Explain it in your own words. Writing it yourself is what makes it stick."
          className="mt-1.5 w-full resize-y rounded-xl border border-border-strong bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || !canSave} title={!canSave ? saveHint : undefined}>
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Save aria-hidden />} {note ? "Save changes" : "Save note"}
        </Button>
        {note && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={deleting || !canSave}
            onClick={() => {
              if (window.confirm("Delete this note? This cannot be undone.")) startDelete(async () => void (await deleteNote(note.id)));
            }}
          >
            <Trash2 aria-hidden /> Delete
          </Button>
        )}
        {state.ok && state.savedAt && <span className="text-[12.5px] text-success">Saved.</span>}
        {state.error && <span className="text-[12.5px] text-danger">{state.error}</span>}
        {!canSave && saveHint && <span className="text-[12px] text-subtle">{saveHint}</span>}
      </div>
    </form>
  );
}
