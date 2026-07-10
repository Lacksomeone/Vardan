import { useState, useEffect, useRef } from 'react';
import { Search, User, Phone, MessageSquare, Globe, Clock, Calendar, ExternalLink, FileSpreadsheet, RotateCcw } from 'lucide-react';

interface Patient {
  id: string;
  name: string;
  phone: string;
  age: number;
  gender: string;
  preferred_language: string;
  created_at: string;
}

interface ChatMessage {
  id: number;
  role: 'patient' | 'bot' | 'system';
  message: string;
  agent_used: string;
  language: string;
  timestamp: string;
}

interface Appointment {
  id: number;
  doctor_name: string;
  department: string;
  date: string;
  time_slot: string;
  status: string;
}

const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

export default function Patients() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'appointments'>('chat');
  const [sheetUrl, setSheetUrl] = useState<string>('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [resetting, setResetting] = useState(false);

  const handleResetSession = async () => {
    if (!selected) return;
    if (!window.confirm(`Are you sure you want to reset the chat session for ${selected.name}? This will clear any active registration or booking flow.`)) return;

    setResetting(true);
    try {
      const res = await fetch(`/api/patients/${encodeURIComponent(selected.id)}/reset-session`, {
        method: 'POST',
        headers: authHeader()
      });
      if (res.ok) {
        alert('Session reset successfully. A notification has been sent to the patient.');
        // Refresh chat history
        selectPatient(selected);
      } else {
        const data = await res.json();
        alert(`Failed to reset session: ${data.error || 'Unknown error'}`);
      }
    } catch (e) {
      console.error(e);
      alert('Error resetting session.');
    }
    setResetting(false);
  };

  useEffect(() => {
    fetch('/api/patients', { headers: authHeader() })
      .then(r => r.json()).then(setPatients).catch(console.error)
      .finally(() => setLoading(false));
    
    fetch('/api/sheets/url', { headers: authHeader() })
      .then(r => r.json()).then(d => setSheetUrl(d.url)).catch(() => {});
  }, []);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const selectPatient = async (p: Patient) => {
    setSelected(p);
    setChatHistory([]);
    setAppointments([]);
    setLoadingChat(true);
    try {
      const res = await fetch(`/api/patients/${encodeURIComponent(p.id)}/history`, { headers: authHeader() });
      const data = await res.json();
      // API now returns { history, appointments }
      if (data.history) {
        setChatHistory(data.history);
        setAppointments(data.appointments || []);
      } else {
        // fallback: old API returned array directly
        setChatHistory(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error(e); }
    setLoadingChat(false);
  };

  const filtered = patients.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.phone.includes(searchQuery)
  );

  const statusColor: Record<string, string> = {
    confirmed:   'text-green-400 bg-green-500/10',
    pending:     'text-yellow-400 bg-yellow-500/10',
    cancelled:   'text-red-400 bg-red-500/10',
    rescheduled: 'text-blue-400 bg-blue-500/10',
  };

  return (
    <div className="p-6 max-w-7xl mx-auto h-[calc(100vh-120px)] flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-3xl font-extrabold font-hero text-white">Patients & Chats</h1>
          <p className="text-sm mt-1" style={{ color: 'hsl(240 8% 62%)' }}>Patient list, WhatsApp conversations & appointments</p>
        </div>
        {sheetUrl && (
          <a href={sheetUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-green-600 to-emerald-500 hover:from-green-700 hover:to-emerald-600 transition-all shadow-lg">
            <FileSpreadsheet size={16} />
            Open Google Sheet
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">

        {/* ── Left: Patient List ── */}
        <div className="w-72 flex-shrink-0 rounded-2xl border border-white/10 flex flex-col overflow-hidden"
          style={{ background: 'rgba(30,27,60,0.6)', backdropFilter: 'blur(20px)' }}>
          
          <div className="p-3 border-b border-white/10">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-white/30" size={15} />
              <input type="text" placeholder="Search name or phone..."
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl text-xs text-white border border-white/10 outline-none font-body"
                style={{ background: 'rgba(255,255,255,0.06)' }} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-white/5">
            {loading ? (
              <div className="text-center py-8 text-white/40 text-sm">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8 text-white/40 text-sm">No patients found.</div>
            ) : filtered.map(p => (
              <div key={p.id} onClick={() => selectPatient(p)}
                className={`p-3 cursor-pointer transition-all hover:bg-white/5 ${selected?.id === p.id ? 'bg-teal-500/10 border-l-2 border-teal-400' : ''}`}>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                    <User size={14} className="text-violet-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-white text-xs truncate">{p.name}</div>
                    <div className="text-white/40 text-[10px] flex items-center gap-1">
                      <Phone size={8} />{p.phone}
                    </div>
                  </div>
                  <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 font-bold flex-shrink-0">
                    {p.preferred_language}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 border-t border-white/5 text-center text-[10px]" style={{ color: 'hsl(240 8% 40%)' }}>
            {filtered.length} patient{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* ── Right: Detail Panel ── */}
        <div className="flex-1 rounded-2xl border border-white/10 flex flex-col overflow-hidden"
          style={{ background: 'rgba(30,27,60,0.6)', backdropFilter: 'blur(20px)' }}>

          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <MessageSquare size={48} className="text-white/10" />
              <p className="text-white/30 text-sm text-center">Select a patient to view chats & appointments</p>
            </div>
          ) : (
            <>
              {/* Patient Header */}
              <div className="px-5 py-4 border-b border-white/10 flex items-center gap-4 flex-shrink-0">
                <div className="w-10 h-10 rounded-2xl bg-teal-500/20 flex items-center justify-center">
                  <User size={20} className="text-teal-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-white">{selected.name}</div>
                  <div className="text-xs flex items-center gap-3 mt-0.5" style={{ color: 'hsl(240 8% 55%)' }}>
                    <span className="flex items-center gap-1"><Phone size={9} />{selected.phone}</span>
                    <span>Age {selected.age}</span>
                    <span>{selected.gender}</span>
                    <span className="flex items-center gap-1"><Globe size={9} />{selected.preferred_language}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={handleResetSession} disabled={resetting}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-red-400 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 transition-all flex items-center gap-1">
                    <RotateCcw size={12} className={resetting ? 'animate-spin' : ''} />
                    {resetting ? 'Resetting...' : 'Reset Chat Session'}
                  </button>
                  <div className="text-[10px] text-white/30">
                    Registered: {new Date(selected.created_at).toLocaleDateString('en-IN')}
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-white/10 flex-shrink-0">
                {(['chat', 'appointments'] as const).map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-3 text-xs font-bold transition-all ${
                      activeTab === tab
                        ? 'text-teal-400 border-b-2 border-teal-400'
                        : 'text-white/40 hover:text-white/70'
                    }`}>
                    {tab === 'chat' ? `💬 Chat History (${chatHistory.length})` : `📅 Appointments (${appointments.length})`}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              {loadingChat ? (
                <div className="flex-1 flex items-center justify-center text-white/40 text-sm">Loading...</div>
              ) : activeTab === 'chat' ? (
                /* Chat Messages */
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {chatHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2">
                      <MessageSquare size={36} className="text-white/10" />
                      <p className="text-white/30 text-sm">No conversations yet.</p>
                      <p className="text-white/20 text-xs">Messages will appear once WhatsApp bot is connected.</p>
                    </div>
                  ) : chatHistory.map(msg => {
                    const isBot = msg.role !== 'patient';
                    return (
                      <div key={msg.id} className={`flex ${isBot ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-line ${
                          isBot
                            ? 'bg-white/8 border border-white/10 text-white rounded-tl-none'
                            : 'bg-gradient-to-r from-teal-500/80 to-violet-600/80 text-white rounded-tr-none'
                        }`} style={isBot ? { background: 'rgba(255,255,255,0.06)' } : {}}>
                          <p>{msg.message}</p>
                          <div className={`flex items-center gap-3 mt-1.5 text-[9px] ${isBot ? 'text-white/30' : 'text-white/50'}`}>
                            <span>{isBot ? msg.agent_used : 'Patient'}</span>
                            <span className="flex items-center gap-0.5">
                              <Clock size={7} />
                              {new Date(msg.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </div>
              ) : (
                /* Appointments */
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {appointments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2">
                      <Calendar size={36} className="text-white/10" />
                      <p className="text-white/30 text-sm">No appointments booked yet.</p>
                    </div>
                  ) : appointments.map(appt => (
                    <div key={appt.id} className="flex items-center gap-4 px-4 py-3 rounded-xl border border-white/10"
                      style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center flex-shrink-0">
                        <Calendar size={18} className="text-teal-400" />
                      </div>
                      <div className="flex-1">
                        <div className="font-bold text-white text-sm">Dr. {appt.doctor_name}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'hsl(240 8% 60%)' }}>
                          {appt.department} &nbsp;·&nbsp; {appt.date} &nbsp;·&nbsp; {appt.time_slot}
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full capitalize ${statusColor[appt.status] || 'text-white/50 bg-white/5'}`}>
                        {appt.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
