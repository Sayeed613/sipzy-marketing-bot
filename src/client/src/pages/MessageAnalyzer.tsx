import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  analyzerApi,
  type AnalysisIntent,
  type MessageAnalysis,
  type MessageEnquiryResult,
} from '../utils/api';

const EXAMPLE_MESSAGES = [
  {
    label: 'Quote + full details',
    text: 'Hi, this is Sarah from Bluebird Cafe. We need 5k cold cups in 350ml delivered to Austin. Can you send a quotation?',
  },
  {
    label: 'Sample request',
    text: 'Hello, I would like to try a sample of your hot coffee cups, 250 ml please.',
  },
  {
    label: 'More information',
    text: 'Do you have a catalogue? We are interested in paper cups for our office in Denver.',
  },
  {
    label: 'Opt-out',
    text: 'Please stop messaging me. Not interested.',
  },
  {
    label: 'Incomplete',
    text: 'How much for cups?',
  },
];

const INTENT_BADGE: Record<AnalysisIntent, string> = {
  interested: 'bg-sipzy-green/10 text-sipzy-green border-sipzy-green/25',
  quote_requested: 'bg-sipzy-purple/10 text-sipzy-purple border-sipzy-purple/25',
  sample_requested: 'bg-sipzy-teal/10 text-sipzy-teal border-sipzy-teal/25',
  more_information_requested: 'bg-sipzy-blue/10 text-sipzy-blue border-sipzy-blue/25',
  follow_up_requested: 'bg-sipzy-indigo/10 text-sipzy-indigo border-sipzy-indigo/25',
  not_interested: 'bg-sipzy-red/10 text-sipzy-red border-sipzy-red/25',
  opted_out: 'bg-sipzy-text text-white border-sipzy-text',
  general_enquiry: 'bg-sipzy-amber/10 text-sipzy-amber border-sipzy-amber/25',
  unknown: 'bg-sipzy-muted/10 text-sipzy-muted border-sipzy-border',
};

const PIPELINE_STATUS: Record<AnalysisIntent, string> = {
  interested: 'Interested',
  quote_requested: 'Quote Requested',
  sample_requested: 'Sample Requested',
  more_information_requested: 'More Information Requested',
  follow_up_requested: 'New (follow-up)',
  not_interested: 'Not Interested',
  opted_out: 'Opted Out',
  general_enquiry: 'New',
  unknown: 'New',
};

interface ReviewState {
  customer_name: string;
  business_name: string;
  email: string;
  phone: string;
  product_type: string;
  cup_size: string;
  quantity: string;
  delivery_location: string;
}

const EMPTY_REVIEW: ReviewState = {
  customer_name: '',
  business_name: '',
  email: '',
  phone: '',
  product_type: '',
  cup_size: '',
  quantity: '',
  delivery_location: '',
};

const labelClass = 'text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted';
const inputClass =
  'w-full rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm text-sipzy-text placeholder:text-sipzy-muted/70 focus:border-sipzy-green focus:outline-none focus:ring-2 focus:ring-sipzy-green/20';

const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({
  label,
  children,
  hint,
}) => (
  <div>
    <label className={labelClass}>{label}</label>
    <div className="mt-1">{children}</div>
    {hint && <p className="mt-1 text-[11px] text-sipzy-muted">{hint}</p>}
  </div>
);

/**
 * MessageAnalyzer — paste a customer message, inspect the local rule-based
 * extraction, correct anything that is wrong, then save it as an enquiry.
 */
const MessageAnalyzer: React.FC = () => {
  const [message, setMessage] = useState('');
  const [analysis, setAnalysis] = useState<MessageAnalysis | null>(null);
  const [analyzedMessage, setAnalyzedMessage] = useState('');
  const [review, setReview] = useState<ReviewState>(EMPTY_REVIEW);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<MessageEnquiryResult | null>(null);

  const isStale = analysis !== null && message.trim() !== analyzedMessage.trim();

  const missingLabels = analysis?.missing_labels ?? [];

  const setField = (key: keyof ReviewState, value: string) => {
    setReview((current) => ({ ...current, [key]: value }));
    setSaveError(null);
  };

  const runAnalysis = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setError('Paste a customer message first.');
      return;
    }
    setAnalyzing(true);
    setError(null);
    setSaveError(null);
    setSaved(null);
    try {
      const result = await analyzerApi.analyze(trimmed);
      setAnalysis(result);
      setAnalyzedMessage(trimmed);
      setReview({
        customer_name: result.customer_name ?? '',
        business_name: result.business_name ?? '',
        email: '',
        phone: '',
        product_type: result.product_type ?? '',
        cup_size: result.cup_size ?? '',
        quantity: result.quantity !== null ? String(result.quantity) : '',
        delivery_location: result.delivery_location ?? '',
      });
    } catch (err) {
      setAnalysis(null);
      setError(err instanceof Error ? err.message : 'Could not analyze the message');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAnalyze = (event: React.FormEvent) => {
    event.preventDefault();
    void runAnalysis(message);
  };

  const handleSave = async () => {
    if (!analysis || isStale) return;

    const quantityText = review.quantity.trim();
    let quantity: number | null = null;
    if (quantityText) {
      const parsed = Number(quantityText);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10_000_000) {
        setSaveError('Quantity must be a whole number between 1 and 10,000,000 (or left blank).');
        return;
      }
      quantity = parsed;
    }

    if (review.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(review.email.trim())) {
      setSaveError('Enter a valid email address, or leave it blank.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const result = await analyzerApi.saveFromMessage({
        message: analyzedMessage,
        customer_name: review.customer_name.trim(),
        business_name: review.business_name.trim(),
        email: review.email.trim(),
        phone: review.phone.trim(),
        product_type: (review.product_type || '') as '' | 'Hot' | 'Cold',
        cup_size: (review.cup_size || '') as '' | '250ml' | '350ml' | '500ml',
        quantity,
        delivery_location: review.delivery_location.trim(),
      });
      setSaved(result);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save the enquiry');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setMessage('');
    setAnalysis(null);
    setAnalyzedMessage('');
    setReview(EMPTY_REVIEW);
    setError(null);
    setSaveError(null);
    setSaved(null);
  };

  const detectedNotes = useMemo(() => analysis?.notes ?? [], [analysis]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sipzy-orange">Intelligence</p>
        <h2 className="mt-1 text-2xl font-bold text-sipzy-text">Message analyzer</h2>
        <p className="mt-1 max-w-3xl text-sm text-sipzy-muted">
          Paste a customer message to extract cup type, size, quantity, delivery location and intent.
          This uses local rules only — no external AI service, no WhatsApp, no email. Nothing is sent to
          the customer.
        </p>
      </div>

      {saved && (
        <div className="rounded-xl border border-sipzy-green/30 bg-sipzy-green/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-sipzy-green">Enquiry saved</p>
              <p className="mt-1 text-sm text-sipzy-text">
                {saved.enquiry.customer_name || saved.enquiry.business_name || 'Unnamed customer'} ·{' '}
                {saved.enquiry.enquiry_status} · id {saved.enquiry.id.slice(0, 8)}
              </p>
              <p className="mt-1 text-xs text-sipzy-muted">{saved.enquiry.ai_summary}</p>
              {saved.suppression?.suppression && (
                <p className="mt-3 rounded-lg border border-sipzy-red/25 bg-white px-3 py-2 text-xs text-sipzy-text">
                  <span className="font-semibold text-sipzy-red">Contact suppressed.</span>{' '}
                  {saved.suppression.suppression.phone ||
                    saved.suppression.suppression.email ||
                    'This contact'}{' '}
                  is on the permanent do-not-contact list. No outreach will be sent to them.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Link
                to="/enquiries"
                className="rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm font-medium text-sipzy-text hover:bg-sipzy-hover"
              >
                View enquiries
              </Link>
              <button
                type="button"
                onClick={reset}
                className="rounded-lg bg-sipzy-green px-3 py-2 text-sm font-medium text-white hover:bg-sipzy-green-hover"
              >
                Analyze another
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-5">
        {/* Message input */}
        <section className="xl:col-span-2">
          <form
            onSubmit={handleAnalyze}
            className="space-y-3 rounded-xl border border-sipzy-border bg-white p-4 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-sipzy-text">Customer message</h3>
              <span className="text-xs text-sipzy-muted">{message.length}/5000</span>
            </div>

            <textarea
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                setError(null);
              }}
              rows={9}
              maxLength={5000}
              placeholder={'Paste the customer message here…\n\nExample: "Hi, we need 5k cold cups in 350ml delivered to Austin. Can you quote?"'}
              className={`${inputClass} resize-y leading-relaxed`}
              aria-label="Customer message"
            />

            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_MESSAGES.map((example) => (
                <button
                  key={example.label}
                  type="button"
                  onClick={() => {
                    setMessage(example.text);
                    void runAnalysis(example.text);
                  }}
                  className="rounded-full border border-sipzy-border px-2.5 py-1 text-[11px] font-medium text-sipzy-muted transition hover:border-sipzy-green/40 hover:text-sipzy-green"
                >
                  {example.label}
                </button>
              ))}
            </div>

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={analyzing || !message.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sipzy-green px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sipzy-green-hover disabled:opacity-60"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {analyzing ? 'Analyzing…' : 'Analyze message'}
            </button>

            <p className="text-[11px] leading-relaxed text-sipzy-muted">
              Rule-based parser ({analysis?.parser ?? 'local-rules-v1'}). It only reads the text you paste
              and leaves anything unclear empty.
            </p>
          </form>
        </section>

        {/* Results */}
        <section className="xl:col-span-3">
          {!analysis ? (
            <div className="flex h-full min-h-[18rem] flex-col items-center justify-center rounded-xl border border-dashed border-sipzy-border bg-white/60 p-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sipzy-hover text-sipzy-muted">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="mt-3 text-sm font-medium text-sipzy-text">No analysis yet</p>
              <p className="mt-1 max-w-sm text-sm text-sipzy-muted">
                Paste a message and choose “Analyze message”. You will be able to review every extracted
                field before anything is saved.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {isStale && (
                <div className="rounded-lg border border-sipzy-amber/30 bg-sipzy-amber/5 px-4 py-3 text-sm text-sipzy-amber">
                  The message changed after analysis. Run the analysis again before saving.
                </div>
              )}

              {/* Intent + summary */}
              <div className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">
                      Intent
                    </span>
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${INTENT_BADGE[analysis.intent]}`}
                    >
                      {analysis.intent_label}
                    </span>
                  </div>
                  <span className="text-xs text-sipzy-muted">
                    Pipeline status on save: <strong className="text-sipzy-text">{PIPELINE_STATUS[analysis.intent]}</strong>
                  </span>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-sipzy-text">{analysis.summary}</p>

                {analysis.detected_intents.length > 1 && (
                  <p className="mt-2 text-xs text-sipzy-muted">
                    Also matched:{' '}
                    {analysis.detected_intents
                      .filter((intent) => intent !== analysis.intent)
                      .join(', ')
                      .replace(/_/g, ' ')}
                  </p>
                )}

                {analysis.intent === 'opted_out' && (
                  <p className="mt-3 rounded-lg border border-sipzy-red/20 bg-sipzy-red/5 px-3 py-2 text-xs text-sipzy-red">
                    This customer asked not to be contacted. Saving records the opt-out only — no message
                    will be sent.
                  </p>
                )}
              </div>

              {/* Review + extracted fields */}
              <div className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-sipzy-text">Review extracted information</h3>
                    <p className="mt-0.5 text-xs text-sipzy-muted">
                      Correct anything the parser got wrong. Empty fields are saved as unspecified.
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="Customer name">
                    <input
                      className={inputClass}
                      value={review.customer_name}
                      onChange={(event) => setField('customer_name', event.target.value)}
                      placeholder="Not found in message"
                    />
                  </Field>
                  <Field label="Business name">
                    <input
                      className={inputClass}
                      value={review.business_name}
                      onChange={(event) => setField('business_name', event.target.value)}
                      placeholder="Not found in message"
                    />
                  </Field>
                  <Field label="Product type">
                    <select
                      className={inputClass}
                      value={review.product_type}
                      onChange={(event) => setField('product_type', event.target.value)}
                    >
                      <option value="">Not specified</option>
                      <option value="Hot">Hot</option>
                      <option value="Cold">Cold</option>
                    </select>
                  </Field>
                  <Field label="Cup size">
                    <select
                      className={inputClass}
                      value={review.cup_size}
                      onChange={(event) => setField('cup_size', event.target.value)}
                    >
                      <option value="">Not specified</option>
                      <option value="250ml">250ml</option>
                      <option value="350ml">350ml</option>
                      <option value="500ml">500ml</option>
                    </select>
                  </Field>
                  <Field label="Quantity">
                    <input
                      className={inputClass}
                      value={review.quantity}
                      onChange={(event) => setField('quantity', event.target.value)}
                      inputMode="numeric"
                      placeholder="Not specified"
                    />
                  </Field>
                  <Field label="Delivery location">
                    <input
                      className={inputClass}
                      value={review.delivery_location}
                      onChange={(event) => setField('delivery_location', event.target.value)}
                      placeholder="Not found in message"
                    />
                  </Field>
                  <Field label="Email (optional)">
                    <input
                      className={inputClass}
                      value={review.email}
                      onChange={(event) => setField('email', event.target.value)}
                      placeholder="customer@example.com"
                    />
                  </Field>
                  <Field label="Phone (optional)">
                    <input
                      className={inputClass}
                      value={review.phone}
                      onChange={(event) => setField('phone', event.target.value)}
                      placeholder="+1 555 010 2030"
                    />
                  </Field>
                </div>

                {detectedNotes.length > 0 && (
                  <ul className="mt-3 space-y-1 rounded-lg bg-sipzy-hover/60 px-3 py-2 text-[11px] text-sipzy-muted">
                    {detectedNotes.map((note) => (
                      <li key={note}>• {note}</li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Missing info + next action */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-sipzy-text">Missing information</h3>
                  {missingLabels.length === 0 ? (
                    <p className="mt-2 text-sm text-sipzy-green">
                      Nothing missing for this intent.
                    </p>
                  ) : (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {missingLabels.map((label) => (
                        <li
                          key={label}
                          className="rounded-full border border-sipzy-amber/25 bg-sipzy-amber/5 px-2.5 py-0.5 text-xs font-medium text-sipzy-amber"
                        >
                          {label}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-sipzy-text">Suggested next action</h3>
                  <p className="mt-2 text-sm leading-relaxed text-sipzy-text">
                    {analysis.suggested_next_action}
                  </p>
                </div>
              </div>

              {/* Save */}
              <div className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
                {saveError && (
                  <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {saveError}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-sipzy-muted">
                    The original message is stored with the enquiry. Nothing is sent to the customer.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={reset}
                      className="rounded-lg border border-sipzy-border px-3 py-2 text-sm font-medium text-sipzy-text hover:bg-sipzy-hover"
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving || isStale || Boolean(saved)}
                      className="rounded-lg bg-sipzy-green px-4 py-2 text-sm font-medium text-white transition hover:bg-sipzy-green-hover disabled:opacity-60"
                    >
                      {saving ? 'Saving…' : 'Save enquiry'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default MessageAnalyzer;
