// Elapsed time, in whole seconds, between two instants.
export function durationSeconds(startIso: string, endIso: string | null, now: number): number {
  const end = endIso ? Date.parse(endIso) : now
  return Math.max(0, Math.floor((end - Date.parse(startIso)) / 1000))
}

// "2:05" — hours and minutes, the unit a day's work is read in. Seconds are
// left out on purpose: they'd churn on every tick without telling the user
// anything, except on the entry still running (see formatRunning).
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}:${String(minutes).padStart(2, '0')}`
}

// "2:05:31" — used only for the entry currently running, where a ticking
// seconds column is the point.
export function formatRunning(seconds: number): string {
  return `${formatDuration(seconds)}:${String(seconds % 60).padStart(2, '0')}`
}

// Decimal hours, rounded to two places — what a spreadsheet wants to
// multiply by an hourly rate. Exported alongside the H:MM column.
export function decimalHours(seconds: number): string {
  return (seconds / 3600).toFixed(2)
}
