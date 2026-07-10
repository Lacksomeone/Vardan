import { useState, useEffect, useRef } from 'react';
import { Smartphone, RefreshCw, CheckCircle, XCircle, Clock, Wifi, RotateCcw, Loader2, Phone } from 'lucide-react';

export default function WhatsAppConnect() {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('connecting');
  const [qrString, setQrString] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [restarting, setRestarting] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
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
      setPairingCode(data.whatsapp?.pairingCode ?? null);
      setServerError(data.whatsapp?.lastError ?? null);
      setLastRefresh(new Date());
      setFetchError('');
    } catch (err: any) {
      setFetchError('Could not reach server');
    }
  };

  const handleRestart = async (usePhone = false) => {
    setRestarting(true);
    setQrString(null);
    setPairingCode(null);
    try {
      await fetch('/api/whatsapp/restart', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ phone: usePhone ? phoneInput : undefined })
      });
      setTimeout(() => { setRestarting(false); fetchStatus(); }, 12000);
    } catch {
      setRestarting(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, 4000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const qrUrl = qrString
    ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=${encodeURIComponent(qrString)}`
    : null;

  // Format pairing code: ABCD-EFGH
  const formattedCode = pairingCode
    ? pairingCode.replace(/(.{4})(.{4})/, '$1-$2')
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
        <button onClick={fetchStatus}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white border border-white/10 hover:bg-white/10 transition-all">
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Status Badge */}
      <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl border font-semibold text-sm ${
        status === 'connected'   ? 'bg-green-500/15 border-green-500/30 text-green-400' :
        status === 'connecting'  ? 'bg-yellow-500/15 border-yellow-500/30 text-yellow-400' :
                                   'bg-red-500/15 border-red-500/30 text-red-400'
      }`}>
        {status === 'connected'  ? <CheckCircle size={18} /> :
         status === 'connecting' ? <Clock size={18} className="animate-spin" /> :
                                   <XCircle size={18} />}
        <span>
          {status === 'connected'  ? '✅ WhatsApp Bot is Connected & Active' :
           status === 'connecting' ? '⏳ Connecting... waiting for pairing' :
                                     '❌ Disconnected'}
        </span>
        <span className="ml-auto text-xs opacity-60">{lastRefresh.toLocaleTimeString()}</span>
      </div>

      {/* Main Panel */}
      <div className="rounded-2xl border border-white/10 overflow-hidden"
        style={{ background: 'rgba(30,27,60,0.6)', backdropFilter: 'blur(20px)' }}>

        {status === 'connected' ? (
          /* ── CONNECTED ── */
          <div className="p-12 flex flex-col items-center gap-4 text-center">
            <div className="w-24 h-24 rounded-full bg-green-500/15 border-2 border-green-500/30 flex items-center justify-center">
              <Wifi size={48} className="text-green-400" />
            </div>
            <h2 className="text-2xl font-extrabold font-hero text-white">Bot is Live! 🎉</h2>
            <p style={{ color: 'hsl(240 8% 62%)' }} className="text-sm max-w-sm">
              WhatsApp bot is actively receiving patient messages and responding via AI.
            </p>
            <div className="mt-4 px-6 py-3 rounded-xl text-xs font-mono bg-green-500/10 border border-green-500/20 text-green-300">
              Vardan Hospital Bot — Online
            </div>
          </div>

        ) : restarting ? (
          /* ── RESTARTING ── */
          <div className="p-12 flex flex-col items-center gap-4 text-center">
            <Loader2 size={48} className="text-teal-400 animate-spin" />
            <h2 className="text-xl font-extrabold font-hero text-white">Restarting WhatsApp...</h2>
            <p style={{ color: 'hsl(240 8% 62%)' }} className="text-sm">Clearing session & requesting pairing code. ~12 seconds...</p>
          </div>

        ) : formattedCode ? (
          /* ── PAIRING CODE ── */
          <div className="p-8 flex flex-col items-center gap-6">
            <div className="text-center">
              <h2 className="text-xl font-extrabold font-hero text-white mb-1">Enter This Code in WhatsApp</h2>
              <p style={{ color: 'hsl(240 8% 62%)' }} className="text-sm">
                Go to WhatsApp → <strong className="text-white">⋮</strong> → <strong className="text-white">Linked Devices</strong> → <strong className="text-white">Link with Phone Number</strong>
              </p>
            </div>

            {/* Big pairing code display */}
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-teal-500/20 to-violet-600/20 blur-xl"></div>
              <div className="relative px-10 py-6 rounded-2xl border-2 border-teal-500/30 bg-black/30">
                <p className="text-5xl font-extrabold font-mono tracking-[0.3em] text-white text-center">
                  {formattedCode}
                </p>
              </div>
            </div>

            <div className="text-center space-y-1">
              <p className="text-yellow-400 text-xs font-semibold">⚠️ Code expires in ~60 seconds</p>
              <p style={{ color: 'hsl(240 8% 55%)' }} className="text-xs">Auto-refreshing every 4 seconds</p>
            </div>

            {/* Steps */}
            <div className="w-full rounded-xl border border-white/10 p-4 space-y-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <p className="text-xs font-bold text-white mb-2">📱 Steps to Enter Code:</p>
              {[
                'Open WhatsApp on your phone',
                'Tap ⋮ (three dots) → Linked Devices',
                'Tap "Link a Device"',
                'Tap "Link with phone number instead"',
                `Enter the code: ${formattedCode}`
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-3 text-xs" style={{ color: 'hsl(240 8% 72%)' }}>
                  <span className="w-5 h-5 rounded-full bg-teal-500/20 border border-teal-500/30 flex items-center justify-center text-teal-400 font-bold flex-shrink-0">
                    {i + 1}
                  </span>
                  {step === `Enter the code: ${formattedCode}` ? (
                    <span>Enter the code: <strong className="text-white font-mono">{formattedCode}</strong></span>
                  ) : step}
                </div>
              ))}
            </div>
          </div>

        ) : qrUrl ? (
          /* ── QR CODE (fallback) ── */
          <div className="p-8 flex flex-col items-center gap-6">
            <div className="text-center">
              <h2 className="text-xl font-extrabold font-hero text-white mb-2">Scan QR Code with WhatsApp</h2>
              <p style={{ color: 'hsl(240 8% 62%)' }} className="text-sm">
                WhatsApp → <strong className="text-white">⋮ Menu</strong> → <strong className="text-white">Linked Devices</strong> → <strong className="text-white">Link a Device</strong>
              </p>
            </div>
            <div className="relative">
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-teal-500/30 to-violet-600/30 blur-xl"></div>
              <div className="relative p-4 bg-white rounded-3xl shadow-2xl">
                <img src={qrUrl} alt="WhatsApp QR" className="w-56 h-56 block" />
              </div>
            </div>
            <p className="text-yellow-400 text-xs font-semibold">⚠️ QR expires in ~60 sec — auto-refreshing</p>
          </div>

        ) : (
          /* ── WAITING / NO CODE YET ── */
          <div className="p-8 space-y-6">
            {/* Phone number input for pairing code */}
            <div className="text-center space-y-2">
              <h2 className="text-xl font-extrabold font-hero text-white">Connect via Pairing Code</h2>
              <p style={{ color: 'hsl(240 8% 62%)' }} className="text-sm max-w-sm mx-auto">
                Enter your WhatsApp number (with country code) to get an 8-digit pairing code. No QR scan needed!
              </p>
            </div>

            <div className="flex gap-3">
              <div className="flex items-center gap-2 flex-1 px-4 py-3 rounded-xl border border-white/15 bg-white/5">
                <Phone size={16} className="text-teal-400 flex-shrink-0" />
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={e => setPhoneInput(e.target.value)}
                  placeholder="e.g. 919876543210 (with country code)"
                  className="bg-transparent text-white placeholder-white/30 text-sm w-full outline-none font-body"
                />
              </div>
              <button
                onClick={() => handleRestart(true)}
                disabled={!phoneInput.trim() || phoneInput.replace(/\D/g,'').length < 10}
                className="px-5 py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-teal-500 to-violet-600 hover:from-teal-600 hover:to-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg active:scale-95 whitespace-nowrap"
              >
                Get Code
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-white/10"></div>
              <span style={{ color: 'hsl(240 8% 45%)' }} className="text-xs">or</span>
              <div className="flex-1 h-px bg-white/10"></div>
            </div>

            <div className="flex flex-col items-center gap-3">
              {serverError && (
                <div className="w-full px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                  <strong>Error:</strong> {serverError}
                </div>
              )}
              {fetchError && <p className="text-red-400 text-xs">{fetchError}</p>}

              <div className="flex gap-1">
                {[0,1,2].map(i => (
                  <div key={i} className="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: `${i*0.15}s` }}></div>
                ))}
              </div>
              <p style={{ color: 'hsl(240 8% 55%)' }} className="text-xs">Waiting for QR/pairing code... auto-refreshing</p>

              <button
                onClick={() => handleRestart(false)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm text-white/70 border border-white/10 hover:bg-white/10 transition-all"
              >
                <RotateCcw size={14} />
                Restart without phone number (use QR)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="text-xs rounded-xl p-4 border border-white/5" style={{ background: 'rgba(255,255,255,0.03)', color: 'hsl(240 8% 50%)' }}>
        <strong className="text-white/50">💡 Tip:</strong> Pairing Code works even on cloud servers where QR code is blocked.
        Enter your hospital's WhatsApp number above with country code (e.g. 91 for India).
      </div>
    </div>
  );
}
