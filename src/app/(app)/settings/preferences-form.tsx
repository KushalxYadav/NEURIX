"use client";

import { Check, Loader2 } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

import { saveStudyPreferences, type PreferencesState } from "./actions";

export interface PreferencesDefaults {
  subjectId: string;
  examTitle: string;
  examDate: string;
  dailyMinutes: string;
  knowledgeLevel: string;
  preferredTime: string;
}

export function PreferencesForm({ defaults, disabled }: { defaults: PreferencesDefaults; disabled: boolean }) {
  const [state, action, pending] = useActionState<PreferencesState, FormData>(saveStudyPreferences, {});
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="subjectId" value={defaults.subjectId} />
      <fieldset disabled={disabled || pending} className="contents">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="examTitle">Exam</Label>
          <Input id="examTitle" name="examTitle" defaultValue={defaults.examTitle} maxLength={200} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="examDate">Exam date</Label>
          <Input id="examDate" name="examDate" type="date" defaultValue={defaults.examDate} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dailyMinutes">Daily study time (minutes)</Label>
          <Input id="dailyMinutes" name="dailyMinutes" type="number" min={10} max={720} step={5} defaultValue={defaults.dailyMinutes} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="knowledgeLevel">Current knowledge</Label>
          <Select id="knowledgeLevel" name="knowledgeLevel" defaultValue={defaults.knowledgeLevel}>
            <option value="">Not set</option>
            <option value="none">Starting from zero</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="preferredTime">Preferred study time</Label>
          <Select id="preferredTime" name="preferredTime" defaultValue={defaults.preferredTime}>
            <option value="">Not set</option>
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
            <option value="evening">Evening</option>
            <option value="night">Night</option>
            <option value="flexible">Flexible</option>
          </Select>
        </div>
        <div className="flex items-end gap-3">
          <Button type="submit">
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            Save
          </Button>
          <span aria-live="polite" className="text-[13px]">
            {state.error && <span className="text-danger">{state.error}</span>}
            {state.saved && (
              <span className="inline-flex items-center gap-1 text-success">
                <Check aria-hidden className="size-4" /> Saved
              </span>
            )}
          </span>
        </div>
      </fieldset>
    </form>
  );
}
