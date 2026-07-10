import { useState, useEffect } from 'react';
import { Search, User, Phone, MessageSquare, Globe, Heart, Clock } from 'lucide-react';

interface Patient {
  id: string;
  name: string;
  phone: string;
  age: number;
  gender: string;
  preferred_language: string;
}

interface ChatMessage {
  id: number;
  role: 'patient' | 'bot' | 'system';
  message: string;
  agent_used: string;
  language: string;
  timestamp: string;
}

export default function Patients() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);

  const fetchPatients = async () => {
    try {
      const res = await fetch('/api/patients', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await res.json();
      setPatients(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchChatHistory = async (patientId: string) => {
    setLoadingChat(true);
    try {
      const res = await fetch(`/api/patients/${encodeURIComponent(patientId)}/history`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await res.json();
      setChatHistory(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingChat(false);
    }
  };

  useEffect(() => {
    fetchPatients();
  }, []);

  const handleSelectPatient = (patient: Patient) => {
    setSelectedPatient(patient);
    fetchChatHistory(patient.id);
  };

  const filteredPatients = patients.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.phone.includes(searchQuery)
  );

  return (
    <div className="p-6 max-w-7xl mx-auto h-[calc(100vh-120px)] flex flex-col space-y-4">
      <div>
        <h1 className="text-3xl font-extrabold font-hero text-text-main">Patients & Chats</h1>
        <p className="text-text-muted mt-1 font-body">Inspect registered patients and audit their WhatsApp AI conversations.</p>
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden min-h-0">
        {/* Left Side: Patients Directory */}
        <div className="w-1/3 glass-panel flex flex-col border border-card-border overflow-hidden">
          <div className="p-4 border-b border-card-border/50 relative">
            <Search className="absolute left-7 top-7 text-text-muted" size={18} />
            <input
              type="text"
              placeholder="Search patients..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50 font-body text-sm"
            />
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-card-border/30">
            {loading ? (
              <div className="text-center py-8 text-text-muted font-body">Loading...</div>
            ) : filteredPatients.length === 0 ? (
              <div className="text-center py-8 text-text-muted font-body">No patients found.</div>
            ) : (
              filteredPatients.map(p => (
                <div
                  key={p.id}
                  onClick={() => handleSelectPatient(p)}
                  className={`p-4 cursor-pointer hover:bg-card-bg/20 transition-all flex items-center justify-between font-body ${selectedPatient?.id === p.id ? 'bg-card-bg/30 border-l-4 border-accent-color' : ''}`}
                >
                  <div>
                    <div className="font-bold text-text-main text-sm">{p.name}</div>
                    <div className="text-text-muted text-xs flex items-center gap-1 mt-1">
                      <Phone size={10} />
                      <span>{p.phone}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="text-[10px] px-2 py-0.5 bg-violet-500/10 text-violet-400 font-semibold rounded-full uppercase">
                      {p.preferred_language}
                    </span>
                    <span className="text-[10px] text-text-muted">{p.gender}, Age {p.age}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Side: Chat Panel */}
        <div className="flex-1 glass-panel flex flex-col border border-card-border overflow-hidden">
          {selectedPatient ? (
            <>
              {/* Chat Header */}
              <div className="p-4 border-b border-card-border/50 flex items-center justify-between bg-card-bg/10">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-accent-color/10 rounded-2xl text-accent-color">
                    <User size={20} />
                  </div>
                  <div>
                    <div className="font-bold font-hero text-text-main">{selectedPatient.name}</div>
                    <div className="text-text-muted text-xs font-body">Phone: {selectedPatient.phone} | Age: {selectedPatient.age} | Gender: {selectedPatient.gender}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-violet-400 bg-violet-500/10 px-3 py-1 rounded-xl">
                    <Globe size={12} />
                    <span>Script: {selectedPatient.preferred_language}</span>
                  </span>
                </div>
              </div>

              {/* Chat Window */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-black/10">
                {loadingChat ? (
                  <div className="text-center py-12 text-text-muted font-body">Loading history...</div>
                ) : chatHistory.length === 0 ? (
                  <div className="text-center py-12 text-text-muted font-body">No conversation history.</div>
                ) : (
                  chatHistory.map((chat) => {
                    const isBot = chat.role !== 'patient';
                    return (
                      <div key={chat.id} className={`flex ${isBot ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-[70%] p-3.5 rounded-2xl shadow-md font-body text-sm relative ${isBot ? 'bg-card-bg/40 border border-card-border/50 text-text-main rounded-tl-none' : 'bg-gradient-to-r from-teal-500/80 to-violet-600/80 text-white rounded-tr-none'}`}>
                          
                          <p className="leading-relaxed whitespace-pre-line">{chat.message}</p>
                          
                          <div className={`flex items-center justify-between gap-4 mt-2 text-[9px] ${isBot ? 'text-text-muted' : 'text-white/60'}`}>
                            <span className="capitalize flex items-center gap-0.5">
                              {isBot ? `Agent: ${chat.agent_used}` : 'User'}
                            </span>
                            <span className="flex items-center gap-0.5">
                              <Clock size={8} />
                              {new Date(chat.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-text-muted p-8">
              <MessageSquare size={48} className="text-card-border mb-3" />
              <p className="font-body text-center">Select a patient from the list to view their detailed WhatsApp chat audits.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
