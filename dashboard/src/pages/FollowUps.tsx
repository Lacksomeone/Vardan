import { useState, useEffect } from 'react';
import { Clock, Plus, RefreshCw, CheckCircle, AlertTriangle, Send, User } from 'lucide-react';

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

export default function FollowUps() {
  const [jobs, setJobs] = useState<FollowUpJob[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ patientId: '', doctorId: '', days: '9', triggerDate: '' });
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');

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
      setForm(f => ({ ...f, triggerDate: d.toISOString().split('T')[0] }));
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

  const filtered = filterStatus === 'all' ? jobs : jobs.filter(j => j.status === filterStatus);

  const counts = {
    all:       jobs.length,
    pending:   jobs.filter(j => j.status === 'pending').length,
    sent:      jobs.filter(j => j.status === 'sent').length,
    responded: jobs.filter(j => j.status === 'responded').length,
    escalated: jobs.filter(j => j.status === 'escalated').length,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 overflow-y-auto max-h-[calc(100vh-120px)]">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold font-hero text-white">Follow-Up Reminders</h1>
          <p className="text-sm mt-1" style={{ color: 'hsl(240 8% 62%)' }}>
            Patients get WhatsApp reminder 1 day before medicine runs out. Doctor is alerted if no reply in 24h.
          </p>
        </div>
        <div className="flex gap-2">
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
                className="w-full px-3 py-2.5 rounded-xl text-sm text-white border border-white/15 outline-none"
                style={{ background: 'rgba(255,255,255,0.06)' }}>
                <option value="">Select patient...</option>
                {patients.map(p => <option key={p.id} value={p.id} style={{ background: '#1a1a2e' }}>{p.name} (+{p.phone})</option>)}
              </select>
            </div>

            {/* Doctor */}
            <div>
              <label className="block text-xs font-semibold text-white/60 mb-1.5">Doctor</label>
              <select value={form.doctorId} onChange={e => setForm(f => ({...f, doctorId: e.target.value}))}
                className="w-full px-3 py-2.5 rounded-xl text-sm text-white border border-white/15 outline-none"
                style={{ background: 'rgba(255,255,255,0.06)' }}>
                <option value="">Select doctor...</option>
                {doctors.map(d => <option key={d.id} value={d.id} style={{ background: '#1a1a2e' }}>Dr. {d.name} ({d.department})</option>)}
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

            {/* Trigger Date (auto-calculated) */}
            <div>
              <label className="block text-xs font-semibold text-white/60 mb-1.5">Reminder Date (auto-set)</label>
              <input type="date" value={form.triggerDate}
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
      ) : filtered.length === 0 ? (
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
          {filtered.map(job => (
            <div key={job.id} className="rounded-2xl border border-white/10 p-4 flex items-center gap-4"
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
    </div>
  );
}
