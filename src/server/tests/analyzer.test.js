import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMessage, buildEnquiryFromAnalysis } from '../services/analyzer.js';

/**
 * Local analyzer tests — no database, no network.
 * Each case documents what the rule-based parser should and should not extract.
 */

const VALID_SIZES = ['250ml', '350ml', '450ml'];

const cases = [
  {
    name: 'complete quote request with shorthand quantity',
    message:
      'Hi, this is Sarah from Bluebird Cafe. We need 5k cold cups in 350ml delivered to Austin. Can you send a quotation?',
    expected: {
      customer_name: 'Sarah',
      business_name: 'Bluebird Cafe',
      product_type: 'Cold',
      cup_size: '350ml',
      quantity: 5000,
      delivery_location: 'Austin',
      intent: 'quote_requested',
    },
  },
  {
    name: 'hot cups, spaced ml and "please" after the city',
    message: 'need 5000 hot cups 250 ml, deliver to Dallas please',
    expected: {
      customer_name: null,
      business_name: null,
      product_type: 'Hot',
      cup_size: '250ml',
      quantity: 5000,
      delivery_location: 'Dallas',
      intent: 'interested',
    },
  },
  {
    name: 'price question with spelled-out quantity and no size',
    message: 'Hello, we are interested in five thousand cold drink cups. What is the price?',
    expected: {
      product_type: 'Cold',
      cup_size: null,
      quantity: 5000,
      delivery_location: null,
      intent: 'quote_requested',
    },
  },
  {
    name: 'sample request',
    message: 'Can I get a sample of your hot coffee cups in 250ml?',
    expected: {
      product_type: 'Hot',
      cup_size: '250ml',
      quantity: null,
      delivery_location: null,
      intent: 'sample_requested',
    },
  },
  {
    name: 'explicit opt-out',
    message: 'Please stop messaging me.',
    expected: {
      intent: 'opted_out',
      product_type: null,
      cup_size: null,
      quantity: null,
      delivery_location: null,
      customer_name: null,
      business_name: null,
      missing_information: [],
    },
  },
  {
    name: 'unsubscribe request',
    message: 'Unsubscribe me from your list',
    expected: { intent: 'opted_out', quantity: null },
  },
  {
    name: 'polite decline',
    message: "We're not interested, thanks",
    expected: { intent: 'not_interested', quantity: null },
  },
  {
    name: 'catalogue request with a delivery city',
    message:
      "Do you have a catalogue? We're looking for 350ml cold cups for our office in Denver.",
    expected: {
      product_type: 'Cold',
      cup_size: '350ml',
      quantity: null,
      delivery_location: 'Denver',
      intent: 'more_information_requested',
    },
  },
  {
    name: '10k shorthand in a price question',
    message: 'how much for 10k hot cups?',
    expected: {
      product_type: 'Hot',
      cup_size: null,
      quantity: 10000,
      delivery_location: null,
      intent: 'quote_requested',
    },
  },
  {
    name: 'comma quantity plus name, business and city',
    message:
      'Hi, my name is Omar from Sunrise Bakery. Need 2,500 cold cups 450ml, delivery to Chicago.',
    expected: {
      customer_name: 'Omar',
      business_name: 'Sunrise Bakery',
      product_type: 'Cold',
      cup_size: '450ml',
      quantity: 2500,
      delivery_location: 'Chicago',
      intent: 'interested',
    },
  },
  {
    name: 'decline because of an existing supplier',
    message: 'No thanks, we already have a supplier.',
    expected: {
      intent: 'not_interested',
      product_type: null,
      cup_size: null,
      quantity: null,
      delivery_location: null,
    },
  },
  {
    name: 'sizes question with no product, size or quantity',
    message: 'What sizes do you offer?',
    expected: {
      intent: 'more_information_requested',
      product_type: null,
      cup_size: null,
      quantity: null,
      delivery_location: null,
      customer_name: null,
      business_name: null,
    },
  },
  {
    name: 'call-back request',
    message: 'Can you call me back next week about the cups?',
    expected: { intent: 'follow_up_requested', quantity: null },
  },
  {
    name: 'unintelligible message is unknown, not guessed',
    message: 'asdf jkl;',
    expected: {
      intent: 'unknown',
      product_type: null,
      cup_size: null,
      quantity: null,
      delivery_location: null,
      customer_name: null,
      business_name: null,
    },
  },
  {
    name: 'quantity without size, type or location — nothing else invented',
    message: 'We need 500 cups.',
    expected: {
      quantity: 500,
      product_type: null,
      cup_size: null,
      delivery_location: null,
      customer_name: null,
      business_name: null,
      intent: 'interested',
    },
  },
  {
    name: 'cold cups from "iced", price request',
    message: 'Interested in your iced cups, 350 ml. Send prices.',
    expected: {
      product_type: 'Cold',
      cup_size: '350ml',
      quantity: null,
      delivery_location: null,
      intent: 'quote_requested',
    },
  },
  {
    name: 'bare STOP',
    message: 'STOP',
    expected: { intent: 'opted_out' },
  },
  {
    name: 'misspelled "interested"',
    message: 'intrested in cold cups 250ml',
    expected: {
      product_type: 'Cold',
      cup_size: '250ml',
      quantity: null,
      intent: 'interested',
    },
  },
  {
    name: 'units phrasing with extra adjectives',
    message:
      'Hi, this is Maya. 5000 units of hot 350ml cups pls. Deliver to Boston.',
    expected: {
      customer_name: 'Maya',
      product_type: 'Hot',
      cup_size: '350ml',
      quantity: 5000,
      delivery_location: 'Boston',
      intent: 'general_enquiry',
    },
  },
  {
    name: 'quote request without a product type',
    message: "I'd like a quote for 350ml cups",
    expected: {
      product_type: null,
      cup_size: '350ml',
      quantity: null,
      delivery_location: null,
      intent: 'quote_requested',
    },
  },
  {
    name: 'opt-out wins over not-interested wording',
    message: "Do not message me again — we're not interested.",
    expected: { intent: 'opted_out' },
  },
  {
    name: 'empty message',
    message: '   ',
    expected: { intent: 'unknown', quantity: null, missing_information: undefined },
  },
];

for (const testCase of cases) {
  test(`analyzer: ${testCase.name}`, () => {
    const result = analyzeMessage(testCase.message);

    for (const [key, expected] of Object.entries(testCase.expected)) {
      if (expected === undefined) continue;
      assert.deepEqual(result[key], expected, `${key} for message: ${testCase.message}`);
    }

    // Contract checks that apply to every message.
    assert.equal(result.intent_label.length > 0, true, 'intent_label is always set');
    assert.equal(typeof result.suggested_next_action, 'string');
    assert.ok(result.suggested_next_action.length > 0);
    assert.equal(typeof result.summary, 'string');
    assert.equal(result.original_message, testCase.message);
    assert.equal(result.parser, 'local-rules-v1');

    // Never invent a size that was not written in the message.
    if (result.cup_size !== null) {
      assert.ok(VALID_SIZES.includes(result.cup_size), 'cup_size is always one of the catalogue sizes');
      assert.ok(
        /250|350|500/.test(testCase.message),
        `nonexistent size invented for: ${testCase.message}`,
      );
    }

    // Never invent a quantity that was not written in the message.
    if (result.quantity !== null) {
      assert.ok(Number.isInteger(result.quantity) && result.quantity >= 1);
      assert.ok(
        /\d|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand/i.test(testCase.message),
        `nonexistent quantity invented for: ${testCase.message}`,
      );
    }

    // An analysed message can never become a confirmed order.
    assert.notEqual(result.intent, 'confirmed_order');
  });
}

test('analyzer: summary is readable and never claims a confirmed order', () => {
  const result = analyzeMessage(
    'Hi, this is Sarah from Bluebird Cafe. We need 5k cold cups in 350ml delivered to Austin. Can you send a quotation?',
  );
  assert.match(result.summary, /Sarah/);
  assert.match(result.summary, /Bluebird Cafe/);
  assert.match(result.summary, /5,000/);
  assert.match(result.summary, /quotation/i);
  assert.doesNotMatch(result.summary, /confirmed/i);
});

test('analyzer: missing information lists only genuinely absent fields', () => {
  const complete = analyzeMessage(
    'Sarah from Bluebird Cafe needs 5000 hot 350ml cups delivered to Austin.',
  );
  assert.deepEqual(complete.missing_information, []);

  const partial = analyzeMessage('Can you send a quote?');
  assert.ok(partial.missing_information.includes('product_type'));
  assert.ok(partial.missing_information.includes('cup_size'));
  assert.ok(partial.missing_information.includes('quantity'));
  assert.ok(partial.missing_information.includes('delivery_location'));
});

test('analyzer: opt-out and decline actions never suggest outreach', () => {
  const optOut = analyzeMessage('Please unsubscribe me.');
  assert.equal(optOut.intent, 'opted_out');
  assert.match(optOut.suggested_next_action.toLowerCase(), /do not contact/);

  const decline = analyzeMessage('Not interested, sorry.');
  assert.equal(decline.intent, 'not_interested');
  assert.match(decline.suggested_next_action.toLowerCase(), /do not follow up/);
});

test('buildEnquiryFromAnalysis: reviewer values override the parser', () => {
  const analysis = analyzeMessage('We need 5k cold cups in 350ml delivered to Austin.');
  const { errors, data } = buildEnquiryFromAnalysis(analysis, {
    customer_name: 'Reviewed Name',
    quantity: 7500,
    cup_size: '450ml',
  });

  assert.deepEqual(errors, []);
  assert.equal(data.customer_name, 'Reviewed Name');
  assert.equal(data.quantity, 7500);
  assert.equal(data.cup_size, '450ml');
  assert.equal(data.original_message, analysis.original_message);
  // The saved summary must describe what was actually saved.
  assert.match(data.ai_summary, /Reviewed Name/);
  assert.match(data.ai_summary, /7,500/);
  assert.match(data.ai_summary, /450ml/);
});

test('buildEnquiryFromAnalysis: reviewer can clear a parsed field', () => {
  const analysis = analyzeMessage('We need 5k cold cups in 350ml delivered to Austin.');
  const { data } = buildEnquiryFromAnalysis(analysis, { delivery_location: '' });
  assert.equal(data.delivery_location, '');
});

test('buildEnquiryFromAnalysis: maps intents onto pipeline statuses', () => {
  const quote = buildEnquiryFromAnalysis(analyzeMessage('Please send a quotation for 500 cups.'));
  assert.equal(quote.data.enquiry_status, 'quote-requested');

  const optOut = buildEnquiryFromAnalysis(analyzeMessage('Please stop messaging me.'));
  assert.equal(optOut.data.enquiry_status, 'opted-out');

  const decline = buildEnquiryFromAnalysis(analyzeMessage('Not interested.'));
  assert.equal(decline.data.enquiry_status, 'not-interested');
});

test('buildEnquiryFromAnalysis: rejects invalid reviewed values', () => {
  const analysis = analyzeMessage('We need 500 cold cups.');
  const badSize = buildEnquiryFromAnalysis(analysis, { cup_size: '900ml' });
  assert.ok(badSize.errors.some((error) => error.includes('cup_size')));

  const badQuantity = buildEnquiryFromAnalysis(analysis, { quantity: -5 });
  assert.ok(badQuantity.errors.some((error) => error.includes('quantity')));

  const badType = buildEnquiryFromAnalysis(analysis, { product_type: 'Warm' });
  assert.ok(badType.errors.some((error) => error.includes('product_type')));
});

test('buildEnquiryFromAnalysis: never produces a confirmed order', () => {
  const analysis = analyzeMessage('We are ready to order 5000 cups, send the invoice.');
  const { errors, data } = buildEnquiryFromAnalysis(analysis, { enquiry_status: 'confirmed-order' });
  assert.ok(errors.length > 0);
  assert.notEqual(data.enquiry_status, 'confirmed-order');
});
