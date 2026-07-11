import { useState, useEffect } from 'react';
import { Calendar, Clock, User, Phone, CheckCircle, XCircle, Filter, Plus } from 'lucide-react';


interface Appointment {
  id: number;
  patient_id: string;
  patient_name: string;
  patient_phone: string;
  doctor_id: number;
  doctor_name: string;
  department: string;
  date: string;
  time_slot: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'rescheduled' | 'completed';
}

interface Doctor {
  id: number;
  name: string;
  department: string;
  weekly_schedule_json: string;
}

export default function Appointments() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // Filters State
  const [filterDoc, setFilterDoc] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Form State
  const [patientPhone, setPatientPhone] = useState('');
  const [selectedDocId, setSelectedDocId] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [formError, setFormError] = useState('');

  const fetchAppointments = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterDoc) params.append('doctor_id', filterDoc);
      if (filterDate) params.append('date', filterDate);
      if (filterStatus) params.append('status', filterStatus);

      const res = await fetch(`/api/appointments?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await res.json();
      setAppointments(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDoctors = async () => {
    try {
      const res = await fetch('/api/doctors', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await res.json();
      setDoctors(data.filter((d: any) => d.active));
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchAppointments();
  }, [filterDoc, filterDate, filterStatus]);

  useEffect(() => {
    fetchDoctors();
  }, []);

  // Fetch slots whenever doctor or date changes in booking form
  useEffect(() => {
    if (!selectedDocId || !selectedDate) {
      setAvailableSlots([]);
      return;
    }

    const loadSlots = () => {
      const doctor = doctors.find(d => d.id === Number(selectedDocId));
      if (!doctor) return;

      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dateObj = new Date(selectedDate);
      const dayName = days[dateObj.getDay()];

      const schedule = JSON.parse(doctor.weekly_schedule_json);
      const dayWindows = schedule[dayName];

      if (!dayWindows || dayWindows.length === 0) {
        setAvailableSlots([]);
        return;
      }

      // Generate all slots
      let allSlots: string[] = [];
      const parseWindow = (window: string) => {
        const [start, end] = window.split('-');
        const [startH, startM] = start.split(':').map(Number);
        const [endH, endM] = end.split(':').map(Number);
        const slots: string[] = [];
        let curr = startH * 60 + startM;
        const limit = endH * 60 + endM;
        while (curr + 30 <= limit) {
          const h1 = Math.floor(curr / 60).toString().padStart(2, '0');
          const m1 = (curr % 60).toString().padStart(2, '0');
          const next = curr + 30;
          const h2 = Math.floor(next / 60).toString().padStart(2, '0');
          const m2 = (next % 60).toString().padStart(2, '0');
          slots.push(`${h1}:${m1}-${h2}:${m2}`);
          curr = next;
        }
        return slots;
      };

      for (const win of dayWindows) {
        allSlots = allSlots.concat(parseWindow(win));
      }

      // Filter out already booked slots
      const bookedSlots = appointments
        .filter(a => a.doctor_id === Number(selectedDocId) && a.date === selectedDate && a.status !== 'cancelled')
        .map(a => a.time_slot);

      setAvailableSlots(allSlots.filter(s => !bookedSlots.includes(s)));
    };

    loadSlots();
  }, [selectedDocId, selectedDate, appointments, doctors]);

  const handleCancel = async (id: number) => {
    if (!confirm('Are you sure you want to cancel this appointment?')) return;
    try {
      await fetch(`/api/appointments/${id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      fetchAppointments();
    } catch (err) {
      console.error(err);
    }
  };

  const handleComplete = async (id: number) => {
    const daysStr = prompt('Enter medicine course duration in days (e.g. 3, 5, 10):', '5');
    if (daysStr === null) return; // user cancelled
    const days = parseInt(daysStr);
    if (isNaN(days) || days < 1) {
      alert('Please enter a valid number of days.');
      return;
    }

    try {
      const res = await fetch(`/api/appointments/${id}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ medicine_days: days })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to complete appointment');
      fetchAppointments();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleManualBook = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!selectedSlot) {
      setFormError('Please select an available time slot.');
      return;
    }

    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          patient_phone: patientPhone,
          doctor_id: Number(selectedDocId),
          date: selectedDate,
          time_slot: selectedSlot
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to book appointment.');
      }

      setShowAddModal(false);
      setPatientPhone('');
      setSelectedDocId('');
      setSelectedDate('');
      setSelectedSlot('');
      fetchAppointments();
    } catch (err: any) {
      setFormError(err.message);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold font-hero text-text-main">Appointment Logs</h1>
          <p className="text-text-muted mt-1 font-body">Track, reschedule, cancel, or manually book patient appointments.</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-teal-500 to-violet-600 hover:from-teal-600 hover:to-violet-700 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95"
        >
          <Plus size={20} />
          <span>New Appointment</span>
        </button>
      </div>

      {/* Filters Panel */}
      <div className="glass-panel p-4 border border-card-border flex flex-wrap items-center gap-4 font-body text-sm">
        <div className="flex items-center gap-2 text-text-muted">
          <Filter size={16} />
          <span>Filters:</span>
        </div>

        <select
          value={filterDoc}
          onChange={(e) => setFilterDoc(e.target.value)}
          className="px-3 py-2 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none"
        >
          <option value="">All Doctors</option>
          {doctors.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>

        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="px-3 py-2 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none"
        />

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none"
        >
          <option value="">All Statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="rescheduled">Rescheduled</option>
          <option value="completed">Completed</option>
          <option value="pending">Pending</option>
          <option value="cancelled">Cancelled</option>
        </select>

        {(filterDoc || filterDate || filterStatus) && (
          <button
            onClick={() => {
              setFilterDoc('');
              setFilterDate('');
              setFilterStatus('');
            }}
            className="text-accent-color hover:underline ml-auto font-semibold"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* List View */}
      {loading ? (
        <div className="text-center py-12 text-text-muted font-body">Loading appointments...</div>
      ) : (
        <div className="glass-panel overflow-hidden border border-card-border shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left font-body text-sm border-collapse">
              <thead>
                <tr className="bg-card-bg border-b border-card-border text-text-muted font-semibold">
                  <th className="p-4">Patient Details</th>
                  <th className="p-4">Doctor / Specialty</th>
                  <th className="p-4">Date & Time</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border/50">
                {appointments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-text-muted">No appointments found.</td>
                  </tr>
                ) : (
                  appointments.map((appt) => (
                    <tr key={appt.id} className="hover:bg-card-bg/20 transition-all">
                      <td className="p-4">
                        <div className="font-bold text-text-main flex items-center gap-1.5">
                          <User size={14} className="text-accent-color" />
                          <span>{appt.patient_name}</span>
                        </div>
                        <div className="text-text-muted text-xs flex items-center gap-1 mt-0.5">
                          <Phone size={10} />
                          <span>{appt.patient_phone}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="font-semibold text-text-main">{appt.doctor_name}</div>
                        <div className="text-text-muted text-xs">{appt.department}</div>
                      </td>
                      <td className="p-4">
                        <div className="text-text-main flex items-center gap-1.5 font-medium">
                          <Calendar size={14} className="text-violet-400" />
                          <span>{appt.date}</span>
                        </div>
                        <div className="text-text-muted text-xs flex items-center gap-1 mt-0.5">
                          <Clock size={12} />
                          <span>{appt.time_slot}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        {appt.status === 'confirmed' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-500/10 text-green-400 text-xs font-semibold rounded-full">
                            <CheckCircle size={10} />
                            <span>Confirmed</span>
                          </span>
                        )}
                        {appt.status === 'rescheduled' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-500/10 text-blue-400 text-xs font-semibold rounded-full">
                            <Clock size={10} />
                            <span>Rescheduled</span>
                          </span>
                        )}
                        {appt.status === 'completed' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-teal-500/10 text-teal-400 text-xs font-semibold rounded-full">
                            <CheckCircle size={10} />
                            <span>Completed</span>
                          </span>
                        )}
                        {appt.status === 'cancelled' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-500/10 text-red-400 text-xs font-semibold rounded-full">
                            <XCircle size={10} />
                            <span>Cancelled</span>
                          </span>
                        )}
                        {appt.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-yellow-500/10 text-yellow-400 text-xs font-semibold rounded-full">
                            <Clock size={10} />
                            <span>Pending</span>
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        {appt.status === 'confirmed' || appt.status === 'rescheduled' || appt.status === 'pending' ? (
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleComplete(appt.id)}
                              className="px-3 py-1.5 bg-teal-500/20 hover:bg-teal-500/35 text-teal-300 text-xs font-bold rounded-lg transition-all"
                            >
                              Complete
                            </button>
                            <button
                              onClick={() => handleCancel(appt.id)}
                              className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold rounded-lg transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : appt.status === 'completed' ? (
                          <span className="text-teal-400 font-bold text-xs">✓ Completed</span>
                        ) : (
                          <span className="text-red-400 text-xs">Cancelled</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Manual Booking Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="glass-panel w-full max-w-md p-6 border border-card-border shadow-2xl relative">
            <h2 className="text-2xl font-bold font-hero text-text-main mb-6">Manually Book Slot</h2>

            {formError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm text-center">
                {formError}
              </div>
            )}

            <form onSubmit={handleManualBook} className="space-y-4 font-body">
              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Patient WhatsApp Phone</label>
                <input
                  type="text"
                  value={patientPhone}
                  onChange={(e) => setPatientPhone(e.target.value)}
                  className="w-full px-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50"
                  placeholder="919415577651 (no spaces/dashes)"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Select Doctor</label>
                <select
                  value={selectedDocId}
                  onChange={(e) => setSelectedDocId(e.target.value)}
                  className="w-full px-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50"
                  required
                >
                  <option value="">-- Select Doctor --</option>
                  {doctors.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.department})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Select Date</label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full px-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none"
                  required
                />
              </div>

              {selectedDocId && selectedDate && (
                <div>
                  <label className="block text-sm font-semibold text-text-muted mb-1.5">Select Available Slot</label>
                  {availableSlots.length === 0 ? (
                    <p className="text-red-400 text-xs font-semibold">No available slots for this date.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto p-1 border border-card-border/50 rounded-xl">
                      {availableSlots.map(slot => (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setSelectedSlot(slot)}
                          className={`py-1.5 rounded-lg text-xs font-bold border transition-all ${selectedSlot === slot ? 'bg-accent-color text-white border-accent-color' : 'bg-card-bg border-card-border text-text-main hover:bg-card-border/20'}`}
                        >
                          {slot.split('-')[0]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-6 border-t border-card-border/50">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-3 bg-card-bg border border-card-border hover:bg-card-border/20 text-text-main font-bold rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-gradient-to-r from-teal-500 to-violet-600 hover:from-teal-600 hover:to-violet-700 text-white font-bold rounded-xl transition-all shadow-lg"
                >
                  Book Appointment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
