import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AI_PROVIDER = 'gemini';
process.env.AI_PAID_CALLS_ENABLED = 'true';
process.env.GEMINI_API_KEY = 'test-key-not-real';
process.env.GEMINI_MODEL = 'gemini-3.8-flash';
process.env.AI_TIMEOUT_MS = '200';
process.env.AI_MAX_TOKENS = '2000';
process.env.AI_TEMPERATURE = '0.2';

const ai = await import('../services/ai.js');

function geminiResponse(content) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: typeof content === 'string' ? content : JSON.stringify(content) }],
        },
        finishReason: 'STOP',
      },
    ],
  };
}

const validPayload = {
  reply: 'Gemini reply for SIPZY cups.',
  intent: 'general_enquiry',
  extracted_requirements: {
    product_type: 'Cold',
    cup_size: '350ml',
    quantity: 5000,
    delivery_location: 'Bengaluru',
    customer_name: 'Cafe Owner',
  },
  missing_info: [],
  proposed_actions: [],
};

test('gemini provider config enables network calls when key is present', () => {
  const config = ai.getAiConfig();
  assert.equal(config.provider, 'gemini');
  assert.equal(config.model, 'gemini-3.8-flash');
  assert.equal(config.configured, true);
  assert.equal(config.paid_calls_enabled, true);
  assert.equal(config.network_calls, true);
});

test('gemini provider returns validated AI output on success', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return geminiResponse(validPayload);
    },
  });
  try {
    const result = await ai.generateAiResponse({
      conversation: { status: 'new', last_message: 'Need cold cups' },
      requirements: { product_type: 'Cold', cup_size: '350ml', quantity: 0, delivery_location: '', missing_info: ['quantity'] },
      lastMessage: 'Need cold cups',
      history: [],
    });
    assert.equal(result.source, 'provider');
    assert.equal(result.fallback, false);
    assert.equal(result.reply, validPayload.reply);
    assert.equal(result.intent, 'general_enquiry');
    assert.deepEqual(result.proposedActions, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test('gemini provider falls back on invalid JSON response', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return geminiResponse('not json');
    },
  });
  try {
    const result = await ai.generateAiResponse({
      conversation: { status: 'new', last_message: 'Need cold cups' },
      requirements: { product_type: 'Cold', cup_size: '350ml', quantity: 0, delivery_location: '', missing_info: ['quantity'] },
      lastMessage: 'Need cold cups',
      history: [],
    });
    assert.equal(result.fallback, true);
    assert.equal(result.source, 'local');
  } finally {
    global.fetch = originalFetch;
  }
});

test('gemini provider falls back on rate limit', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 429,
    async json() {
      return { error: { message: 'rate limited' } };
    },
  });
  try {
    const result = await ai.generateAiResponse({
      conversation: { status: 'new', last_message: 'Need cold cups' },
      requirements: { product_type: 'Cold', cup_size: '350ml', quantity: 0, delivery_location: '', missing_info: ['quantity'] },
      lastMessage: 'Need cold cups',
      history: [],
    });
    assert.equal(result.fallback, true);
    assert.equal(result.source, 'local');
  } finally {
    global.fetch = originalFetch;
  }
});

test('gemini provider falls back on timeout', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ok: true, status: 200, async json() { return geminiResponse(validPayload); } }), 1000);
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      }
    });
  };
  try {
    const result = await ai.generateAiResponse({
      conversation: { status: 'new', last_message: 'Need cold cups' },
      requirements: { product_type: 'Cold', cup_size: '350ml', quantity: 0, delivery_location: '', missing_info: ['quantity'] },
      lastMessage: 'Need cold cups',
      history: [],
    });
    assert.equal(result.fallback, true);
    assert.equal(result.source, 'local');
  } finally {
    global.fetch = originalFetch;
  }
});

test('gemini provider disables network calls when key is missing', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const config = ai.getAiConfig();
  assert.equal(config.configured, false);
  assert.equal(config.network_calls, false);
  process.env.GEMINI_API_KEY = previousKey || 'test-key-not-real';
});