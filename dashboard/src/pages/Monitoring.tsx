import { useState, useEffect } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Smartphone, RefreshCw, AlertTriangle, Key, Cpu, Zap } from 'lucide-react';

interface LLMKeyInfo {
  id: number;
  provider: 'groq' | 'gemini' | 'openrouter';
  key: string;
  usage: number;
  active: number;
  coolingDown: boolean;
}

interface TelemetryInfo {
  provider: string;
  avg_latency: number;
  success_rate: number;
}

interface AgentInfo {
  name: string;
  description: string;
  lastActive: string;
  status: string;
}

export default function Monitoring() {
  const [whatsapp, setWhatsapp] = useState<{ status: string; qrAvailable: boolean; qrString: string | null } | null>(null);
  const [keys, setKeys] = useState<LLMKeyInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/monitor/status', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await res.json();
      setWhatsapp(data.whatsapp);
      setKeys(data.keys);
      setAgents(data.agents || []);
      setTelemetry(data.telemetry);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Poll status every 5 seconds for live QR scanning experience
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    if (status === 'connected') return 'text-green-400 bg-green-500/10 border-green-500/20';
    if (status === 'connecting') return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
    return 'text-red-400 bg-red-500/10 border-red-500/20';
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8 overflow-y-auto max-h-[calc(100vh-120px)]">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold font-hero text-text-main">System Health & Keys</h1>
          <p className="text-text-muted mt-1 font-body">Monitor WhatsApp connection, audit rotating API key cooldowns, and view latency telemetry.</p>
        </div>
        <button
          onClick={fetchStatus}
          className="flex items-center gap-2 px-4 py-2.5 bg-card-bg border border-card-border hover:bg-card-border/20 text-text-main font-semibold rounded-xl text-sm font-body transition-all"
        >
          <RefreshCw size={16} />
          <span>Refresh Status</span>
        </button>
      </div>

      {/* 4 Agents Status Grid */}
      {!loading && agents.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Cpu size={20} className="text-accent-color animate-pulse" />
            <h2 className="text-xl font-bold font-hero text-text-main">AI Orchestrator & Agents Console</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {agents.map(a => (
              <div key={a.name} className="glass-panel p-4 border border-card-border space-y-3 relative overflow-hidden flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-bold text-text-main text-xs font-hero">{a.name}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-[8px] font-extrabold capitalize ${
                      a.status === 'Active' || a.status === 'Running' 
                        ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                        : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}>
                      {a.status}
                    </span>
                  </div>
                  <p className="text-text-muted text-[11px] font-body leading-relaxed">{a.description}</p>
                </div>
                <div className="text-[10px] text-text-muted/70 font-body border-t border-card-border/35 pt-2 flex items-center justify-between">
                  <span>Last Active:</span>
                  <span className="text-text-main font-semibold font-mono">
                    {a.lastActive !== 'Never' ? new Date(a.lastActive).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Never'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-text-muted font-body">Polling telemetry status...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left: WhatsApp Session Connection Status */}
          <div className="lg:col-span-1 space-y-6">
            <div className="flex items-center gap-2">
              <Smartphone size={20} className="text-accent-color" />
              <h2 className="text-xl font-bold font-hero text-text-main">WhatsApp Connection</h2>
            </div>

            <div className="glass-panel p-6 border border-card-border flex flex-col items-center justify-center text-center gap-4 relative overflow-hidden">
              <div className="absolute -left-12 -top-12 w-28 h-28 rounded-full bg-accent-color/10 blur-xl"></div>
              
              <div className={`px-4 py-2 border rounded-full text-sm font-bold font-body capitalize ${getStatusColor(whatsapp?.status || 'disconnected')}`}>
                Client: {whatsapp?.status}
              </div>

              {whatsapp?.status === 'connected' ? (
                <div className="py-12 flex flex-col items-center gap-2">
                  <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center text-green-400 mb-2 border border-green-500/20">
                    <Smartphone size={32} />
                  </div>
                  <h3 className="font-bold text-text-main text-lg font-hero">System Link Active</h3>
                  <p className="text-text-muted text-xs font-body max-w-xs">WhatsApp bot is actively listening and answering patient queries.</p>
                </div>
              ) : whatsapp?.qrString ? (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-text-muted text-xs font-body max-w-[250px]">
                    Scan this QR code using Link Device in your WhatsApp app to pair the bot.
                  </p>
                  <div className="p-3 bg-white rounded-2xl border-4 border-card-border shadow-lg">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(whatsapp.qrString)}`}
                      alt="WhatsApp QR Code"
                      className="w-48 h-48 block"
                    />
                  </div>
                </div>
              ) : (
                <div className="py-12 flex flex-col items-center gap-2 text-text-muted font-body text-sm">
                  <AlertTriangle size={32} className="text-yellow-400 mb-2" />
                  <p>Initializing Baileys daemon...</p>
                  <p className="text-xs">QR code will appear here shortly if unauthorized.</p>
                </div>
              )}
            </div>
          </div>

          {/* Right: LLM Rotating Keys Pool status */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center gap-2">
              <Key size={20} className="text-violet-400" />
              <h2 className="text-xl font-bold font-hero text-text-main">Rotated LLM Keys Pool</h2>
            </div>

            <div className="glass-panel p-5 border border-card-border space-y-5">
              <div className="grid grid-cols-3 gap-4 font-body text-center text-xs">
                {['groq', 'gemini', 'openrouter'].map(prov => {
                  const provKeys = keys.filter(k => k.provider === prov);
                  const activeCount = provKeys.filter(k => k.active && !k.coolingDown).length;
                  return (
                    <div key={prov} className="p-3 bg-black/10 rounded-xl border border-card-border/30">
                      <div className="capitalize font-bold text-text-main text-sm mb-1">{prov}</div>
                      <div className="text-text-muted">
                        Online: <span className="text-accent-color font-bold">{activeCount} / {provKeys.length}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Grid List of all 24 Keys */}
              <div className="max-h-64 overflow-y-auto pr-1 border-t border-card-border/40 pt-4">
                <div className="grid grid-cols-4 md:grid-cols-8 gap-2.5 font-body">
                  {keys.map((k, idx) => (
                    <div
                      key={k.id}
                      className={`p-2.5 rounded-lg border flex flex-col items-center justify-center text-center relative ${
                        k.coolingDown 
                          ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400' 
                          : 'border-card-border/60 bg-card-bg/20 text-text-main'
                      }`}
                      title={`${k.provider.toUpperCase()} Key ${idx + 1}`}
                    >
                      <div className="text-[10px] uppercase font-bold tracking-wider opacity-60">
                        {k.provider.slice(0, 4)}
                      </div>
                      <div className="text-sm font-bold font-hero mt-1">
                        #{k.id}
                      </div>
                      <div className="text-[9px] mt-0.5 text-text-muted">
                        Calls: {k.usage}
                      </div>
                      <div className="text-[8px] mt-1 text-accent-color font-mono opacity-85 select-all truncate w-full" title={k.key}>
                        {k.key}
                      </div>

                      {k.coolingDown && (
                        <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-yellow-500 rounded-full border border-black animate-pulse" title="Cooling Down"></div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Latency & API success rate telemetry */}
      {!loading && telemetry.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Latency Chart */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Zap size={20} className="text-yellow-400" />
              <h2 className="text-xl font-bold font-hero text-text-main">Average Response Latency (24h)</h2>
            </div>
            <div className="glass-panel p-5 border border-card-border h-64 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={telemetry} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="provider" stroke="#888" tickLine={false} style={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans', textTransform: 'capitalize' }} />
                  <YAxis stroke="#888" tickLine={false} style={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans' }} unit="ms" />
                  <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: 8, fontSize: 12, fontFamily: 'Plus Jakarta Sans' }} />
                  <Bar dataKey="avg_latency" fill="url(#latencyGrad)" radius={[8, 8, 0, 0]}>
                    <defs>
                      <linearGradient id="latencyGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(265, 85%, 60%)" />
                        <stop offset="100%" stopColor="hsl(180, 80%, 40%)" />
                      </linearGradient>
                    </defs>
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Success Rate Chart */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Cpu size={20} className="text-teal-400" />
              <h2 className="text-xl font-bold font-hero text-text-main">API Call Success Rates (24h)</h2>
            </div>
            <div className="glass-panel p-5 border border-card-border h-64 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={telemetry} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="provider" stroke="#888" tickLine={false} style={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans', textTransform: 'capitalize' }} />
                  <YAxis stroke="#888" tickLine={false} style={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans' }} unit="%" domain={[0, 100]} />
                  <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: 8, fontSize: 12, fontFamily: 'Plus Jakarta Sans' }} />
                  <Bar dataKey="success_rate" fill="url(#successGrad)" radius={[8, 8, 0, 0]}>
                    <defs>
                      <linearGradient id="successGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(180, 80%, 40%)" />
                        <stop offset="100%" stopColor="hsl(200, 85%, 45%)" />
                      </linearGradient>
                    </defs>
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
