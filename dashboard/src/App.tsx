import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, Calendar, HelpCircle, Smartphone, LogOut, Sun, Moon, Plus } from 'lucide-react';

// Import Pages
import Login from './pages/Login';
import Analytics from './pages/Analytics';
import Doctors from './pages/Doctors';
import Appointments from './pages/Appointments';
import Patients from './pages/Patients';
import KB from './pages/KB';
import Monitoring from './pages/Monitoring';

function DashboardLayout({ user, onLogout }: { user: any; onLogout: () => void }) {
  // index.html starts with class="dark" — toggle switches to light class
  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') !== 'light');
  const location = useLocation();

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  const navItems = [
    { label: 'Analytics', path: '/', icon: LayoutDashboard },
    { label: 'Appointments', path: '/appointments', icon: Calendar },
    { label: 'Patients', path: '/patients', icon: Users },
    { label: 'Doctors', path: '/doctors', icon: Users },
    { label: 'Knowledge Base', path: '/kb', icon: HelpCircle },
    { label: 'Monitoring', path: '/monitor', icon: Smartphone }
  ];

  return (
    <div className="flex min-h-screen bg-bg-primary text-text-main font-body transition-all duration-300">
      
      {/* Sidebar - Desktop */}
      <aside className="hidden md:flex flex-col w-64 glass-panel m-4 border border-card-border p-5 justify-between relative overflow-hidden shrink-0">
        <div className="absolute -top-16 -left-16 w-32 h-32 rounded-full bg-accent-color/10 blur-xl"></div>
        
        <div className="space-y-8 relative">
          <div className="flex items-center gap-3 border-b border-card-border/50 pb-4">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-teal-400 to-violet-600 flex items-center justify-center text-white font-extrabold font-hero text-lg">
              V
            </div>
            <div>
              <h2 className="font-extrabold font-hero text-lg tracking-tight bg-gradient-to-r from-teal-400 to-violet-500 bg-clip-text text-transparent">
                VardanAI
              </h2>
              <span className="text-[10px] text-text-muted capitalize">{user.role} console</span>
            </div>
          </div>

          <nav className="space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                    isActive
                      ? 'bg-gradient-to-r from-teal-500 to-violet-600 text-white shadow-md'
                      : 'text-text-muted hover:bg-card-border/20 hover:text-text-main'
                  }`}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="space-y-4 pt-4 border-t border-card-border/50 relative">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>Welcome, {user.name}</span>
            <button
              onClick={() => setIsDark(!isDark)}
              className="p-2 hover:bg-white/10 rounded-lg text-text-main"
            >
              {isDark ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold rounded-xl text-sm transition-all"
          >
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 md:p-4">
        {/* Header - Mobile only */}
        <header className="md:hidden flex items-center justify-between p-4 border-b border-card-border bg-card-bg/25 backdrop-blur-md">
          <h1 className="font-extrabold font-hero text-xl tracking-tight bg-gradient-to-r from-teal-400 to-violet-500 bg-clip-text text-transparent">
            VardanAI
          </h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsDark(!isDark)}
              className="p-2 hover:bg-white/10 rounded-lg text-text-main"
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button onClick={onLogout} className="p-2 text-red-400">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {/* Central Router Pages Display */}
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Analytics />} />
            <Route path="/doctors" element={<Doctors userRole={user.role} />} />
            <Route path="/appointments" element={<Appointments />} />
            <Route path="/patients" element={<Patients />} />
            <Route path="/kb" element={<KB />} />
            <Route path="/monitor" element={<Monitoring />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        {/* Bottom Nav + Center FAB - Mobile layout */}
        <nav className="md:hidden glass-panel border-t border-card-border p-2 flex items-center justify-around relative">
          {navItems.slice(0, 2).map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link key={item.path} to={item.path} className={`flex flex-col items-center gap-1 text-[10px] ${isActive ? 'text-accent-color' : 'text-text-muted'}`}>
                <Icon size={20} />
                <span>{item.label.split(' ')[0]}</span>
              </Link>
            );
          })}

          {/* Center FAB for quick booking */}
          <Link
            to="/appointments"
            className="w-12 h-12 rounded-full bg-gradient-to-tr from-teal-400 to-violet-600 flex items-center justify-center text-white shadow-xl absolute -top-5 left-1/2 transform -translate-x-1/2 border-4 border-bg-primary hover:scale-105 active:scale-95 transition-all"
          >
            <Plus size={24} />
          </Link>

          <div className="w-12"></div> {/* Spacer for FAB */}

          {navItems.slice(2, 4).map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link key={item.path} to={item.path} className={`flex flex-col items-center gap-1 text-[10px] ${isActive ? 'text-accent-color' : 'text-text-muted'}`}>
                <Icon size={20} />
                <span>{item.label.split(' ')[0]}</span>
              </Link>
            );
          })}
        </nav>
      </div>

    </div>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [user, setUser] = useState<{ name: string; username: string; role: string } | null>(null);
  const [loading, setLoading] = useState(!!token);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        } else {
          // Token expired or invalid
          handleLogout();
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [token]);

  const handleLoginSuccess = (newToken: string, loggedUser: { name: string; username: string; role: string }) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
    setUser(loggedUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950 text-white font-body">
        <p className="animate-pulse">Loading administration console...</p>
      </div>
    );
  }

  return (
    <Router>
      {token && user ? (
        <DashboardLayout user={user} onLogout={handleLogout} />
      ) : (
        <Routes>
          <Route path="/login" element={<Login onLoginSuccess={handleLoginSuccess} />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      )}
    </Router>
  );
}
