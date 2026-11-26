/**
 * SIPZY Marketing Bot — Outreach Composer Service
 *
 * Generates a personalized introductory WhatsApp message for a lead using
 * local logic only. No AI/LLM calls, no paid API usage.
 *
 * The message is a short, friendly introduction that references what we know
 * about the business and invites a conversation — never a pushy sales pitch.
 */

/** Build a personalized introductory WhatsApp message for a lead. */
export function buildIntroMessage(lead) {
  const business = lead.business_name?.trim() || 'your business';
  const category = lead.business_cat?.trim() || 'your industry';
  const city = lead.city?.trim() || '';
  const contact = lead.contact_person?.trim() || '';
  const phone = lead.phone?.trim() || '';

  // Short, friendly, non-pushy intro referencing the business.
  // Keep it under WhatsApp's 4096 char limit with room to spare.
  const lines = [
    `Hi${contact ? `, ${contact}` : ''} — this is SIPZY.`,
    `I came across ${business}${city ? ` in ${city}` : ''} and wanted to introduce ourselves.`,
    `SIPZY makes foldable paper cups for cafés, restaurants and beverage outlets like yours —`,
    `collapsible, space-saving cups in 250 ml, 350 ml and 450 ml for both hot and cold drinks.`,
    `Would you be open to a quick chat about your cup needs? No pressure at all.`,
  ];

  return lines.join(' ').trim();
}

/** Check that a lead is eligible for outreach using the existing guards. */
export function canComposeForLead(lead) {
  if (!lead) return { allowed: false, reason: 'lead_not_found' };
  if (!lead.phone) return { allowed: false, reason: 'no_phone' };

  // Reuse the same rules as the rest of the platform:
  // - not suppressed
  // - no opted-out enquiry
  // - verified
  // - approved for outreach
  const verification = lead.verification_status;
  if (verification !== 'verified') {
    return { allowed: false, reason: 'not_verified' };
  }

  const approved =
    lead.approved_for_outreach === true ||
    lead.approved_for_outreach === 1 ||
    lead.approved_for_outreach === '1';
  if (!approved) {
    return { allowed: false, reason: 'not_approved_for_outreach' };
  }

  if (lead.suppressed) {
    return { allowed: false, reason: 'contact_suppressed' };
  }

  return { allowed: true, reason: null };
}

/** Normalize a phone for the wa.me link (digits only, with country code if present). */
export function phoneForWhatsAppLink(phone) {
  if (!phone) return '';
  // Strip everything except digits, +, and spaces; then collapse.
  let cleaned = String(phone).replace(/[^\d+]/g, '');
  if (!cleaned) return '';

  // If there is no '+' and the number looks like an Indian mobile (10 digits
  // starting 6-9), prepend the country code so the link works for Indian numbers.
  if (!cleaned.startsWith('+') && /^[6-9]\d{9}$/.test(cleaned)) {
    cleaned = `+91${cleaned}`;
  } else if (!cleaned.startsWith('+')) {
    cleaned = `+${cleaned}`;
  }

  return cleaned;
}
