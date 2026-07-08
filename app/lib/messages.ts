// Customer-facing SMS templates. Sent from GHL, triggered by HCP job events.
// Keep this copy in sync with the onboarding SOP + Slack playbook.

export type JobContext = {
  firstName?: string | null;
  cleanerFirst?: string | null;
  start?: Date | null;
  arrivalWindowMin?: number | null;
  newStart?: Date | null;
};

const TZ = 'America/New_York';

function fmtDay(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ }).format(d);
}
function fmtTime(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).format(d);
}

// Sent on job.scheduled
export function scheduledMsg(c: JobContext): string {
  const when = c.start ? `${fmtDay(c.start)} at ${fmtTime(c.start)}` : 'your scheduled date';
  return `Hi ${c.firstName ?? 'there'}! Your cleaning with Connect Cleaning is booked for ${when}. Need to change anything? Just reply here — see you then! 🧼`;
}

// Sent on job.on_my_way
export function onMyWayMsg(c: JobContext): string {
  const who = c.cleanerFirst || 'your Connect Cleaning pro';
  const win = c.arrivalWindowMin ? `, arriving within about ${c.arrivalWindowMin} min` : '';
  return `Hi ${c.firstName ?? 'there'}, ${who} is on the way${win}. Reply here if you need anything!`;
}

// Sent on job.completed (the GHL review + referral sequences fire on a delay after this)
export function completedMsg(c: JobContext): string {
  return `All done, ${c.firstName ?? 'there'} — thanks for choosing Connect Cleaning! ✨ If anything wasn't perfect, reply here and we'll make it right.`;
}

// Sent on appointment.rescheduled
export function rescheduledMsg(c: JobContext): string {
  const when = c.newStart ? `${fmtDay(c.newStart)} at ${fmtTime(c.newStart)}` : 'a new time';
  return `Hi ${c.firstName ?? 'there'}, your Connect Cleaning appointment has been moved to ${when}. Reply here with any questions!`;
}
