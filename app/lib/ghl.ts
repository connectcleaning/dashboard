// Minimal GoHighLevel (LeadConnector) API v2 client — just what the hub needs
// to send an SMS from a customer's GHL conversation. Credentials come from env
// (GHL_API_TOKEN, GHL_LOCATION_ID) and are only present in the deployed app.

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

function ghlHeaders(): Record<string, string> {
  const token = process.env.GHL_API_TOKEN;
  if (!token) throw new Error('GHL_API_TOKEN is not set');
  return {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// Look up a GHL contact by phone number. Returns the contact id, or null if we
// can't find them in GHL yet (that gap closes with the Phase-2 customer sync).
export async function findContactIdByPhone(phone: string): Promise<string | null> {
  const locationId = process.env.GHL_LOCATION_ID;
  if (!locationId) throw new Error('GHL_LOCATION_ID is not set');
  const url = `${GHL_BASE}/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(phone)}`;
  const res = await fetch(url, { headers: ghlHeaders() });
  if (!res.ok) throw new Error(`GHL contact lookup failed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const contacts: Array<{ id?: string }> = data?.contacts ?? [];
  return contacts[0]?.id ?? null;
}

// Send an SMS to a contact's conversation.
export async function sendSms(contactId: string, message: string): Promise<void> {
  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify({ type: 'SMS', contactId, message }),
  });
  if (!res.ok) throw new Error(`GHL send failed ${res.status}: ${await res.text()}`);
}

export type SendResult = { ok: boolean; contactId?: string; reason?: string };

// Resolve a phone to a GHL contact and text them.
export async function sendSmsToPhone(phone: string, message: string): Promise<SendResult> {
  const contactId = await findContactIdByPhone(phone);
  if (!contactId) return { ok: false, reason: 'contact_not_found' };
  await sendSms(contactId, message);
  return { ok: true, contactId };
}

// Resi sales pipeline + its "Job Completed (Won)" stage. Overridable via env,
// with the current live IDs as defaults (confirmed from the synced data).
const RESI_PIPELINE_ID = process.env.GHL_RESI_PIPELINE_ID || 'WjrJyJ3siUlQKxzvGRxg';
const JOB_COMPLETED_STAGE_ID = process.env.GHL_JOB_COMPLETED_STAGE_ID || '337a7ecc-1d9f-45dc-9528-cdfa73d81082';

type Opportunity = { id: string; pipelineId?: string; pipelineStageId?: string; status?: string };

async function findResiOpportunity(contactId: string): Promise<Opportunity | null> {
  const locationId = process.env.GHL_LOCATION_ID;
  if (!locationId) throw new Error('GHL_LOCATION_ID is not set');
  const url = `${GHL_BASE}/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(contactId)}`;
  const res = await fetch(url, { headers: ghlHeaders() });
  if (!res.ok) throw new Error(`GHL opportunity search failed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const opps: Opportunity[] = data?.opportunities ?? [];
  return opps.find((o) => o.pipelineId === RESI_PIPELINE_ID) ?? opps[0] ?? null;
}

export type StageMoveResult = { moved: boolean; opportunityId?: string; reason?: string };

// Advance the customer's resi opportunity to "Job Completed (Won)" — the single
// trigger the GHL review + referral automations hang off. No-op if it's already
// there, so a recurring customer isn't re-asked on every visit.
export async function markJobCompleted(contactId: string): Promise<StageMoveResult> {
  const opp = await findResiOpportunity(contactId);
  if (!opp) return { moved: false, reason: 'no_opportunity' };
  if (opp.pipelineStageId === JOB_COMPLETED_STAGE_ID) return { moved: false, opportunityId: opp.id, reason: 'already_completed' };
  const res = await fetch(`${GHL_BASE}/opportunities/${encodeURIComponent(opp.id)}`, {
    method: 'PUT',
    headers: ghlHeaders(),
    body: JSON.stringify({ pipelineId: RESI_PIPELINE_ID, pipelineStageId: JOB_COMPLETED_STAGE_ID }),
  });
  if (!res.ok) throw new Error(`GHL opportunity update failed ${res.status}: ${await res.text()}`);
  return { moved: true, opportunityId: opp.id };
}
