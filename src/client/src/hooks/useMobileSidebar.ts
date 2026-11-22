import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * useMobileSidebar — controls the mobile navigation drawer.
 *
 * Closes automatically whenever the route changes.
 */
export function useMobileSidebar() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return { sidebarOpen, toggleSidebar, closeSidebar };
}
