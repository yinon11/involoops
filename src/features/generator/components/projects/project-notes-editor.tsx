"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Pencil } from "lucide-react";
import { updateProject } from "@/features/generator/actions/project-actions";
import { useT } from "@/lib/i18n/client";

interface ProjectNotesLabels {
  noNotesYet: string;
  notesPh: string;
  saveNotes: string;
  cancelNotes: string;
}

interface ProjectNotesEditorProps {
  projectId: string;
  initialNotes: string | null;
  labels: ProjectNotesLabels;
}

export function ProjectNotesEditor({
  projectId,
  initialNotes,
  labels,
}: ProjectNotesEditorProps) {
  const dict = useT();
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      await updateProject(projectId, { notes: notes.trim() || null });
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <div className="group relative min-h-[60px]">
        {notes ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {notes}
          </p>
        ) : (
          <p className="text-sm italic text-slate-400">{labels.noNotesYet}</p>
        )}
        <button
          onClick={() => setEditing(true)}
          className="absolute end-0 top-0 flex h-6 w-6 items-center justify-center rounded-md text-slate-300 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100"
          aria-label={dict.common.edit}
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        autoFocus
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full rounded-lg border border-slate-200 p-2.5 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        placeholder={labels.notesPh}
      />
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          {labels.saveNotes}
        </button>
        <button
          onClick={() => {
            setNotes(initialNotes ?? "");
            setEditing(false);
          }}
          disabled={isPending}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100"
        >
          {labels.cancelNotes}
        </button>
      </div>
    </div>
  );
}
