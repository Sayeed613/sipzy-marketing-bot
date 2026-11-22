/**
 * SIPZY Marketing Bot — Local Message Analyzer
 *
 * A deterministic, rule-based first-stage parser for incoming customer
 * messages. It does NOT call any AI/LLM API and does NOT send messages.
 *
 * Design rules:
 *  - Never invent data: anything not clearly present in the message is null.
 *  - Conservative extraction: a field is only filled when the pattern is
 *    unambiguous; ambiguous cases stay null.
 *  - A message can never imply a confirmed order.
 *  - Opt-out language always wins over every other intent.
 *
 * This module is pure (no DB, no network) so it can be unit tested and
 * later swapped for a smarter engine behind the same output contract.
 */

const PARSER_VERSION = 'local-rules-v1';

const INTENTS = [
  'interested',
  'quote_requested',
  'sample_requested',
  'more_information_requested',
  'follow_up_requested',
  'not_interested',
  'opted_out',
  'general_enquiry',
  'unknown',
];

const INTENT_LABELS = {
  interested: 'Interested',
  quote_requested: 'Quote requested',
  sample_requested: 'Sample requested',
  more_information_requested: 'More information requested',
  follow_up_requested: 'Follow-up requested',
  not_interested: 'Not interested',
  opted_out: 'Opted out',
  general_enquiry: 'General enquiry',
  unknown: 'Unknown',
};

/** Maps a primary intent onto an enquiry_status in the SIPZY pipeline. */
const INTENT_TO_STATUS = {
  interested: 'interest-requested',
  quote_requested: 'quote-requested',
  sample_requested: 'sample-requested',
  more_information_requested: 'more-info-requested',
  follow_up_requested: 'new',
  not_interested: 'not-interested',
  opted_out: 'opted-out',
  general_enquiry: 'new',
  unknown: 'new',
};

const FIELD_LABELS = {
  customer_name: 'Customer name',
  business_name: 'Business name',
  product_type: 'Product type',
  cup_size: 'Cup size',
  quantity: 'Quantity',
  delivery_location: 'Delivery location',
};

const VALID_SIZES = ['250ml', '350ml', '500ml'];
const VALID_PRODUCT_TYPES = ['Hot', 'Cold'];

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Collapse whitespace so patterns behave consistently across line breaks. */
function normalize(text) {
  return String(text ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function cleanCapture(value) {
  if (!value) return null;
  let out = String(value)
    .replace(/[\s,.;:!?)"']+$/g, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .trim();
  // Drop trailing filler that is not part of a place/business name.
  out = out
    .replace(/\s+(?:please|thanks|thank you|asap|soon|now|today|tomorrow|next week|next month)$/i, '')
    .replace(/\s+by\s+.*$/i, '')
    .trim();
  if (out.length < 2 || out.length > 60) return null;
  return out;
}

/** Words that must never be interpreted as a person's name. */
const NAME_STOPWORDS = new Set([
  'interested', 'looking', 'not', 'no', 'yes', 'writing', 'hoping', 'asking', 'sorry',
  'just', 'the', 'a', 'an', 'in', 'from', 'with', 'trying', 'reaching', 'getting',
  'wondering', 'requesting', 'enquiring', 'inquiring', 'planning', 'considering',
  'currently', 'also', 'based', 'opening', 'running', 'starting', 'working', 'here',
  'urgent', 'sure', 'afraid', 'still', 'very', 'really', 'ready', 'happy', 'glad',
  'unable', 'looking', 'searching', 'checking', 'emailing', 'messaging', 'texting',
]);

const BUSINESS_KEYWORDS =
  '(?:caf[eé]|coffee|bakery|bakeshop|restaurant|bistro|hotel|resort|bar|pub|kitchen|' +
  'roastery|roasters|store|shop|market|deli|office|company|group|holdings|ltd|limited|' +
  'inc|llc|corp|corporation|enterprises?|supplies|suppliers?|distributors?|foods?|' +
  'events?|catering|university|college|school|coworking)';

// ---------------------------------------------------------------------------
// Intent classification
// ---------------------------------------------------------------------------

/** Explicit opt-out language. Checked first — it overrides everything. */
const OPT_OUT_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bopt[\s-]?out\b/i,
  /\bremove me\b/i,
  /\bdelete my (?:number|details|contact)\b/i,
  /\btake me off\b/i,
  /\bstop (?:messaging|contacting|emailing|texting|calling|sending)\b/i,
  /\b(?:please )?stop\b(?!\s+(?:by|at|in)\b)[.!]?$/i,
  /\bdon'?t (?:message|contact|text|email|call|send)\b/i,
  /\bdo not (?:message|contact|text|email|call|send)\b/i,
  /\bnever (?:message|contact|text|email|call) me\b/i,
  /\bno more (?:messages|emails|calls|contact)\b/i,
];

const NOT_INTERESTED_PATTERNS = [
  /\bnot interested\b/i,
  /\bno interest\b/i,
  /\bnot for us\b/i,
  /\bwe(?:'| a)?re not (?:looking|interested|buying)\b/i,
  /\bnot looking (?:to buy|for cups|for a supplier)\b/i,
  /\bno,? thank(?:s| you)\b/i,
  /\bwe (?:already )?have (?:a|our own|another) supplier\b/i,
  /\bwe don'?t need (?:any )?(?:cups|supplies)\b/i,
];

const QUOTE_PATTERNS = [
  /\bquot(?:e|es|ation|ations)\b/i,
  /\bqoute?s?\b/i,
  /\bpric(?:e|es|ing)\b/i,
  /\brate card\b/i,
  /\bcost(?:s|ing)?\b/i,
  /\bestimate\b/i,
  /\bhow much (?:would|do|does|for|is|are)\b/i,
  /\bper unit\b/i,
];

const QUOTE_NEGATIONS = [
  /\b(?:no|don'?t|do not|not) (?:need|want|require) (?:a |any )?(?:quote|quotation|prices?|pricing)\b/i,
  /\bnot asking for (?:a )?(?:quote|price)\b/i,
];

const SAMPLE_PATTERNS = [
  /\bsamples?\b/i,
  /\btrial (?:order|pack|set|run|cups?)\b/i,
  /\btest (?:order|pack|cups?)\b/i,
  /\bswatch(?:es)?\b/i,
];

const MORE_INFO_PATTERNS = [
  /\bmore (?:information|info|details)\b/i,
  /\b(?:send|share) (?:me )?(?:the |your )?(?:catalogue|catalog|brochure|info|information|details)\b/i,
  /\bcatalogue\b/i,
  /\bcatalog\b/i,
  /\bbrochure\b/i,
  /\bspec(?:ification)?s?\b/i,
  /\btell me more\b/i,
  /\bwhat (?:sizes|products|options|colou?rs)\b/i,
  /\bmoq\b/i,
  /\bminimum order\b/i,
];

const FOLLOW_UP_PATTERNS = [
  /\bfollow[\s-]?up\b/i,
  /\bcall me (?:back|later|next)\b/i,
  /\bget back to me\b/i,
  /\b(?:reach out|contact me|message me|email me) (?:again|later|next week|next month)\b/i,
  /\bcheck back\b/i,
  /\btouch base\b/i,
  /\bcircle back\b/i,
  /\bin (?:a few|couple of) (?:weeks|days)\b/i,
];

const INTERESTED_PATTERNS = [
  /\bint(?:e)?rested\b/i,
  /\b(?:need|want|require)\s+(?:\d[\d,]*|some|a few|several)?\s*(?:hot|cold|paper|coffee|drink)?\s*cups?\b/i,
  /\bwe(?:'d| would) (?:like|love) (?:to )?(?:buy|order|purchase|try)\b/i,
  /\bi(?:'d| would) (?:like|love) (?:to )?(?:buy|order|purchase|try)\b/i,
  /\bwe want to (?:buy|order|purchase)\b/i,
  /\b(?:looking|searching) (?:for|to buy)\b/i,
  /\bkeen (?:on|to)\b/i,
  /\bconsidering\b/i,
  /\bneed (?:some )?cups\b/i,
];

const PRODUCT_HINTS = /\b(?:cups?|cupz|paper cups?|coffee cups?|cold cups?|hot cups?|packaging)\b/i;

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function detectIntent(text) {
  const detected = [];
  const push = (intent) => {
    if (!detected.includes(intent)) detected.push(intent);
  };

  if (matchesAny(text, OPT_OUT_PATTERNS)) push('opted_out');
  if (matchesAny(text, NOT_INTERESTED_PATTERNS)) push('not_interested');

  const quoteNegated = matchesAny(text, QUOTE_NEGATIONS);
  if (!quoteNegated && matchesAny(text, QUOTE_PATTERNS)) push('quote_requested');
  if (matchesAny(text, SAMPLE_PATTERNS)) push('sample_requested');
  if (matchesAny(text, MORE_INFO_PATTERNS)) push('more_information_requested');
  if (matchesAny(text, FOLLOW_UP_PATTERNS)) push('follow_up_requested');
  if (matchesAny(text, INTERESTED_PATTERNS)) push('interested');
  if (PRODUCT_HINTS.test(text) || /\?\s*$/.test(text)) push('general_enquiry');

  // Opt-out beats everything; otherwise keep the most specific intent first.
  const priority = ['opted_out', 'not_interested', 'quote_requested', 'sample_requested',
    'more_information_requested', 'follow_up_requested', 'interested', 'general_enquiry'];

  const primary = priority.find((intent) => detected.includes(intent)) || 'unknown';
  return { intent: primary, detectedIntents: detected };
}

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

/** 250 ml / 250ml / 250-ml / 250 millilitres */
function extractCupSize(text) {
  const match = text.match(/\b(250|350|500)\s*[- ]?\s*(?:ml|m\s?l|millilit(?:re|er)s?)\b/i);
  if (!match) return null;
  const size = `${match[1]}ml`;
  return VALID_SIZES.includes(size) ? size : null;
}

function extractProductType(text) {
  const hot = /\b(?:hot|coffee|tea|espresso|cappuccino|latte|macchiato|mocha|americano)\b(?:\s+(?:drink|beverage))?\s*(?:paper\s+)?cups?\b/i.exec(text);
  const cold = /\b(?:cold|iced|ice|chilled|frozen|smoothie|frapp?e|juice|soda)\b(?:\s+(?:drink|beverage))?\s*(?:paper\s+)?cups?\b/i.exec(text);

  if (hot && cold) {
    return { productType: hot.index <= cold.index ? 'Hot' : 'Cold', note: 'Both hot and cold cups mentioned; used the first one.' };
  }
  if (hot) return { productType: 'Hot', note: null };
  if (cold) return { productType: 'Cold', note: null };

  // Fallback: a bare "cups" plus a temperature word anywhere nearby.
  if (/\bcups?\b/i.test(text)) {
    const hotWord = /\b(hot|coffee|tea|espresso)\b/i.exec(text);
    const coldWord = /\b(cold|iced|chilled)\b/i.exec(text);
    if (hotWord && coldWord) {
      return { productType: hotWord.index <= coldWord.index ? 'Hot' : 'Cold', note: 'Both hot and cold mentioned; used the first one.' };
    }
    if (hotWord) return { productType: 'Hot', note: null };
    if (coldWord) return { productType: 'Cold', note: null };
  }

  return { productType: null, note: null };
}

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** Convert a word-number phrase such as "five thousand" into 5000. */
function wordsToNumber(phrase) {
  const words = phrase.toLowerCase().split(/[\s-]+/).filter((word) => word && word !== 'and');
  if (!words.length) return null;

  let total = 0;
  let current = 0;
  for (const word of words) {
    if (word in NUMBER_WORDS) {
      current += NUMBER_WORDS[word];
    } else if (word === 'hundred') {
      current = (current || 1) * 100;
    } else if (word === 'thousand') {
      total += (current || 1) * 1000;
      current = 0;
    } else if (word === 'million') {
      total += (current || 1) * 1_000_000;
      current = 0;
    } else {
      return null;
    }
  }
  const value = total + current;
  return value > 0 ? value : null;
}

const QUANTITY_UNITS = '(?:cups?|units?|pcs|pieces?|cartons?|boxes?|packs?|sets?|cases?)';

function sanitizeQuantity(value) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > 10_000_000) return null;
  return rounded;
}

/**
 * Extract a requested quantity. Only clear quantity contexts are accepted:
 *   5k / 2.5K units, 5,000 cups, "five thousand", "quantity: 5000",
 *   "qty of 1500", "need 2000 units".
 * Bare numbers (years, phone numbers, prices) are ignored.
 */
function extractQuantity(text) {
  // 1. Shorthand multiplier: 5k, 2.5K, 10 k
  const kMatch = text.match(/\b(\d+(?:\.\d+)?)\s*k\b(?:\s*(?:cups?|units?|pcs|pieces?))?/i);
  if (kMatch) {
    const value = sanitizeQuantity(Number(kMatch[1]) * 1000);
    if (value) return { quantity: value, note: `"${kMatch[0].trim()}" read as ${value.toLocaleString()}.` };
  }

  // 2. Spelled-out numbers: five thousand, twenty five hundred
  const wordMatch = text.match(
    /\b((?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)(?:[\s-]+(?:and[\s-]+)?)?)+)\b(?:\s*(?:cups?|units?|pcs|pieces?|cartons?|boxes?|packs?))?/i,
  );
  if (wordMatch && /\b(?:hundred|thousand|million)\b/i.test(wordMatch[1])) {
    const value = sanitizeQuantity(wordsToNumber(wordMatch[1]));
    if (value) return { quantity: value, note: `"${wordMatch[0].trim()}" read as ${value.toLocaleString()}.` };
  }

  // 3. Plain number followed by a unit word, e.g. "2,500 cold cups".
  //    Up to two product adjectives may sit between the number and the unit.
  const unitMatch = text.match(
    new RegExp(
      `\\b(\\d{1,3}(?:,\\d{3})+|\\d{2,})\\s*(?:of\\s+)?(?:(?:hot|cold|paper|coffee|drink|iced|disposable|custom|printed|\\d{3}\\s*ml)\\s+){0,3}${QUANTITY_UNITS}\\b`,
      'i',
    ),
  );
  if (unitMatch) {
    const value = sanitizeQuantity(Number(unitMatch[1].replace(/,/g, '')));
    if (value) return { quantity: value, note: `"${unitMatch[0].trim()}" read as ${value.toLocaleString()}.` };
  }

  // 4. Explicit quantity label: "quantity: 5000", "qty of 1,500", "order of 2000"
  const labelMatch = text.match(
    /\b(?:quantity|qty|order(?:ing)?|amount)\b\s*(?:of|is|=|:)?\s*(\d{1,3}(?:,\d{3})+|\d{2,})\b/i,
  );
  if (labelMatch) {
    const value = sanitizeQuantity(Number(labelMatch[1].replace(/,/g, '')));
    if (value) return { quantity: value, note: `"${labelMatch[0].trim()}" read as ${value.toLocaleString()}.` };
  }

  return { quantity: null, note: null };
}

function extractDeliveryLocation(text) {
  const patterns = [
    /\b(?:deliver(?:y|ed)?|ship(?:ping|ped)?|send(?:ing)?|drop(?:ping)?)\s+(?:it\s+|them\s+)?(?:to|in|at)\s+([A-Za-z][A-Za-z0-9 .'\-]{1,50})/i,
    /\b(?:delivery|location|city|address)\s*(?::|=|\-|is)\s*([A-Za-z][A-Za-z0-9 .'\-]{1,50})/i,
    /\b(?:we(?:'| a)?re|we are|i am|i'm)\s+(?:based|located)\s+in\s+([A-Za-z][A-Za-z .'\-]{1,40})/i,
    /\b(?:office|store|shop|caf[eé]|warehouse|branch|kitchen|hotel|restaurant)\s+in\s+([A-Z][A-Za-z .'\-]{1,40})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    // Cut at sentence punctuation or connective words.
    const raw = match[1].split(/[,.!?;\n]| \b(?:and|but|so|because|for|on|by|before|after|next|asap)\b/i)[0];
    const location = cleanCapture(raw);
    if (!location) continue;
    if (/\b(?:cups?|ml|quantity|quote|price)\b/i.test(location)) continue;
    return location;
  }
  return null;
}

function extractCustomerName(text) {
  // Explicit label: "My name is Sarah", "Name: Sarah", "This is Sarah"
  const labelled = text.match(
    /\b(?:my name is|name\s*[:\-]|this is|i am|i'm|speaking with)\s*([A-Za-z][A-Za-z'\-]{1,20})(?:\s+([A-Z][A-Za-z'\-]{1,20}))?/i,
  );
  if (labelled) {
    const first = labelled[1];
    const second = labelled[2];
    if (!NAME_STOPWORDS.has(first.toLowerCase())) {
      return second && !NAME_STOPWORDS.has(second.toLowerCase()) ? `${first} ${second}` : first;
    }
  }

  // "Sarah from Bluebird Cafe"
  const fromMatch = text.match(/\b([A-Z][a-z'\-]{1,20})\s+(?:from|at|of)\s+[A-Z]/);
  if (fromMatch && !NAME_STOPWORDS.has(fromMatch[1].toLowerCase())) {
    return fromMatch[1];
  }

  // Signature line: "Thanks,\nSarah" or "Best regards, Sarah"
  const signature = text.match(
    /\b(?:thanks|thank you|regards|best|cheers|sincerely|kind regards)[,!.\s]*\n?\s*([A-Z][a-z'\-]{1,20})(?:\s+([A-Z][a-z'\-]{1,20}))?/,
  );
  if (signature && !NAME_STOPWORDS.has(signature[1].toLowerCase())) {
    return signature[2] ? `${signature[1]} ${signature[2]}` : signature[1];
  }

  return null;
}

function extractBusinessName(text) {
  // Explicit label: "Business: Bluebird Cafe", "Company name - ..."
  const labelled = text.match(/\b(?:business|company)(?:\s+name)?\s*(?::|=|\-)\s*([A-Za-z0-9][A-Za-z0-9&.'\- ]{1,50})/i);
  if (labelled) {
    const value = cleanCapture(labelled[1].split(/[,.!?;\n]/)[0]);
    if (value && !/^[\d\s]+$/.test(value)) return value;
  }

  // "a bakery called Sunrise Bakery"
  const called = text.match(/\b(?:called|named)\s+([A-Za-z0-9][A-Za-z0-9&.'\- ]{1,50})/i);
  if (called) {
    const value = cleanCapture(called[1].split(/[,.!?;\n]/)[0]);
    if (value) return value;
  }

  // "from Bluebird Cafe", "at The Daily Grind", "with Sunrise Roasters"
  const keywordPattern = new RegExp(
    `\\b(?:from|at|with|representing)\\s+((?:[A-Za-z0-9&.'\\-]+\\s+){0,4}${BUSINESS_KEYWORDS})\\b`,
    'i',
  );
  const keywordMatch = text.match(keywordPattern);
  if (keywordMatch) {
    const raw = keywordMatch[1];
    if (/^(?:our|the|your|a|an|my|this|that|their)\b/i.test(raw)) return null;
    const value = cleanCapture(raw);
    if (value) return value;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Missing information + next action + summary
// ---------------------------------------------------------------------------

const IGNORED_MISSING_INTENTS = new Set(['opted_out', 'not_interested']);

function findMissingFields(analysis) {
  if (IGNORED_MISSING_INTENTS.has(analysis.intent)) return [];

  const missing = [];
  if (!analysis.product_type) missing.push('product_type');
  if (!analysis.cup_size) missing.push('cup_size');
  if (!analysis.quantity) missing.push('quantity');
  if (!analysis.delivery_location) missing.push('delivery_location');
  if (!analysis.customer_name && !analysis.business_name) missing.push('customer_name');
  return missing;
}

function suggestNextAction(analysis) {
  const {
    intent,
    product_type: productType,
    cup_size: cupSize,
    quantity,
    delivery_location: location,
  } = analysis;

  switch (intent) {
    case 'opted_out':
      return 'Do not contact this customer again. Mark the enquiry as opted out and remove them from outreach lists.';
    case 'not_interested':
      return 'Record the decline and do not follow up. Keep the enquiry for reporting only.';
    case 'quote_requested': {
      const missing = [];
      if (!productType) missing.push('cup type');
      if (!cupSize) missing.push('cup size');
      if (!quantity) missing.push('quantity');
      if (!location) missing.push('delivery location');
      if (missing.length) {
        return `Ask for the missing ${joinList(missing)} before preparing a quotation.`;
      }
      return 'Prepare a quotation for the requested cups and send it to the customer for review.';
    }
    case 'sample_requested':
      return 'Confirm the sample cup type, size and shipping address, then arrange a sample.';
    case 'more_information_requested':
      return 'Send the SIPZY product catalogue and specification sheet, then ask which variant they need.';
    case 'follow_up_requested':
      return 'Schedule a follow-up at the time the customer asked for; do not send marketing messages before then.';
    case 'interested':
      if (productType && cupSize && quantity) {
        return 'Confirm delivery details and offer a quotation for the requested cups.';
      }
      return 'Confirm the cup type, size and quantity they need, then offer a quotation.';
    case 'general_enquiry':
      return 'Reply with a short introduction and ask which cup type, size and quantity they need.';
    default:
      return 'Reply asking the customer to clarify the cup type, size, quantity and delivery location.';
  }
}

function formatQuantity(value) {
  return Number(value).toLocaleString('en-US');
}

/** "a, b and c" — used in readable next-action sentences. */
function joinList(items) {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function buildSummary(analysis) {
  const { intent, customer_name: name, business_name: business } = analysis;

  const who = business && name ? `${name} from ${business}` : business || name;

  if (intent === 'opted_out') {
    return `${who || 'The customer'} asked to stop receiving messages.`;
  }
  if (intent === 'not_interested') {
    return `${who || 'The customer'} declined the SIPZY cups offer.`;
  }

  const parts = [];
  if (who) parts.push(who);
  else parts.push('A customer');

  const intentPhrases = {
    quote_requested: 'requested a quotation',
    sample_requested: 'requested a sample',
    more_information_requested: 'asked for more information',
    follow_up_requested: 'asked for a follow-up',
    interested: 'expressed interest',
    general_enquiry: 'sent a general enquiry',
    unknown: 'sent a message that could not be classified',
  };
  parts.push(intentPhrases[intent] || 'sent a message');

  const productParts = [];
  if (analysis.quantity) productParts.push(formatQuantity(analysis.quantity));
  if (analysis.product_type) productParts.push(analysis.product_type.toLowerCase());
  if (analysis.cup_size) productParts.push(analysis.cup_size);
  if (productParts.length) {
    parts.push(`for ${productParts.join(' ')}${briefUnit(productParts) ? ' cups' : ''}`.replace(/\s+/g, ' '));
  }

  if (analysis.delivery_location) parts.push(`delivered to ${analysis.delivery_location}`);

  let summary = parts.join(' ');
  if (!summary.endsWith('.')) summary += '.';
  return summary;
}

function briefUnit(parts) {
  return !parts.includes('cups') && !parts.includes('units');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze a single customer message. Pure function, no side effects.
 *
 * @param {string} message
 * @returns {Object} structured analysis (all unknown fields are null)
 */
function analyzeMessage(message) {
  const original = typeof message === 'string' ? message : '';
  const text = normalize(original);

  if (!text) {
    return {
      customer_name: null,
      business_name: null,
      product_type: null,
      cup_size: null,
      quantity: null,
      delivery_location: null,
      intent: 'unknown',
      intent_label: INTENT_LABELS.unknown,
      detected_intents: [],
      missing_information: ['product_type', 'cup_size', 'quantity', 'delivery_location', 'customer_name'],
      missing_labels: ['Product type', 'Cup size', 'Quantity', 'Delivery location', 'Customer name'],
      suggested_next_action: 'No message was provided. Paste the customer message and try again.',
      summary: 'No message to analyze.',
      original_message: original,
      parser: PARSER_VERSION,
      notes: [],
    };
  }

  const notes = [];
  const { intent, detectedIntents } = detectIntent(text);

  const size = extractCupSize(text);
  const product = extractProductType(text);
  if (product.note) notes.push(product.note);

  const quantity = extractQuantity(text);
  if (quantity.note) notes.push(quantity.note);

  const customerName = extractCustomerName(text);
  const businessName = extractBusinessName(text);
  const location = extractDeliveryLocation(text);

  const analysis = {
    customer_name: customerName,
    business_name: businessName,
    product_type: product.productType,
    cup_size: size,
    quantity: quantity.quantity,
    delivery_location: location,
    intent,
    intent_label: INTENT_LABELS[intent],
    detected_intents: detectedIntents,
    missing_information: [],
    missing_labels: [],
    suggested_next_action: '',
    summary: '',
    original_message: original,
    parser: PARSER_VERSION,
    notes,
  };

  analysis.missing_information = findMissingFields(analysis);
  analysis.missing_labels = analysis.missing_information.map((field) => FIELD_LABELS[field] || field);
  analysis.suggested_next_action = suggestNextAction(analysis);
  analysis.summary = buildSummary(analysis);

  return analysis;
}

/**
 * Build a validated enquiry payload from a reviewed analysis.
 * Explicit values passed in `overrides` (e.g. the dashboard's reviewed
 * fields) always win over the parser output. Nothing is invented:
 * unknown values stay empty.
 *
 * @param {Object} analysis - result of analyzeMessage()
 * @param {Object} [overrides]
 * @returns {{ errors: string[], data: Object }}
 */
function buildEnquiryFromAnalysis(analysis, overrides = {}) {
  const errors = [];

  // A reviewer may deliberately clear a field, so any key the caller
  // actually provides wins — even an empty string. Only undefined keys
  // fall back to the parser output.
  const pick = (key) =>
    Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : analysis[key];

  const text = (value) => (value === null || value === undefined ? '' : String(value).trim());
  const rawQuantity = pick('quantity');
  const resolved = {
    ...analysis,
    customer_name: text(pick('customer_name')) || null,
    business_name: text(pick('business_name')) || null,
    product_type: text(pick('product_type')) || null,
    cup_size: text(pick('cup_size')) || null,
    delivery_location: text(pick('delivery_location')) || null,
    quantity:
      rawQuantity === null || rawQuantity === undefined || rawQuantity === ''
        ? null
        : Number(rawQuantity),
  };

  if (resolved.product_type && !VALID_PRODUCT_TYPES.includes(resolved.product_type)) {
    errors.push('product_type must be Hot or Cold');
  }
  if (resolved.cup_size && !VALID_SIZES.includes(resolved.cup_size)) {
    errors.push('cup_size must be 250ml, 350ml or 500ml');
  }
  if (resolved.quantity !== null) {
    const numeric = resolved.quantity;
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 10_000_000) {
      errors.push('quantity must be a whole number between 1 and 10,000,000');
    }
  }

  let status = overrides.enquiry_status || INTENT_TO_STATUS[analysis.intent] || 'new';
  if (status === 'confirmed-order') {
    errors.push('An analysed message can never create a confirmed order');
    status = 'new';
  }

  const data = {
    lead_id: overrides.lead_id,
    customer_name: resolved.customer_name || '',
    business_name: resolved.business_name || '',
    phone: overrides.phone || '',
    email: overrides.email || '',
    quantity: resolved.quantity ?? 0,
    delivery_location: resolved.delivery_location || '',
    enquiry_status: status,
    original_message: analysis.original_message || '',
    // Reflect the reviewed values, not stale parser output.
    ai_summary: buildSummary(resolved),
    follow_up_date: overrides.follow_up_date || '',
  };

  // Only send product fields when known, so "unspecified" stays unspecified
  // instead of failing enum validation with an empty string.
  if (resolved.product_type) data.product_type = resolved.product_type;
  if (resolved.cup_size) data.cup_size = resolved.cup_size;

  return { errors, data };
}

export {
  analyzeMessage,
  buildEnquiryFromAnalysis,
  INTENTS,
  INTENT_LABELS,
  INTENT_TO_STATUS,
  PARSER_VERSION,
  FIELD_LABELS,
};
