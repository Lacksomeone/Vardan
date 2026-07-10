import { useState, useEffect } from 'react';
import { UserPlus, Edit2, Trash2, Calendar, Phone, Stethoscope, IndianRupee, Upload, X, Loader2 } from 'lucide-react';

interface Doctor {
  id: number;
  name: string;
  department: string;
  phone: string;
  weekly_schedule_json: string;
  fee: number;
  details?: string;
  photo_url?: string;
  services?: string;
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
  const [details, setDetails] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [services, setServices] = useState('');
  const [schedule, setSchedule] = useState<Record<string, string[]>>({
    Monday: ['09:00-13:00', '15:00-18:00'],
    Tuesday: ['09:00-13:00', '15:00-18:00'],
    Wednesday: ['09:00-13:00', '15:00-18:00'],
    Thursday: ['09:00-13:00', '15:00-18:00'],
    Friday: ['09:00-13:00', '15:00-18:00'],
    Saturday: ['09:00-13:00', '15:00-18:00']
  });

  // Drag and Drop Upload States & Handlers
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setUploadError('Please upload an image file (PNG, JPG, JPEG)');
      return;
    }
    setUploading(true);
    setUploadError('');
    
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({
            filename: file.name,
            base64Data: reader.result
          })
        });
        const data = await res.json();
        if (res.ok && data.url) {
          setPhotoUrl(data.url);
        } else {
          setUploadError(data.error || 'Failed to upload image');
        }
      } catch (err) {
        console.error('Upload request failed:', err);
        setUploadError('Failed to upload image. Please try again.');
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => {
      setUploadError('Failed to read file.');
      setUploading(false);
    };
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileUpload(file);
    }
  };

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
    setDetails('');
    setPhotoUrl('');
    setServices('');
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
    setDetails(doc.details || '');
    setPhotoUrl(doc.photo_url || '');
    setServices(doc.services || '');
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
      details,
      photo_url: photoUrl,
      services,
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
                {doc.photo_url ? (
                  <img
                    src={doc.photo_url}
                    alt={doc.name}
                    className="w-16 h-16 rounded-2xl object-cover border border-card-border shadow-sm flex-shrink-0"
                  />
                ) : (
                  <div className="p-3 bg-accent-color/10 rounded-2xl text-accent-color w-16 h-16 flex items-center justify-center flex-shrink-0">
                    <Stethoscope size={24} />
                  </div>
                )}
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

              {doc.details && (
                <p className="text-xs font-body text-text-muted mb-4 leading-relaxed line-clamp-3">
                  {doc.details}
                </p>
              )}

              {doc.services && (
                <div className="mb-4 font-body">
                  <div className="text-xs font-semibold text-text-main mb-1.5">Services Offered:</div>
                  <div className="flex flex-wrap gap-1">
                    {doc.services.split(',').map((svc: string) => (
                      <span
                        key={svc}
                        className="px-2.5 py-0.5 bg-teal-500/10 text-teal-400 text-[10px] font-bold rounded-md border border-teal-500/20"
                      >
                        {svc.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3 font-body text-sm text-text-muted mb-6">
                <div className="flex items-center gap-2">
                  <Phone size={16} className="text-accent-color" />
                  <span>{doc.phone}</span>
                </div>
                <div className="flex items-center gap-2">
                  <IndianRupee size={16} className="text-accent-color" />
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

              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Doctor's Photo</label>
                
                {/* Drag and Drop Zone */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById('doctor-photo-upload')?.click()}
                  className={`w-full p-6 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${
                    isDragging
                      ? 'border-accent-color bg-accent-color/10'
                      : 'border-card-border/50 bg-card-bg/20 hover:bg-card-bg/40'
                  }`}
                >
                  <input
                    type="file"
                    id="doctor-photo-upload"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                    }}
                    className="hidden"
                  />

                  {uploading ? (
                    <div className="flex flex-col items-center gap-2 py-4">
                      <Loader2 className="animate-spin text-accent-color" size={32} />
                      <span className="text-sm font-semibold text-text-main">Uploading image...</span>
                    </div>
                  ) : photoUrl ? (
                    <div className="flex flex-col items-center gap-3 w-full relative">
                      <div className="relative group">
                        <img
                          src={photoUrl}
                          alt="Preview"
                          className="w-24 h-24 rounded-full object-cover border-2 border-accent-color/50 shadow-md"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPhotoUrl('');
                          }}
                          className="absolute -top-1 -right-1 p-1 bg-red-500 hover:bg-red-600 text-white rounded-full transition-all shadow-md active:scale-90"
                        >
                          <X size={12} />
                        </button>
                      </div>
                      <span className="text-xs text-text-muted break-all text-center px-4 bg-black/20 py-1 rounded-md border border-card-border/30">
                        {photoUrl}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-center py-2">
                      <div className="p-3 bg-accent-color/10 rounded-full text-accent-color">
                        <Upload size={24} />
                      </div>
                      <p className="text-sm font-bold text-text-main">Drag & drop doctor photo here</p>
                      <p className="text-xs text-text-muted">or click to browse from files (JPG, PNG)</p>
                    </div>
                  )}

                  {uploadError && (
                    <p className="text-xs text-red-400 font-semibold text-center">{uploadError}</p>
                  )}
                </div>

                {/* Direct text URL input fallback */}
                <div className="mt-2.5">
                  <span className="text-xs text-text-muted font-semibold block mb-1">Or paste direct photo URL:</span>
                  <input
                    type="text"
                    value={photoUrl}
                    onChange={(e) => setPhotoUrl(e.target.value)}
                    className="w-full px-4 py-2 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50 text-xs"
                    placeholder="https://images.unsplash.com/... or /uploads/..."
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Services Offered (comma-separated)</label>
                <input
                  type="text"
                  value={services}
                  onChange={(e) => setServices(e.target.value)}
                  className="w-full px-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50"
                  placeholder="ECG, Consultation, Echo, BP Control"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Bio / Doctor Details</label>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  className="w-full px-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50 h-20 resize-none"
                  placeholder="Experience, background, specializations..."
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
