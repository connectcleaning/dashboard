/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { logEvent } from '../../../lib/hub';
import { sendSmsToPhone, markJobCompleted } from '../../../lib/ghl';
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

function getJob(payload: any): any {
  return payload?.job ?? payload?.data?.job ?? payload?.data ?? payload ?? {};
}
function getEventType(payload: any): string | undefined {
  return payload?.event ?? payload?.type ?? payload?.event_type;
}
function firstPhone(customer: any): string | undefined {
  return customer?.mobile_number || customer?.home_number || customer?.work_number || undefined;
}

// HCP allows only one webhook URL, so the hub becomes the single front door and
// re-emits the events your existing Zapier flows expect. Only forward the event
// types Zapier is set up for (default: job.completed → completed-jobs sheet), so
// enabling more events for the hub never sends Zapier anything it didn't get before.
async function forwardToZapier(rawBody: string, eventType?: string): Promise<any> {
  const url = process.env.ZAPIER_FORWARD_URL;
  if (!url) return { forwarded: false, reason: 'not_configured' };
  const events = (process.env.ZAPIER_FORWARD_EVENTS || 'job.completed').split(',').map((s) => s.trim());
  if (!eventType || !events.includes(eventType)) return { forwarded: false, reason: 'event_not_forwarded' };
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: rawBody });
    return { forwarded: true, status: res.status };
  } catch (e: any) {
    return { forwarded: false, error: String(e?.message ?? e) };
  }
}

export async function POST(req: NextRequest) {
  // Optional shared-secret gate (opt-in). Real HCP signature verification, using
  // the Signing Secret, gets wired once we confirm the header from a live event.
  if (process.env.HCP_REQUIRE_TOKEN === 'true') {
    const provided = req.nextUrl.searchParams.get('token') || req.headers.get('x-webhook-token');
    if (provided !== process.env.HCP_WEBHOOK_SECRET) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const rawBody = await req.text();
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const eventType = getEventType(payload);
  const job = getJob(payload);
  const externalId = job?.id ?? payload?.id ?? null;
  const dryRun = process.env.HUB_DRY_RUN === 'true';

  // Keep the existing Zapier → Google Sheet automation alive.
  const forward = await forwardToZapier(rawBody, eventType);

  // Capture request headers so we can confirm HCP's signature scheme and turn on
  // real verification next.
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k] = v; });

  let action = 'ignored';
  let detail: Record<string, any> = { eventType, dryRun, forward, headers };

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

        if (dryRun) {
          // Log what we *would* do without touching GHL — safe validation.
          action = 'dry_run';
          detail.intended = { message, stageMove: kind === 'completed' };
        } else {
          const result = await sendSmsToPhone(phone, message);
          action = result.ok ? 'sent_sms' : 'error';
          detail = { ...detail, ...result, message };

          // On completion, advance the GHL opportunity → "Job Completed (Won)",
          // which fires the review + referral sequences.
          if (kind === 'completed' && result.ok && result.contactId) {
            try {
              detail.stage_move = await markJobCompleted(result.contactId);
            } catch (e: any) {
              detail.stage_move = { moved: false, error: String(e?.message ?? e) };
            }
          }
        }
      }
    }
  } catch (err: any) {
    action = 'error';
    detail.error = String(err?.message ?? err);
  }

  // Always log; never throw back to HCP (avoids webhook retry storms).
  try {
    await logEvent({ source: 'hcp', event_type: eventType ?? null, external_id: externalId, payload, action, action_detail: detail });
  } catch {
    /* swallow logging errors */
  }

  return NextResponse.json({ ok: true, action });
}
