"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Bell } from "lucide-react";
import {
  createReminder,
  deleteReminder,
  loadReminders,
  notifyDueReminders,
  OPEN_REMINDER_EVENT,
  REMINDERS_CHANGE_EVENT,
  type Reminder,
} from "@/lib/reminders";

type BrowserPermission = "default" | "granted" | "denied" | "unsupported";

function localDateTimeInputValue(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function ReminderCenter() {
  const [open, setOpen] = useState(false);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [title, setTitle] = useState("");
  const [remindAt, setRemindAt] = useState("");
  const [permission, setPermission] = useState<BrowserPermission>("default");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      setReminders(loadReminders());
      setPermission(
        "Notification" in window ? Notification.permission : "unsupported",
      );
    };
    const openForAction = (event: Event) => {
      const detail = (event as CustomEvent<{ title?: string }>).detail;
      if (detail?.title) setTitle(detail.title.slice(0, 120));
      setRemindAt("");
      setError(null);
      setNotice(null);
      setOpen(true);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    refresh();
    window.addEventListener(REMINDERS_CHANGE_EVENT, refresh);
    window.addEventListener(OPEN_REMINDER_EVENT, openForAction);
    window.addEventListener("storage", refresh);
    window.addEventListener("keydown", closeOnEscape);
    const timer = window.setInterval(() => {
      notifyDueReminders();
      refresh();
    }, 30_000);
    return () => {
      window.removeEventListener(REMINDERS_CHANGE_EVENT, refresh);
      window.removeEventListener(OPEN_REMINDER_EVENT, openForAction);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("keydown", closeOnEscape);
      window.clearInterval(timer);
    };
  }, []);

  const submitReminder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      if (!title.trim()) throw new Error("Enter what you want to be reminded about.");
      if (!remindAt) throw new Error("Choose a date and time for the reminder.");
      createReminder(title, new Date(remindAt).toISOString());
      setTitle("");
      setRemindAt("");
      setNotice("Reminder saved on this browser.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that reminder.");
    }
  };

  const enableNotifications = async () => {
    if (!("Notification" in window)) return;
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === "granted") {
        notifyDueReminders();
        setNotice("Browser alerts are enabled for this device.");
      } else {
        setNotice("The reminder is saved. Browser alerts were not enabled.");
      }
    } catch {
      setNotice("The browser did not allow notification permission to be requested.");
    }
  };

  const activeCount = reminders.filter((reminder) => !reminder.notifiedAt).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="studyrunway-reminder-center"
        aria-label={activeCount > 0 ? `${activeCount} active reminders` : "Reminders"}
        className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--sr-line)] px-2.5 py-1.5 text-xs font-medium text-[var(--sr-ink)]/70 transition hover:bg-[var(--sr-mist)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)] sm:px-3"
      >
        <Bell size={14} aria-hidden="true" />
        <span className="hidden sm:inline">Reminders</span>
        {activeCount > 0 && <span aria-hidden="true">{activeCount}</span>}
      </button>

      {open && (
        <section
          id="studyrunway-reminder-center"
          aria-label="Reminders"
          className="fixed right-3 top-14 z-50 w-80 max-w-[calc(100vw_-_1.5rem)] rounded-2xl border border-[var(--sr-line)] bg-[var(--sr-paper)] p-4 text-left shadow-xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold">Reminders</h2>
              <p className="mt-1 text-xs leading-relaxed text-[var(--sr-ink)]/60">
                Saved on this browser. Alerts can fire while StudyRunway is open;
                they do not run after you close the app.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close reminders"
              className="rounded-lg px-2 py-1 text-sm text-[var(--sr-ink)]/60 hover:bg-[var(--sr-mist)]"
            >
              Close
            </button>
          </div>

          {permission === "default" && (
            <button
              type="button"
              onClick={() => void enableNotifications()}
              className="mt-3 rounded-xl border border-[var(--sr-pine)]/30 bg-[var(--sr-pine)]/5 px-3 py-2 text-xs font-semibold text-[var(--sr-pine)] hover:bg-[var(--sr-pine)]/10"
            >
              Enable browser alerts
            </button>
          )}
          {permission === "denied" && (
            <p className="mt-3 text-xs text-[var(--sr-ink)]/60">
              Browser alerts are blocked. You can still view due reminders here;
              change this site&apos;s notification permission in browser settings.
            </p>
          )}
          {permission === "unsupported" && (
            <p className="mt-3 text-xs text-[var(--sr-ink)]/60">
              This browser does not support notifications. Saved reminders remain
              visible here.
            </p>
          )}
          {permission === "granted" && (
            <p className="mt-3 text-xs text-[var(--sr-pine)]">
              Browser alerts are enabled on this device.
            </p>
          )}

          <form onSubmit={submitReminder} className="mt-4 space-y-2.5">
            <label className="block text-xs font-medium">
              Reminder
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                required
                placeholder="e.g. Follow up about tuition instalments"
                className="mt-1 w-full rounded-xl border border-[var(--sr-line)] bg-white/80 px-3 py-2 text-sm outline-none focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/20"
              />
            </label>
            <label className="block text-xs font-medium">
              Remind me at (your local time)
              <input
                type="datetime-local"
                value={remindAt}
                min={localDateTimeInputValue()}
                onChange={(event) => setRemindAt(event.target.value)}
                required
                className="mt-1 w-full rounded-xl border border-[var(--sr-line)] bg-white/80 px-3 py-2 text-sm outline-none focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/20"
              />
            </label>
            <button
              type="submit"
              className="w-full rounded-xl bg-[var(--sr-pine)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--sr-pine)]/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)]"
            >
              Save reminder
            </button>
          </form>

          {error && <p className="mt-2 text-xs text-[var(--sr-clay)]" role="alert">{error}</p>}
          {notice && <p className="mt-2 text-xs text-[var(--sr-pine)]" role="status">{notice}</p>}

          <ul className="mt-4 max-h-56 space-y-2 overflow-y-auto border-t border-[var(--sr-line)] pt-3">
            {reminders.length === 0 ? (
              <li className="text-xs text-[var(--sr-ink)]/50">No reminders saved yet.</li>
            ) : reminders.map((reminder) => {
              const due = Date.parse(reminder.remindAt) <= Date.now();
              return (
                <li key={reminder.id} className="flex items-start justify-between gap-3 rounded-xl bg-white/65 p-2.5">
                  <div className="min-w-0">
                    <p className="break-words text-xs font-semibold">{reminder.title}</p>
                    <p className="mt-1 text-[11px] text-[var(--sr-ink)]/55">
                      {new Date(reminder.remindAt).toLocaleString()} · {reminder.notifiedAt ? "Alert sent" : due ? "Due now" : "Scheduled"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteReminder(reminder.id)}
                    aria-label={`Delete reminder: ${reminder.title}`}
                    className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-[var(--sr-clay)] hover:bg-[var(--sr-clay)]/10"
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
