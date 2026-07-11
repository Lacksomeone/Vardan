import { useState, useEffect } from 'react';
import { Clock, Plus, RefreshCw, CheckCircle, AlertTriangle, Send, User, Search, Upload, Image as ImageIcon, Check } from 'lucide-react';

interface FollowUpJob {
  id: number;
  patient_id: string;
  patient_name: string;
  patient_phone: string;
  doctor_name: string;
  trigger_date: string;
  status: 'pending' | 'sent' | 'responded' | 'escalated';
  created_at: string;
}

interface Patient { id: string; name: string; phone: string; preferred_language: string; }
interface Doctor { id: number; name: string; department: string; }

const statusStyle: Record<string, string> = {
  pending:   'bg-yellow-500/15 border-yellow-500/30 text-yellow-400',
  sent:      'bg-blue-500/15   border-blue-500/30   text-blue-400',
  responded: 'bg-green-500/15  border-green-500/30  text-green-400',
  escalated: 'bg-red-500/15    border-red-500/30    text-red-400',
};

const statusIcon: Record<string, any> = {
  pending:   <Clock size={12} />,
  sent:      <Send size={12} />,
  responded: <CheckCircle size={12} />,
  escalated: <AlertTriangle size={12} />,
};

const templatesList = (customText: string) => [
  {
    name: 'Custom Message',
    text: '',
  },
  {
    name: '⭐ My Custom Saved Template',
    text: customText,
  },
  {
    name: 'Holi Greetings (Hindi)',
    text: `🏥 *वरदान हॉस्पिटल, बहराइच*\n\nआपको और आपके पूरे परिवार को होली की हार्दिक शुभकामनाएं! 🎨✨\nआपका स्वास्थ्य ही हमारी सबसे बड़ी प्राथमिकता है।\n\n— डॉ. नितिन सिंह एवं समस्त वरदान हॉस्पिटल टीम`,
  },
  {
    name: 'Diwali Greetings (Hindi)',
    text: `🏥 *वरदान हॉस्पिटल, बहराइच*\n\nआपको और आपके परिवार को दीपावली की हार्दिक शुभकामनाएं! 🪔✨\nयह त्योहार आपके जीवन में सुख, समृद्धि और उत्तम स्वास्थ्य लाए।\n\n— डॉ. नितिन सिंह एवं समस्त वरदान हॉस्पिटल टीम`,
  },
  {
    name: 'Special Cardiology Offer (Hinglish)',
    text: `🏥 *Vardan Hospital - Special Health Offer*\n\nNamaste! 🙏\nIs month humare yahan cardiac health checkup par special discount diya ja raha hai. Senior Cardiologist *Dr. Nitin Singh* se consultation fee me 20% ki chhoot payein.\n📅 Aaj hi apna appointment book karein!\n👉 WhatsApp par *"book"* reply karein.`,
  },
  {
    name: 'General Wellness Check (English)',
    text: `🏥 *Vardan Hospital, Bahraich*\n\nHello! 🙏 We wish you excellent health. Please feel free to reach out to us here for any consultations, appointments, or medical queries.`,
  }
];

export default function FollowUps() {
  const [activeTab, setActiveTab] = useState<'reminders' | 'bulk'>('reminders');
  
  // State for reminders queue
  const [jobs, setJobs] = useState<FollowUpJob[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ patientId: '', doctorId: '', days: '9', triggerDate: '' });
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // State for bulk outreach
  const [selectedPatients, setSelectedPatients] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [bulkMessage, setBulkMessage] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [sendingBulk, setSendingBulk] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);

  const [customTemplateText, setCustomTemplateText] = useState(localStorage.getItem('custom_outreach_template') || '');
  const [sheetImporting, setSheetImporting] = useState(false);

  const templates = templatesList(customTemplateText);

  const token = () => localStorage.getItem('token');
  const headers = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [jRes, pRes, dRes] = await Promise.all([
        fetch('/api/followups', { headers: headers() }),
        fetch('/api/patients', { headers: headers() }),
        fetch('/api/doctors',  { headers: headers() }),
      ]);
      setJobs(await jRes.json());
      setPatients(await pRes.json());
      setDoctors(await dRes.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // Auto-calculate trigger date when days change
  useEffect(() => {
    if (form.days) {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(form.days) - 1);
      setForm(f => ({ ...f, triggerDate: d.toISOString().split('T')[0] + 'T10:00' }));
    }
  }, [form.days]);

  const handleCreate = async () => {
    if (!form.patientId || !form.doctorId || !form.triggerDate) return;
    setSaving(true);
    try {
      await fetch('/api/followups', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ patientId: form.patientId, doctorId: form.doctorId, triggerDate: form.triggerDate })
      });
      setShowForm(false);
      setForm({ patientId: '', doctorId: '', days: '9', triggerDate: '' });
      fetchAll();
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  // Image Upload handler
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setBulkStatus(null);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result as string;
        try {
          const res = await fetch('/api/upload', {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({
              filename: file.name,
              category: 'bulk_photo',
              base64Data
            })
          });
          const data = await res.json();
          if (res.ok && data.url) {
            setPhotoUrl(data.url);
            setBulkStatus('✅ Image uploaded successfully!');
          } else {
            setBulkStatus(`❌ Upload failed: ${data.error || 'Unknown error'}`);
          }
        } catch (uploadErr: any) {
          setBulkStatus(`❌ Connection error: ${uploadErr.message}`);
        }
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      setUploading(false);
    }
  };

  // Send Bulk message handler
  const handleSendBulk = async () => {
    if (selectedPatients.length === 0 || !bulkMessage.trim()) return;
    setSendingBulk(true);
    setBulkStatus('⚡ Initializing bulk outreach...');

    try {
      const res = await fetch('/api/followups/bulk', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          patientIds: selectedPatients,
          message: bulkMessage,
          imageUrl: photoUrl || undefined
        })
      });

      const data = await res.json();
      if (res.ok) {
        setBulkStatus(`✅ Sent successfully! (${selectedPatients.length} messages)`);
        setBulkMessage('');
        setPhotoUrl('');
        setSelectedPatients([]);
      } else {
        setBulkStatus(`❌ Sending failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      setBulkStatus(`❌ Error: ${err.message}`);
    }
    setSendingBulk(false);
  };

  // Import from Google Sheets
  const handleImportGoogleSheets = async () => {
    setSheetImporting(true);
    setBulkStatus(null);
    try {
      const res = await fetch('/api/patients/import-sheets', { headers: headers() });
      if (!res.ok) {
        throw new Error(await res.text() || 'Failed to fetch patients from Google Sheets');
      }
      const data = await res.json() as Patient[];
      
      setPatients(prev => {
        const merged = [...prev];
        let importedCount = 0;
        for (const item of data) {
          if (!merged.some(p => p.phone === item.phone)) {
            merged.push(item);
            importedCount++;
          }
        }
        setBulkStatus(`✅ Successfully imported ${importedCount} new patients from Google Sheets!`);
        return merged;
      });
    } catch (err: any) {
      setBulkStatus(`❌ Sheets Import Error: ${err.message}`);
    } finally {
      setSheetImporting(false);
    }
  };

  // Import from vCard (.vcf) File
  const handleVCFUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setBulkStatus('⚡ Parsing vCard (.vcf) file...');
    const reader = new FileReader();
    reader.onload = (event) => {
      const textVal = event.target?.result as string;
      try {
        const parsedContacts: Patient[] = [];
        const cards = textVal.split('BEGIN:VCARD');
        for (const card of cards) {
          if (!card.trim()) continue;
          let name = '';
          let phone = '';
          const lines = card.split(/\r?\n/);
          for (const line of lines) {
            if (line.toUpperCase().startsWith('FN:')) {
              name = line.substring(3).trim();
            } else if (line.toUpperCase().startsWith('TEL;')) {
              const parts = line.split(':');
              if (parts.length > 1) {
                phone = parts[1].replace(/\D/g, ''); // keep only numbers
              }
            } else if (line.toUpperCase().startsWith('TEL:')) {
              phone = line.substring(4).replace(/\D/g, '');
            }
          }
          if (name && phone) {
            parsedContacts.push({
              id: `vcf_${phone}`,
              name,
              phone,
              preferred_language: 'hinglish'
            });
          }
        }

        if (parsedContacts.length > 0) {
          setPatients(prev => {
            const merged = [...prev];
            let importedCount = 0;
            for (const item of parsedContacts) {
              if (!merged.some(p => p.phone === item.phone)) {
                merged.push(item);
                importedCount++;
              }
            }
            setBulkStatus(`✅ Successfully loaded ${importedCount} new contacts from .vcf!`);
            return merged;
          });
        } else {
          setBulkStatus('❌ No valid contacts found in .vcf file.');
        }
      } catch (err: any) {
        setBulkStatus(`❌ vCard Parse Error: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const filteredJobs = filterStatus === 'all' ? jobs : jobs.filter(j => j.status === filterStatus);

  const counts = {
    all:       jobs.length,
    pending:   jobs.filter(j => j.status === 'pending').length,
    sent:      jobs.filter(j => j.status === 'sent').length,
    responded: jobs.filter(j => j.status === 'responded').length,
    escalated: jobs.filter(j => j.status === 'escalated').length,
  };

  // Bulk patient selection filters
  const filteredPatients = patients.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.phone.includes(searchTerm)
  );

  const toggleSelectPatient = (id: string) => {
    setSelectedPatients(prev =>
      prev.includes(id) ? prev.filter(pId => pId !== id) : [...prev, id]
    );
  };

  const toggleSelectAllPatients = () => {
    if (selectedPatients.length === filteredPatients.length) {
      setSelectedPatients([]);
    } else {
      setSelectedPatients(filteredPatients.map(p => p.id));
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 overflow-y-auto max-h-[calc(100vh-120px)]">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold font-hero text-white">Patient Follow-Ups & Outreach</h1>
          <p className="text-sm mt-1" style={{ color: 'hsl(240 8% 62%)' }}>
            Schedule automatic medicine course reminders, or broadcast custom greetings and offers to patients in bulk.
          </p>
        </div>
        
        {/* Tab Selector */}
        <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 shrink-0">
          <button onClick={() => setActiveTab('reminders')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'reminders'
                ? 'bg-gradient-to-r from-teal-500 to-violet-600 text-white shadow-md'
                : 'text-white/50 hover:text-white'
            }`}>
            📅 Reminders Queue
          </button>
          <button onClick={() => setActiveTab('bulk')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'bulk'
                ? 'bg-gradient-to-r from-teal-500 to-violet-600 text-white shadow-md'
                : 'text-white/50 hover:text-white'
            }`}>
            📢 Bulk Broadcast (Greetings / Offers)
          </button>
        </div>
      </div>

      {activeTab === 'reminders' ? (
        <>
          {/* Reminders Queue Actions */}
          <div className="flex gap-2 justify-end">
            <button onClick={fetchAll}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white border border-white/10 hover:bg-white/10 transition-all">
              <RefreshCw size={15} />
              Refresh
            </button>
            <button onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-teal-500 to-violet-600 hover:from-teal-600 hover:to-violet-700 transition-all shadow-lg">
              <Plus size={15} />
              Schedule Reminder
            </button>
          </div>

          {/* Create Form */}
          {showForm && (
            <div className="rounded-2xl border border-white/10 p-6 space-y-4"
              style={{ background: 'rgba(30,27,60,0.7)', backdropFilter: 'blur(20px)' }}>
              <h2 className="text-lg font-bold font-hero text-white">📅 Schedule Follow-Up Reminder</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Patient */}
                <div>
                  <label className="block text-xs font-semibold text-white/60 mb-1.5">Patient</label>
                  <select value={form.patientId} onChange={e => setForm(f => ({...f, patientId: e.target.value}))}
                    className="w-full px-3 py-2.5 rounded-xl text-sm text-white border border-white/15 outline-none font-sans"
                    style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <option value="" className="bg-[#1a1a2e] text-white/50">Select patient...</option>
                    {patients.map(p => <option key={p.id} value={p.id} className="bg-[#1a1a2e] text-white">{p.name} (+{p.phone})</option>)}
                  </select>
                </div>

                {/* Doctor */}
                <div>
                  <label className="block text-xs font-semibold text-white/60 mb-1.5">Doctor</label>
                  <select value={form.doctorId} onChange={e => setForm(f => ({...f, doctorId: e.target.value}))}
                    className="w-full px-3 py-2.5 rounded-xl text-sm text-white border border-white/15 outline-none font-sans"
                    style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <option value="" className="bg-[#1a1a2e] text-white/50">Select doctor...</option>
                    {doctors.map(d => <option key={d.id} value={d.id} className="bg-[#1a1a2e] text-white">Dr. {d.name} ({d.department})</option>)}
                  </select>
                </div>

                {/* Days */}
                <div>
                  <label className="block text-xs font-semibold text-white/60 mb-1.5">
                    Medicine Course (days) — reminder sent 1 day before
                  </label>
                  <input type="number" min="1" max="90" value={form.days}
                    onChange={e => setForm(f => ({...f, days: e.target.value}))}
                    className="w-full px-3 py-2.5 rounded-xl text-sm text-white border border-white/15 outline-none"
                    style={{ background: 'rgba(255,255,255,0.06)' }}
                    placeholder="e.g. 10" />
                </div>

                {/* Trigger Date */}
                <div>
                  <label className="block text-xs font-semibold text-white/60 mb-1.5">Reminder Date & Time (auto-set)</label>
                  <input type="datetime-local" value={form.triggerDate}
                    onChange={e => setForm(f => ({...f, triggerDate: e.target.value}))}
                    className="w-full px-3 py-2.5 rounded-xl text-sm text-white border border-white/15 outline-none"
                    style={{ background: 'rgba(255,255,255,0.06)' }} />
                </div>
              </div>

              {/* Info box */}
              <div className="text-xs rounded-xl p-3 border border-teal-500/20 bg-teal-500/5 text-teal-300 leading-relaxed">
                📱 Patient ko is date pe WhatsApp message aayega: <strong>"Kal aapki dawa khatam ho rahi hai, Dr. [Name] se milein ya appointment book karein."</strong><br/>
                Agar patient 24 ghante mein reply na kare → Doctor ko automatic alert jaayega.
              </div>

              <div className="flex gap-3">
                <button onClick={handleCreate} disabled={saving || !form.patientId || !form.doctorId}
                  className="px-6 py-2.5 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-teal-500 to-violet-600 hover:from-teal-600 hover:to-violet-700 disabled:opacity-40 transition-all">
                  {saving ? 'Scheduling...' : '✅ Schedule Reminder'}
                </button>
                <button onClick={() => setShowForm(false)}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white/60 border border-white/10 hover:bg-white/10 transition-all">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Filter tabs */}
          <div className="flex gap-2 flex-wrap">
            {(['all','pending','sent','responded','escalated'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all border ${
                  filterStatus === s
                    ? 'bg-white/15 border-white/20 text-white'
                    : 'border-white/10 text-white/40 hover:text-white/70'
                }`}>
                {s.charAt(0).toUpperCase() + s.slice(1)} ({counts[s]})
              </button>
            ))}
          </div>

          {/* Jobs Table */}
          {loading ? (
            <div className="text-center py-12" style={{ color: 'hsl(240 8% 55%)' }}>Loading reminders...</div>
          ) : filteredJobs.length === 0 ? (
            <div className="text-center py-16 space-y-3 rounded-2xl border border-white/5"
              style={{ background: 'rgba(255,255,255,0.02)' }}>
              <Clock size={40} className="mx-auto text-white/20" />
              <p className="text-white/40 text-sm">No follow-up reminders found.</p>
              <p className="text-white/25 text-xs">
                Reminders are auto-created when WhatsApp appointments are booked,<br/>
                or you can create one manually above.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredJobs.map(job => (
                <div key={job.id} className="rounded-2xl border border-white/10 p-4 flex items-center gap-4 animate-in fade-in duration-200"
                  style={{ background: 'rgba(30,27,60,0.5)' }}>
                  
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-2xl bg-violet-500/20 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
                    <User size={20} className="text-violet-400" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white text-sm">{job.patient_name}</span>
                      <span className="text-white/30 text-xs">{job.patient_phone}</span>
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: 'hsl(240 8% 60%)' }}>
                      Dr. {job.doctor_name} &nbsp;·&nbsp; Reminder on: <strong className="text-white/70">{job.trigger_date}</strong>
                    </p>
                  </div>

                  {/* Status badge */}
                  <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border capitalize ${statusStyle[job.status]}`}>
                    {statusIcon[job.status]}
                    {job.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        /* Bulk Broadcast Tab */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Patient Selector Panel (LHS) */}
          <div className="lg:col-span-5 rounded-2xl border border-white/10 p-5 space-y-4"
            style={{ background: 'rgba(30,27,60,0.5)', backdropFilter: 'blur(20px)' }}>
            
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-white font-hero">👥 Select Patients</h2>
              <span className="text-xs font-bold text-teal-400 bg-teal-500/10 px-2.5 py-1 rounded-full">
                {selectedPatients.length} Selected
              </span>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-white/30" size={15} />
              <input type="text" placeholder="Search by name or phone..." value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl text-xs text-white border border-white/10 outline-none placeholder-white/30 bg-white/5 focus:border-white/20 transition-all" />
            </div>

            {/* Import Options */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleImportGoogleSheets}
                disabled={sheetImporting}
                className="flex items-center justify-center gap-1.5 py-2 border border-white/10 rounded-xl text-[10px] font-bold text-white hover:bg-white/5 disabled:opacity-40 transition-all"
              >
                <span>📊 {sheetImporting ? 'Importing...' : 'Google Sheets'}</span>
              </button>
              <label className="flex items-center justify-center gap-1.5 py-2 border border-white/10 rounded-xl text-[10px] font-bold text-white hover:bg-white/5 cursor-pointer transition-all">
                <span>📁 Import .VCF</span>
                <input type="file" accept=".vcf" className="hidden" onChange={handleVCFUpload} />
              </label>
            </div>

            {/* Select All Checkbox */}
            {filteredPatients.length > 0 && (
              <label className="flex items-center gap-3 px-3 py-2 rounded-xl border border-white/5 bg-white/5 cursor-pointer select-none">
                <input type="checkbox" checked={selectedPatients.length === filteredPatients.length && filteredPatients.length > 0}
                  onChange={toggleSelectAllPatients}
                  className="rounded border-white/20 text-teal-500 focus:ring-0 focus:ring-offset-0 bg-transparent w-4 h-4" />
                <span className="text-xs font-bold text-white/70">Select All Filtered ({filteredPatients.length})</span>
              </label>
            )}

            {/* Patient List */}
            <div className="space-y-2 overflow-y-auto max-h-[400px] pr-1">
              {filteredPatients.length === 0 ? (
                <div className="text-center py-10 text-xs text-white/30">No patients match your search.</div>
              ) : (
                filteredPatients.map(p => {
                  const isSelected = selectedPatients.includes(p.id);
                  return (
                    <div key={p.id} onClick={() => toggleSelectPatient(p.id)}
                      className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all select-none ${
                        isSelected 
                          ? 'border-teal-500/30 bg-teal-500/5' 
                          : 'border-white/5 hover:bg-white/5 bg-white/3'
                      }`}>
                      <div className="flex items-center gap-3">
                        <input type="checkbox" checked={isSelected} readOnly
                          className="rounded border-white/20 text-teal-500 focus:ring-0 focus:ring-offset-0 bg-transparent w-3.5 h-3.5" />
                        <div>
                          <div className="text-xs font-bold text-white">{p.name}</div>
                          <div className="text-[10px] text-white/40">+{p.phone} &nbsp;·&nbsp; {p.preferred_language}</div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Broadcast Form Panel (RHS) */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Form */}
            <div className="rounded-2xl border border-white/10 p-5 space-y-4"
              style={{ background: 'rgba(30,27,60,0.5)', backdropFilter: 'blur(20px)' }}>
              
              <h2 className="text-base font-extrabold text-white font-hero">📢 Broadcast Message</h2>

              {/* Template quick-select */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-white/60">Load Template</label>
                  {bulkMessage.trim() && (
                    <button
                      onClick={() => {
                        localStorage.setItem('custom_outreach_template', bulkMessage);
                        setCustomTemplateText(bulkMessage);
                        setBulkStatus('⭐ Message saved as custom template!');
                      }}
                      className="text-[10px] font-bold text-teal-400 hover:underline bg-transparent border-none cursor-pointer"
                    >
                      💾 Save Current Text as Custom Template
                    </button>
                  )}
                </div>
                <select onChange={e => setBulkMessage(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-xs text-white border border-white/10 outline-none font-sans"
                  style={{ background: 'rgba(255,255,255,0.06)' }}>
                  {templates.map((t, idx) => (
                    <option key={idx} value={t.text} className="bg-[#1a1a2e] text-white">
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Text Message box */}
              <div>
                <label className="block text-xs font-semibold text-white/60 mb-1.5">Message Content</label>
                <textarea rows={6} value={bulkMessage} onChange={e => setBulkMessage(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl text-xs text-white border border-white/10 outline-none bg-white/5 focus:border-white/20 transition-all font-sans leading-relaxed"
                  placeholder="Type your greeting, offer or announcement message here..." />
              </div>

              {/* Optional Photo Attachment */}
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-white/60">Attach Photo (Optional)</label>
                
                <div className="flex gap-2">
                  <input type="text" placeholder="Paste image URL (http://... or https://...)" value={photoUrl}
                    onChange={e => setPhotoUrl(e.target.value)}
                    className="flex-1 px-4 py-2 rounded-xl text-xs text-white border border-white/10 outline-none placeholder-white/30 bg-white/5 focus:border-white/20 transition-all" />
                  
                  {photoUrl && (
                    <button onClick={() => setPhotoUrl('')}
                      className="px-3 rounded-xl text-xs text-white/50 border border-white/10 hover:bg-white/10 transition-all">
                      Clear
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white border border-white/10 hover:bg-white/10 cursor-pointer transition-all shrink-0">
                    <Upload size={14} />
                    {uploading ? 'Uploading...' : 'Upload Image'}
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
                  </label>
                  <span className="text-[10px] text-white/30">JPG, PNG, WEBP files supported. File is auto-hosted.</span>
                </div>
              </div>

              {/* Status messages */}
              {bulkStatus && (
                <div className="text-xs rounded-xl p-3 border border-white/10 bg-white/5 text-white/90">
                  {bulkStatus}
                </div>
              )}

              {/* Action Button */}
              <button onClick={handleSendBulk} disabled={sendingBulk || selectedPatients.length === 0 || !bulkMessage.trim()}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-extrabold text-white bg-gradient-to-r from-teal-500 to-violet-600 hover:from-teal-600 hover:to-violet-700 disabled:opacity-30 disabled:pointer-events-none transition-all shadow-lg">
                <Send size={14} />
                {sendingBulk ? '🚀 Sending outreach broadcast...' : `Send Broadcast to ${selectedPatients.length} Patients`}
              </button>
            </div>

            {/* Live WhatsApp Preview */}
            <div className="rounded-2xl border border-white/5 p-4 space-y-3"
              style={{ background: 'rgba(255,255,255,0.02)' }}>
              <div className="text-xs font-extrabold text-white/40 flex items-center gap-1.5">
                <ImageIcon size={12} />
                WhatsApp Message Preview (Approximation)
              </div>
              <div className="p-4 rounded-2xl max-w-sm border border-emerald-500/10 bg-emerald-950/10 text-white space-y-3 shadow-inner">
                {photoUrl && (
                  <img src={photoUrl} alt="Preview attachment" className="w-full h-36 object-cover rounded-xl border border-white/10" 
                    onError={e => { (e.target as HTMLElement).style.display = 'none'; }} />
                )}
                <div className="text-xs leading-relaxed whitespace-pre-line font-sans">
                  {bulkMessage || <span className="text-white/20 italic">No content typed yet...</span>}
                </div>
                <div className="text-[9px] text-white/40 text-right mt-1.5 flex items-center justify-end gap-1">
                  <span>10:00 AM</span>
                  <Check size={8} className="text-sky-400" />
                </div>
              </div>
            </div>

          </div>

        </div>
      )}
    </div>
  );
}
