import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useMobileSidebar } from '../hooks/useMobileSidebar';

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/leads': 'Business Leads',
  '/enquiries': 'Enquiries',
  '/catalogue': 'Product Catalogue',
  '/activity': 'Outreach Activity',
  '/analyzer': 'Message Analyzer',
  '/suppressions': 'Suppressed Contacts',
};

/**
 * Layout — app shell: sidebar, top bar and routed page content.
 */
const Layout: React.FC = () => {
  const { sidebarOpen, toggleSidebar, closeSidebar } = useMobileSidebar();
  const location = useLocation();
  const title = TITLES[location.pathname] ?? 'Dashboard';

  return (
    <div className="flex min-h-screen bg-sipzy-cream">
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-sipzy-border bg-sipzy-cream/90 px-4 backdrop-blur md:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-2 text-sipzy-text hover:bg-sipzy-hover lg:hidden"
              onClick={toggleSidebar}
              aria-label="Open menu"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-sipzy-muted">
                SIPZY Workspace
              </p>
              <h1 className="text-sm font-semibold text-sipzy-text">{title}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full border border-sipzy-border bg-white px-3 py-1 text-xs font-medium text-sipzy-muted sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-sipzy-green-light" />
              Live data
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sipzy-green text-xs font-semibold text-white">
              S
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>

        <footer className="border-t border-sipzy-border px-4 py-3 text-xs text-sipzy-muted md:px-6 lg:px-8">
          SIPZY Marketing Dashboard · v0.2.0
        </footer>
      </div>
    </div>
  );
};

export default Layout;
