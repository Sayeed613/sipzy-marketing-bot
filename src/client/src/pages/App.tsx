import React from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import Dashboard from './Dashboard';
import Leads from './Leads';
import Enquiries from './Enquiries';
import ProductCatalogue from './ProductCatalogue';
import Activity from './Activity';
import MessageAnalyzer from './MessageAnalyzer';
import OutreachComposer from './OutreachComposer';
import Suppressions from './Suppressions';
import GoogleLeadFinder from './GoogleLeadFinder';
import WhatsAppInbox from './WhatsAppInbox';
import Campaigns from './Campaigns';
import AIConversations from './AIConversations';
import SalesWorkflow from './SalesWorkflow';
import TestCampaign from './TestCampaign';
import Login from './Login';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import '../styles/global.css';

const NotFound: React.FC = () => (
  <div className="rounded-xl border border-sipzy-border bg-white p-10 text-center shadow-sm">
    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sipzy-orange">404</p>
    <h2 className="mt-2 text-2xl font-bold text-sipzy-text">Page not found</h2>
    <p className="mt-1 text-sm text-sipzy-muted">The page you are looking for does not exist.</p>
    <Link
      to="/"
      className="mt-6 inline-flex rounded-lg bg-sipzy-green px-4 py-2 text-sm font-medium text-white hover:bg-sipzy-green-hover"
    >
      Back to dashboard
    </Link>
  </div>
);

function SessionLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-sipzy-cream text-sm text-sipzy-muted">
      Checking your session…
    </div>
  );
}

/** Redirects to /login when there is no valid session. */
const Protected: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <SessionLoading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
};

/**
 * App — application shell and route table.
 * Every dashboard route requires an authenticated session.
 */
const App: React.FC = () => (
  <BrowserRouter>
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/enquiries" element={<Enquiries />} />
          <Route path="/catalogue" element={<ProductCatalogue />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/outreach-composer" element={<OutreachComposer />} />
          <Route path="/analyzer" element={<MessageAnalyzer />} />
          <Route path="/suppressions" element={<Suppressions />} />
          <Route path="/google-lead-finder" element={<GoogleLeadFinder />} />
          <Route path="/whatsapp-inbox" element={<WhatsAppInbox />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/test-campaign" element={<TestCampaign />} />
          <Route path="/ai-conversations" element={<AIConversations />} />
          <Route path="/sales-workflow" element={<SalesWorkflow />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
