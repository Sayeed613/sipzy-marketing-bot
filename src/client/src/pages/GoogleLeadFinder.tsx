import React, { useEffect, useState } from 'react';
import { googlePlacesApi } from '../utils/api';
import type { GooglePlaceResult, GooglePlacesConfig, GooglePlacesSearchResponse } from '../../../shared/types';

const CATEGORIES = [
  'Cafés',
  'Juice shops',
  'Bubble tea',
  'Restaurants',
  'QSRs',
  'Beverage chains',
  'Cloud kitchens',
] as const;

const inputClass =
  'w-full rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm text-sipzy-text outline-none transition focus:border-sipzy-green focus:ring-2 focus:ring-sipzy-green/20';

const GoogleLeadFinder: React.FC = () => {
  const [config, setConfig] = useState<GooglePlacesConfig | null>(null);
  const [city, setCity] = useState('Bengaluru');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('Cafés');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<GooglePlacesSearchResponse | null>(null);
  const [selected, setSelected] = useState<GooglePlaceResult | null>(null);

  useEffect(() => {
    googlePlacesApi
      .config()
      .then(setConfig)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load configuration'));
  }, []);

  const search = async (pageToken?: string | null) => {
    if (searching) return;
    setSearching(true);
    setError(null);
    try {
      const result = await googlePlacesApi.search({
        city,
        category,
        page_size: 20,
        page_token: pageToken ?? null,
      });
      setData((previous) => {
        if (pageToken && previous) {
          return {
            ...result,
            results: [...previous.results, ...result.results],
          };
        }
        return result;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const configured = config?.configured ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-sipzy-text">Google Lead Finder</h2>
        <p className="mt-1 text-sm text-sipzy-muted">
          Discover local food and beverage businesses with Google Places. Results are review-only and are not automatically saved to the CRM.
        </p>
      </div>

      {!configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Google Places API key is not configured.</p>
          <p className="mt-1">
            Set <code>GOOGLE_PLACES_API_KEY</code> on the backend and restart the server. The key is never sent to the browser.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-sipzy-muted" htmlFor="glf-city">
              City
            </label>
            <input
              id="glf-city"
              className={inputClass}
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="Bengaluru"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-sipzy-muted" htmlFor="glf-category">
              Business category
            </label>
            <select
              id="glf-category"
              className={inputClass}
              value={category}
              onChange={(event) => setCategory(event.target.value as (typeof CATEGORIES)[number])}
            >
              {CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              disabled={searching || !configured || !city.trim()}
              onClick={() => search(null)}
              className="w-full rounded-lg bg-sipzy-green px-4 py-2 text-sm font-medium text-white transition hover:bg-sipzy-green-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {searching ? 'Searching…' : 'Search Google Places'}
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {data && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-sipzy-muted">
              {data.results.length} result{data.results.length === 1 ? '' : 's'} for {data.query.category} in {data.query.city}
            </p>
            <p className="text-xs text-sipzy-muted">{data.attribution}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {data.results.map((place) => (
              <article key={place.place_id} className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-sipzy-text">{place.name || 'Unnamed business'}</h3>
                    <p className="text-xs text-sipzy-muted">{place.category}</p>
                  </div>
                  {place.business_status && (
                    <span className="rounded-full bg-sipzy-hover px-2.5 py-0.5 text-[11px] font-medium text-sipzy-muted">
                      {place.business_status}
                    </span>
                  )}
                </div>
                {place.address && <p className="mt-2 text-sm text-sipzy-muted">{place.address}</p>}
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-sipzy-muted">
                  {place.rating !== null && <span>★ {place.rating} ({place.user_rating_count ?? 0})</span>}
                  {place.phone && <span>{place.phone}</span>}
                  {place.website && <a className="text-sipzy-blue underline" href={place.website} target="_blank" rel="noreferrer">Website</a>}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {place.crm_matches.existing_lead_ids.length > 0 && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
                      Possible existing lead
                    </span>
                  )}
                  {place.crm_matches.suppressed && (
                    <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-medium text-red-800">
                      Suppressed contact
                    </span>
                  )}
                  <button
                    type="button"
                    className="rounded-lg border border-sipzy-border px-3 py-1 text-xs font-medium text-sipzy-text hover:bg-sipzy-hover"
                    onClick={() => setSelected(place)}
                  >
                    Review
                  </button>
                  {place.google_maps_url && (
                    <a
                      className="rounded-lg border border-sipzy-border px-3 py-1 text-xs font-medium text-sipzy-blue hover:bg-sipzy-hover"
                      href={place.google_maps_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open in Google Maps
                    </a>
                  )}
                </div>
                <p className="mt-3 text-[11px] text-sipzy-muted">
                  Place ID: <span className="font-mono">{place.place_id}</span>
                </p>
              </article>
            ))}
          </div>

          {data.next_page_token && (
            <div className="flex justify-center">
              <button
                type="button"
                disabled={searching}
                onClick={() => search(data.next_page_token)}
                className="rounded-lg border border-sipzy-border px-4 py-2 text-sm font-medium text-sipzy-text hover:bg-sipzy-hover disabled:opacity-50"
              >
                Load more
              </button>
            </div>
          )}

          <div className="rounded-xl border border-sipzy-border bg-sipzy-hover/40 p-4 text-xs text-sipzy-muted">
            <p className="font-semibold text-sipzy-text">Policy safeguards</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Google Places content is not automatically copied into the CRM.</li>
              <li>Place IDs may be retained; other fields should be treated as transient and verified independently.</li>
              <li>Suppressed contacts can never become outreach-ready, even if a matching business is discovered.</li>
              <li>{data.attribution}</li>
            </ul>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-sipzy-text">{selected.name}</h3>
                <p className="text-sm text-sipzy-muted">{selected.category}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg border border-sipzy-border px-3 py-1 text-sm text-sipzy-text hover:bg-sipzy-hover"
              >
                Close
              </button>
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <Detail label="Address" value={selected.address} />
              <Detail label="Phone" value={selected.phone} />
              <Detail label="Website" value={selected.website} />
              <Detail label="Rating" value={selected.rating !== null ? `${selected.rating} (${selected.user_rating_count ?? 0} reviews)` : undefined} />
              <Detail label="Business status" value={selected.business_status ?? undefined} />
              <Detail label="Place ID" value={selected.place_id} />
              <Detail label="Google types" value={selected.google_types.join(', ')} />
              <Detail label="CRM matches" value={selected.crm_matches.existing_lead_ids.length ? selected.crm_matches.existing_lead_ids.join(', ') : 'None'} />
            </dl>
            <p className="mt-4 text-xs text-sipzy-muted">
              This result is review-only. If you want to contact the business, create and verify a lead manually using independently sourced information.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

const Detail: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div>
    <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">{label}</dt>
    <dd className="mt-1 text-sm text-sipzy-text">{value || '—'}</dd>
  </div>
);

export default GoogleLeadFinder;
