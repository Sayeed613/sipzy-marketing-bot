import React from 'react';
import { NavLink } from 'react-router-dom';

interface SidebarProps {
  /** Whether the mobile drawer is open. */
  open: boolean;
  /** Close the mobile drawer (called on navigation / backdrop click). */
  onClose: () => void;
}

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: 'M3 12l9-9 9 9M9 21V9h6v12M9 21h6' },
  {
    to: '/leads',
    label: 'Business Leads',
    icon: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87M16 3.13a4 4 0 010 7.75M12 7a3 3 0 013 3v2H6v-2a3 3 0 013-3z',
  },
  {
    to: '/enquiries',
    label: 'Enquiries',
    icon: 'M8 10h8M8 14h5m-5 4h11a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z',
  },
  {
    to: '/suppressions',
    label: 'Suppressed Contacts',
    icon: 'M12 3l8 4v6c0 5-3.5 8-8 8s-8-3-8-8V7l8-4zM12 8v4m0 3h.01',
  },
  {
    to: '/google-lead-finder',
    label: 'Google Lead Finder',
    icon: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 119.5 9 2.5 2.5 0 0112 11.5z',
  },
  {
    to: '/catalogue',
    label: 'Product Catalogue',
    icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v12m0 0l-8-4m8 4l-8 4M12 11v6m0 0l-8-4',
  },
  {
    to: '/activity',
    label: 'Outreach Activity',
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    to: '/analyzer',
    label: 'Message Analyzer',
    icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
  },
];

/**
 * Sidebar — primary navigation for the dashboard.
 * Always visible on desktop; a slide-in drawer on mobile.
 */
const Sidebar: React.FC<SidebarProps> = ({ open, onClose }) => {
  return (
    <>
      {/* Backdrop (mobile only) */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-sipzy-overlay lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 shrink-0 bg-sipzy-green text-white flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 lg:w-60 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Main navigation"
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-5 h-16 border-b border-white/10">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sipzy-orange text-sm font-bold">
            S
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide">SIPZY</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/60">Marketing Bot</p>
          </div>
          <button
            className="ml-auto rounded-md p-1.5 text-white/70 hover:bg-white/10 lg:hidden"
            onClick={onClose}
            aria-label="Close menu"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
            Workspace
          </p>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white/15 text-white shadow-sm ring-1 ring-white/10'
                    : 'text-white/75 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <svg
                    className={`h-5 w-5 shrink-0 ${isActive ? 'text-sipzy-orange' : 'text-white/60'}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                  </svg>
                  <span className="truncate">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-xs font-bold">
              S
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">SIPZY Team</p>
              <p className="truncate text-xs text-white/50">Marketing workspace</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
