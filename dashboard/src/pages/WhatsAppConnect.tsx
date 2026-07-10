import { useState, useEffect, useRef } from 'react';
import { Smartphone, RefreshCw, CheckCircle, XCircle, Clock, Wifi } from 'lucide-react';

export default function WhatsAppConnect() {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('connecting');
  const [qrString, setQrString] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/monitor/status', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!res.ok) throw new Error('Auth required');
      const data = await res.json();
      setStatus(data.whatsapp?.status ?? 'disconnected');
      setQrString(data.whatsapp?.qrString ?? null);
      setLastRefresh(new Date());
      setError('');
    } catch (err: any) {
      setError('Could not reach server');
    }
  };

  useEffect(() => {
    fetchStatus();
    // Poll every 4 seconds for live QR experience
    intervalRef.current = setInterval(fetchStatus, 4000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const qrUrl = qrString
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=10&data=${encodeURIComponent(qrString)}`
    : null;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6 overflow-y-auto max-h-[calc(100vh-120px)]">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-green-400 to-teal-500 flex items-center justify-center">
            <Smartphone size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold font-hero text-white">WhatsApp Connect</h1>
            <p className="text-sm" style={{ color: 'hsl(240 8% 62%)' }}>Pair your phone to activate the bot</p>
          </div>
        </div>
        <button
          onClick={fetchStatus}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white border border-white/10 hover:bg-white/10 transition-all"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Status Badge */}
      <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl border font-semibold text-sm ${
        status === 'connected'
          ? 'bg-green-500/15 border-green-500/30 text-green-400'
          : status === 'connecting'
          ? 'bg-yellow-500/15 border-yellow-500/30 text-yellow-400'
          : 'bg-red-500/15 border-red-500/30 text-red-400'
      }`}>
        {status === 'connected' ? <CheckCircle size={18} /> : status === 'connecting' ? <Clock size={18} className="animate-spin" /> : <XCircle size={18} />}
        <span>
          {status === 'connected' ? '✅ WhatsApp Bot is Connected & Active' :
           status === 'connecting' ? '⏳ Connecting... QR code generating' :
           '❌ Disconnected'}
        </span>
        <span className="ml-auto text-xs opacity-60">Updated: {lastRefresh.toLocaleTimeString()}</span>
      </div>

      {/* Main Panel */}
      <div className="rounded-2xl border border-white/10 overflow-hidden" style={{ background: 'rgba(30,27,60,0.6)', backdropFilter: 'blur(20px)' }}>
        
        {status === 'connected' ? (
          /* Connected State */
          <div className="p-12 flex flex-col items-center gap-4 text-center">
            <div className="w-24 h-24 rounded-full bg-green-500/15 border-2 border-green-500/30 flex items-center justify-center">
              <Wifi size={48} className="text-green-400" />
            </div>
            <h2 className="text-2xl font-extrabold font-hero text-white">Bot is Live!</h2>
            <p style={{ color: 'hsl(240 8% 62%)' }} className="text-sm max-w-sm">
              WhatsApp bot is actively receiving patient messages and responding via AI. 
              Go to Analytics to monitor conversations.
            </p>
            <div className="mt-4 px-6 py-3 rounded-xl text-xs font-mono bg-green-500/10 border border-green-500/20 text-green-300">
              Vardan Hospital Bot — Online
            </div>
          </div>
        ) : qrUrl ? (
          /* QR Code State */
          <div className="p-8 flex flex-col items-center gap-6">
            <div className="text-center">
              <h2 className="text-xl font-extrabold font-hero text-white mb-2">Scan QR Code with WhatsApp</h2>
              <p style={{ color: 'hsl(240 8% 62%)' }} className="text-sm">
                Open WhatsApp → <strong className="text-white">⋮ Menu</strong> → <strong className="text-white">Linked Devices</strong> → <strong className="text-white">Link a Device</strong>
              </p>
            </div>

            {/* QR Code */}
            <div className="relative">
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-teal-500/30 to-violet-600/30 blur-xl"></div>
              <div className="relative p-4 bg-white rounded-3xl shadow-2xl border-4 border-white/20">
                <img
                  src={qrUrl}
                  alt="WhatsApp QR Code"
                  className="w-64 h-64 block"
                  onError={() => setError('QR image failed to load')}
                />
              </div>
            </div>

            <div className="text-center space-y-1">
              <p className="text-xs text-yellow-400 font-semibold">⚠️ QR code expires in ~60 seconds</p>
              <p style={{ color: 'hsl(240 8% 62%)' }} className="text-xs">Auto-refreshing every 4 seconds</p>
            </div>

            {/* Step by step instructions */}
            <div className="w-full rounded-xl border border-white/10 p-4 space-y-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <p className="text-xs font-bold text-white mb-2">📱 Steps to Connect:</p>
              {[
                'Open WhatsApp on your phone',
                'Tap the three dots (⋮) in top right corner',
                'Select "Linked Devices"',
                'Tap "Link a Device"',
                'Point camera at QR code above'
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-3 text-xs" style={{ color: 'hsl(240 8% 72%)' }}>
                  <span className="w-5 h-5 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-violet-400 font-bold flex-shrink-0">
                    {i + 1}
                  </span>
                  {step}
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* Waiting/Loading State */
          <div className="p-12 flex flex-col items-center gap-4 text-center">
            <div className="w-20 h-20 rounded-full bg-violet-500/15 border-2 border-violet-500/30 flex items-center justify-center">
              <Clock size={40} className="text-violet-400 animate-pulse" />
            </div>
            <h2 className="text-xl font-extrabold font-hero text-white">Generating QR Code...</h2>
            <p style={{ color: 'hsl(240 8% 62%)' }} className="text-sm max-w-sm">
              Server is starting Baileys WhatsApp client. QR code will appear here in 15–30 seconds.
            </p>
            <div className="flex gap-1 mt-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }}></div>
              ))}
            </div>
            {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
          </div>
        )}
      </div>

      {/* Info footer */}
      <div className="text-xs rounded-xl p-4 border border-white/5" style={{ background: 'rgba(255,255,255,0.03)', color: 'hsl(240 8% 55%)' }}>
        <strong className="text-white/60">Note:</strong> After scanning, the bot will start responding to WhatsApp messages at Vardan Hospital's number. 
        The session is saved on the server — you won't need to scan again unless the server restarts.
      </div>
    </div>
  );
}
