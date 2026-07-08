/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { logEvent } from '../../../lib/hub';
import { sendSmsToPhone } from '../../../lib/ghl';
import { scheduledMsg, onMyWayMsg, completedMsg, rescheduledMsg, type JobContext } from '../../../lib/messages';

export const dynamic = 'force-dynamic';

// HCP events that trigger a customer text.
const HANDLED: Record<string, 'scheduled' | 'on_my_way' | 'completed' | 'rescheduled'> = {
  'job.scheduled': 'scheduled',
  'job.on_my_way': 'on_my_way',
  'job.completed': 'completed',
  'job.appointment.rescheduled': 'rescheduled',
  'appointment.rescheduled': 'rescheduled',
};

// HCP wraps the job object differently across event types — try the common
// spots. Once we see real payloads in hub.events we tighten this.
function getJob(payload: any): any {
  return payload?.job ?? payload?.data?.job ?? payload?.data ?? payload ?? {};
}
function getEventType(payload: any): string | undefined {
  return payload?.event ?? payload?.type ?? payload?.event_type;
}
function firstPhone(customer: any): string | undefined {
  return customer?.mobile_number || customer?.home_number || customer?.work_number || undefined;
}

export async function POST(req: NextRequest) {
  // Shared-secret gate: set HCP_WEBHOOK_SECRET and add ?token=<secret> to the
  // webhook URL in HCP (or send it as an x-webhook-token header).
  const secret = process.env.HCP_WEBHOOK_SECRET;
  if (secret) {
    const provided = req.nextUrl.searchParams.get('token') || req.headers.get('x-webhook-token');
    if (provided !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const eventType = getEventType(payload);
  const job = getJob(payload);
  const externalId = job?.id ?? payload?.id ?? null;

  let action = 'ignored';
  let detail: Record<string, any> = { eventType };

  try {
    const kind = eventType ? HANDLED[eventType] : undefined;
    if (kind) {
      const customer = job?.customer ?? {};
      const phone = firstPhone(customer);
      const tags: string[] = Array.isArray(job?.tags) ? job.tags : [];
      const optedOut = customer?.notifications_enabled === false || customer?.notifications_enabled === 'false';
      const noText = tags.map((t) => String(t).toLowerCase()).includes('no-text');

      if (optedOut) {
        action = 'suppressed_opt_out';
      } else if (noText) {
        action = 'suppressed_no_text';
      } else if (!phone) {
        action = 'error';
        detail.reason = 'no_phone';
      } else {
        const start = job?.schedule?.scheduled_start ? new Date(job.schedule.scheduled_start) : null;
        const ctx: JobContext = {
          firstName: customer?.first_name,
          cleanerFirst: job?.assigned_employees?.[0]?.first_name,
          start,
          arrivalWindowMin: job?.schedule?.arrival_window ?? null,
          newStart: start,
        };
        const message =
          kind === 'scheduled' ? scheduledMsg(ctx)
          : kind === 'on_my_way' ? onMyWayMsg(ctx)
          : kind === 'completed' ? completedMsg(ctx)
          : rescheduledMsg(ctx);

        const result = await sendSmsToPhone(phone, message);
        action = result.ok ? 'sent_sms' : 'error';
        detail = { ...detail, ...result, message };
      }
    }
  } catch (err: any) {
    action = 'error';
    detail.error = String(err?.message ?? err);
  }

  // Always log — and never throw back to HCP, so a downstream failure doesn't
  // trigger webhook retry storms.
  try {
    await logEvent({ source: 'hcp', event_type: eventType ?? null, external_id: externalId, payload, action, action_detail: detail });
  } catch {
    /* swallow logging errors */
  }

  return NextResponse.json({ ok: true, action });
}
