"use client";

import { z } from "zod";
import { getUserStorageKey } from "./userStorage";

export const REMINDERS_KEY = "studyrunway.reminders";
export const REMINDERS_CHANGE_EVENT = "studyrunway:reminders-changed";
export const OPEN_REMINDER_EVENT = "studyrunway:open-reminder";

const ReminderSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  remindAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
  notifiedAt: z.string().datetime({ offset: true }).nullable(),
});

export type Reminder = z.infer<typeof ReminderSchema>;

function notifyChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(REMINDERS_CHANGE_EVENT));
  }
}

export function loadReminders(): Reminder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(getUserStorageKey(REMINDERS_KEY));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ReminderSchema.safeParse(item))
      .filter((item) => item.success)
      .map((item) => item.data)
      .sort((a, b) => Date.parse(a.remindAt) - Date.parse(b.remindAt));
  } catch {
    return [];
  }
}

export function createReminder(title: string, remindAt: string): Reminder {
  const parsedDate = new Date(remindAt);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.getTime() <= Date.now()) {
    throw new Error("Choose a reminder time in the future.");
  }
  const parsed = ReminderSchema.parse({
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `reminder_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    title: title.trim(),
    remindAt: parsedDate.toISOString(),
    createdAt: new Date().toISOString(),
    notifiedAt: null,
  });
  const reminders = [...loadReminders(), parsed];
  window.localStorage.setItem(getUserStorageKey(REMINDERS_KEY), JSON.stringify(reminders));
  notifyChanged();
  return parsed;
}

export function deleteReminder(id: string): void {
  const next = loadReminders().filter((reminder) => reminder.id !== id);
  window.localStorage.setItem(getUserStorageKey(REMINDERS_KEY), JSON.stringify(next));
  notifyChanged();
}

/** Send due browser notifications once; notifications never include financial details. */
export function notifyDueReminders(): number {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return 0;
  }
  let sent = 0;
  for (const reminder of loadReminders()) {
    if (reminder.notifiedAt || Date.parse(reminder.remindAt) > Date.now()) continue;
    try {
      const notification = new Notification("StudyRunway reminder", {
        body: "You have a student-finance reminder in StudyRunway.",
        tag: `studyrunway-${reminder.id}`,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      const next = loadReminders().map((item) =>
        item.id === reminder.id
          ? { ...item, notifiedAt: new Date().toISOString() }
          : item,
      );
      window.localStorage.setItem(getUserStorageKey(REMINDERS_KEY), JSON.stringify(next));
      sent += 1;
    } catch {
      // Leave it due in the list if the browser rejected this notification.
    }
  }
  if (sent) notifyChanged();
  return sent;
}

/** Action plans can open the reminder form with a grounded title. */
export function requestReminder(title: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(OPEN_REMINDER_EVENT, {
      detail: { title: title.slice(0, 120) },
    }),
  );
}
