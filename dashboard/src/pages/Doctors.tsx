import { useState, useEffect } from 'react';
import { UserPlus, Edit2, Trash2, Calendar, Phone, Stethoscope, IndianRupee } from 'lucide-react';

interface Doctor {
  id: number;
  name: string;
  department: string;
  phone: string;
  weekly_schedule_json: string;
  fee: number;
  active: number;
}

interface DoctorsProps {
  userRole: string;
}

export default function Doctors({ userRole }: DoctorsProps) {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingDoc, setEditingDoc] = useState<Doctor | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('General Medicine');
  const [phone, setPhone] = useState('');
  const [fee, setFee] = useState(300);
  const [schedule, setSchedule] = useState<Record<string, string[]>>({
    Monday: ['09:00-13:00', '15:00-18:00'],
    Tuesday: ['09:00-13:00', '15:00-18:00'],
    Wednesday: ['09:00-13:00', '15:00-18:00'],
    Thursday: ['09:00-13:00', '15:00-18:00'],
    Friday: ['09:00-13:00', '15:00-18:00'],
    Saturday: ['09:00-13:00', '15:00-18:00']
  });

  const fetchDoctors = async () => {
    try {
      const res = await fetch('/api/doctors', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await res.json();
      setDoctors(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDoctors();
  }, []);

  const openAddModal = () => {
    setEditingDoc(null);
    setName('');
    setDepartment('General Medicine');
    setPhone('');
    setFee(300);
    setSchedule({
      Monday: ['09:00-13:00', '15:00-18:00'],
      Tuesday: ['09:00-13:00', '15:00-18:00'],
      Wednesday: ['09:00-13:00', '15:00-18:00'],
      Thursday: ['09:00-13:00', '15:00-18:00'],
      Friday: ['09:00-13:00', '15:00-18:00'],
      Saturday: ['09:00-13:00', '15:00-18:00']
    });
    setShowModal(true);
  };

  const openEditModal = (doc: Doctor) => {
    setEditingDoc(doc);
    setName(doc.name);
    setDepartment(doc.department);
    setPhone(doc.phone);
    setFee(doc.fee);
    setSchedule(JSON.parse(doc.weekly_schedule_json));
    setShowModal(true);
  };

  const handleDeactivate = async (id: number) => {
    if (!confirm('Are you sure you want to deactivate this doctor?')) return;
    try {
      await fetch(`/api/doctors/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      fetchDoctors();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingDoc ? `/api/doctors/${editingDoc.id}` : '/api/doctors';
    const method = editingDoc ? 'PUT' : 'POST';

    const body = {
      name,
      department,
      phone,
      fee,
      weekly_schedule_json: JSON.stringify(schedule),
      active: editingDoc ? editingDoc.active : 1
    };

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        setShowModal(false);
        fetchDoctors();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const toggleDay = (day: string) => {
    setSchedule(prev => {
      const updated = { ...prev };
      if (updated[day]) {
        delete updated[day];
      } else {
        updated[day] = ['09:00-13:00', '15:00-18:00'];
      }
      return updated;
    });
  };

  const updateDaySchedule = (day: string, index: number, value: string) => {
    setSchedule(prev => {
      const updated = { ...prev };
      if (updated[day]) {
        updated[day][index] = value;
      }
      return updated;
    });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold font-hero text-text-main">Doctor Management</h1>
          <p className="text-text-muted mt-1 font-body">Manage doctors, availability, fees, and departments.</p>
        </div>
        {userRole === 'owner' && (
          <button
            onClick={openAddModal}
            className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-teal-500 to-violet-600 hover:from-teal-600 hover:to-violet-700 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95"
          >
            <UserPlus size={20} />
            <span>Add Doctor</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-muted">Loading doctors...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {doctors.map((doc) => (
            <div key={doc.id} className={`glass-panel p-6 flex flex-col relative overflow-hidden transition-all duration-300 hover:scale-[1.02] border ${doc.active ? 'border-card-border' : 'border-red-500/20 opacity-70'}`}>
              <div className="absolute -right-8 -top-8 w-24 h-24 rounded-full bg-accent-color/10 blur-xl"></div>
              
              <div className="flex items-start gap-4 mb-4">
                <div className="p-3 bg-accent-color/10 rounded-2xl text-accent-color">
                  <Stethoscope size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold font-hero text-text-main">{doc.name}</h2>
                  <span className="inline-block px-2.5 py-1 bg-violet-500/10 text-violet-400 font-body text-xs rounded-full mt-1">
                    {doc.department}
                  </span>
                  {!doc.active && (
                    <span className="inline-block px-2.5 py-1 bg-red-500/10 text-red-400 font-body text-xs rounded-full ml-2">
                      Inactive
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-3 font-body text-sm text-text-muted mt-auto mb-6">
                <div className="flex items-center gap-2">
                  <Phone size={16} />
                  <span>{doc.phone}</span>
                </div>
                <div className="flex items-center gap-2">
                  <IndianRupee size={16} />
                  <span>Consultation Fee: <span className="text-text-main font-bold">₹{doc.fee}</span></span>
                </div>
                <div className="border-t border-card-border/50 pt-3">
                  <div className="flex items-center gap-2 font-semibold text-text-main mb-1.5">
                    <Calendar size={16} />
                    <span>Weekly Schedule</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    {Object.entries(JSON.parse(doc.weekly_schedule_json)).map(([day, slots]: any) => (
                      <div key={day} className="flex justify-between border-b border-card-border/20 py-0.5">
                        <span className="font-medium text-text-main">{day.slice(0,3)}:</span>
                        <span>{slots.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {userRole === 'owner' && (
                <div className="flex gap-2 pt-4 border-t border-card-border/50">
                  <button
                    onClick={() => openEditModal(doc)}
                    className="flex-1 py-2.5 bg-card-bg border border-card-border hover:bg-card-border/20 text-text-main rounded-xl flex items-center justify-center gap-1.5 text-sm font-semibold transition-all"
                  >
                    <Edit2 size={14} />
                    <span>Edit</span>
                  </button>
                  {doc.active ? (
                    <button
                      onClick={() => handleDeactivate(doc.id)}
                      className="py-2.5 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="glass-panel w-full max-w-lg p-6 border border-card-border shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold font-hero text-text-main mb-6">
              {editingDoc ? 'Edit Doctor Details' : 'Add New Doctor'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4 font-body">
              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Doctor's Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-text-muted mb-1.5">Department</label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50"
                  >
                    <option>General Medicine</option>
                    <option>Cardiology</option>
                    <option>Pediatrics</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-text-muted mb-1.5">Consultation Fee (₹)</label>
                  <input
                    type="number"
                    value={fee}
                    onChange={(e) => setFee(Number(e.target.value))}
                    className="w-full px-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Phone Number (with country code)</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50"
                  placeholder="+919415577651"
                  required
                />
              </div>

              {/* Schedule Editor */}
              <div className="space-y-3 border-t border-card-border/50 pt-4">
                <h3 className="text-md font-bold text-text-main">Weekly Schedule Availability</h3>
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day) => {
                  const isActive = !!schedule[day];
                  return (
                    <div key={day} className="flex flex-col gap-2 p-2.5 bg-card-bg/30 border border-card-border/50 rounded-xl">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 font-semibold text-sm text-text-main cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isActive}
                            onChange={() => toggleDay(day)}
                            className="rounded border-card-border text-accent-color focus:ring-accent-color"
                          />
                          <span>{day}</span>
                        </label>
                      </div>
                      
                      {isActive && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-text-muted">Shift 1 Range:</span>
                            <input
                              type="text"
                              value={schedule[day][0] || ''}
                              onChange={(e) => updateDaySchedule(day, 0, e.target.value)}
                              className="w-full px-2 py-1 bg-card-bg border border-card-border rounded mt-1"
                              placeholder="09:00-13:00"
                            />
                          </div>
                          <div>
                            <span className="text-text-muted">Shift 2 Range (Optional):</span>
                            <input
                              type="text"
                              value={schedule[day][1] || ''}
                              onChange={(e) => updateDaySchedule(day, 1, e.target.value)}
                              className="w-full px-2 py-1 bg-card-bg border border-card-border rounded mt-1"
                              placeholder="15:00-18:00"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-3 pt-6 border-t border-card-border/50">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-3 bg-card-bg border border-card-border hover:bg-card-border/20 text-text-main font-bold rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-gradient-to-r from-teal-500 to-violet-600 hover:from-teal-600 hover:to-violet-700 text-white font-bold rounded-xl transition-all shadow-lg"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
