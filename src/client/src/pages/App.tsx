import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Layout from '../components/Layout';
import Dashboard from './Dashboard';
import Leads from './Leads';
import Enquiries from './Enquiries';
import ProductCatalogue from './ProductCatalogue';
import Activity from './Activity';
import MessageAnalyzer from './MessageAnalyzer';
import Suppressions from './Suppressions';
import GoogleLeadFinder from './GoogleLeadFinder';
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

/**
 * App — application shell and route table.
 */
const App: React.FC = () => (
  <BrowserRouter>
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/enquiries" element={<Enquiries />} />
        <Route path="/catalogue" element={<ProductCatalogue />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/analyzer" element={<MessageAnalyzer />} />
        <Route path="/suppressions" element={<Suppressions />} />
        <Route path="/google-lead-finder" element={<GoogleLeadFinder />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  </BrowserRouter>
);

export default App;
