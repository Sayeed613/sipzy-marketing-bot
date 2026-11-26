import { getDb } from '../db/index.js';
import { listLeads, readLead, findDuplicateLeadIds } from './leads.js';
import {
  checkOutreachAllowed,
  findSuppressionForContact,
  normalizeEmail,
  normalizePhone,
  phoneMatchVariants,
} from './suppressions.js';

/**
 * SIPZY Marketing Bot - Outreach Readiness Service
 *
 * A lead is outreach-ready only when it is not on the suppression list and
 * none of its enquiries ended in an opt-out. No message is ever sent here;
 * this module exists so any future sender can ask first.
 */

/**
 * Ids of leads that have at least one opted-out enquiry (covers anonymous
 * opt-outs where no phone or email was captured).
 * @returns {Set<string>}
 */
function getOptedOutLeadIds() {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT lead_id FROM enquiries
       WHERE enquiry_status = 'opted-out' AND lead_id IS NOT NULL AND lead_id <> ''`
    )
    .all();
  return new Set(rows.map((row) => row.lead_id));
}

/**
 * Add suppression flags to lead rows.
 * @param {Array} leads
 * @returns {Array}
 */
function decorateLeads(leads) {
  const suppressions = getDb()
    .prepare('SELECT * FROM contact_suppressions ORDER BY created_at ASC')
    .all();
  const optedOutLeadIds = getOptedOutLeadIds();

  // Index every stored spelling so a lead written as `+91 98765 43210`
  // matches a `9876543210` record (and vice versa), not just the exact
  // canonical digits. Oldest suppression wins when duplicates exist.
  const byPhone = new Map();
  const byEmail = new Map();
  for (const row of suppressions) {
    for (const variant of phoneMatchVariants(row.phone)) {
      if (!byPhone.has(variant)) byPhone.set(variant, row);
    }
    const rowEmail = normalizeEmail(row.email);
    if (rowEmail && !byEmail.has(rowEmail)) byEmail.set(rowEmail, row);
  }

  return leads.map((lead) => {
    const phone = normalizePhone(lead.phone);
    const email = normalizeEmail(lead.email);
    const match = (phone && byPhone.get(phone)) || (email && byEmail.get(email)) || null;
    const blockedByEnquiry = optedOutLeadIds.has(lead.id);

    return {
      ...lead,
      suppressed: Boolean(match) || blockedByEnquiry,
      suppression_reason: match?.reason || (blockedByEnquiry ? 'opted_out' : null),
      suppression_id: match?.id || null,
    };
  });
}

/**
 * All leads with suppression flags. `excludeSuppressed` is what the
 * outreach-ready list uses.
 * @param {{ status?: string, excludeSuppressed?: boolean }} [filters]
 * @returns {Array}
 */
function listLeadsWithSuppression(filters = {}) {
  const decorated = decorateLeads(listLeads(filters));
  let result = filters.excludeSuppressed
    ? decorated.filter((lead) => !lead.suppressed)
    : decorated;
  if (filters.duplicatesOnly) {
    const duplicateIds = findDuplicateLeadIds();
    result = result.filter((lead) => duplicateIds.has(lead.id));
  }
  return result;
}

/**
 * The list any future outreach campaign is allowed to use.
 * @returns {Array}
 */
function listOutreachReadyLeads() {
  return listLeadsWithSuppression({ excludeSuppressed: true }).filter((lead) => {
    if (lead.verification_status !== 'verified') return false;
    const approved = lead.approved_for_outreach === true || lead.approved_for_outreach === 1 || lead.approved_for_outreach === '1';
    return approved;
  });
}

/**
 * Check a single lead before outreach.
 * @param {string} leadId
 * @returns {Object|null} null when the lead does not exist
 */
function checkLeadOutreach(leadId) {
  const lead = readLead(leadId);
  if (!lead) return null;

  const result = checkOutreachAllowed({
    phone: lead.phone,
    email: lead.email,
    lead_id: lead.id,
  });

  if (!result.allowed) return { lead, ...result };
  if (lead.verification_status !== 'verified') {
    return { lead, ...result, allowed: false, reason: 'not_verified' };
  }
  const approved = lead.approved_for_outreach === true || lead.approved_for_outreach === 1 || lead.approved_for_outreach === '1';
  if (!approved) {
    return { lead, ...result, allowed: false, reason: 'not_approved_for_outreach' };
  }

  // WhatsApp promotional outreach requires explicit opt-in.
  const whatsappOptedIn =
    lead.whatsapp_opt_in === true ||
    lead.whatsapp_opt_in === 1 ||
    lead.whatsapp_opt_in === '1';
  if (!whatsappOptedIn) {
    return { lead, ...result, allowed: false, reason: 'no_whatsapp_opt_in' };
  }

  return { lead, ...result };
}

/**
 * Counts used by the dashboard.
 * @returns {{ suppressedContacts: number, outreachReadyLeads: number }}
 */
function outreachStats() {
  return {
    suppressedContacts: getDb()
      .prepare('SELECT COUNT(*) AS n FROM contact_suppressions')
      .get().n,
    outreachReadyLeads: listOutreachReadyLeads().length,
  };
}

export {
  getOptedOutLeadIds,
  decorateLeads,
  listLeadsWithSuppression,
  listOutreachReadyLeads,
  checkLeadOutreach,
  outreachStats,
  findSuppressionForContact,
};
