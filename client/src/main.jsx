import { StrictMode, useEffect, useState, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './theme.css';
import { Spinner } from './components/ui.jsx';

const Login = lazy(() => import('./pages/Login.jsx'));
const Register = lazy(() => import('./pages/Register.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Invoice = lazy(() => import('./pages/Invoice.jsx'));
const Staff = lazy(() => import('./staff/Staff.jsx'));

function App() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => { setPath(window.location.pathname); window.scrollTo(0, 0); };
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  let page;
  if (path.startsWith('/staff')) page = <Staff path={path} />;
  else if (path.startsWith('/invoice/')) page = <Invoice token={path.split('/')[2]} />;
  else if (path === '/register') page = <Register />;
  else if (path === '/login') page = <Login />;
  else page = <Dashboard />;
  return <Suspense fallback={<div className="shell center" style={{ paddingTop: 80 }}><Spinner /></div>}>{page}</Suspense>;
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
