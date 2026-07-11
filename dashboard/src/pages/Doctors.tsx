import { useState, useEffect, useRef, useCallback } from 'react';
import {
  UserPlus, Edit2, Trash2, Calendar, Phone, Stethoscope, IndianRupee,
  Upload, X, Loader2, FileText, Download, CheckCircle, AlertCircle,
  FileBadge, Award, Folder, Image as ImageIcon, FileUp, ChevronDown, ChevronUp, ClipboardList
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface DoctorDocument {
  id: number;
  doctor_id: number;
  category: 'photo' | 'certificate' | 'license' | 'document';
  filename: string;
  file_url: string;
  uploaded_at: string;
}

interface BulkDoctorRow {
  name: string;
  department: string;
  phone: string;
  fee: string | number;
  services: string;
  details: string;
  photo_url: string;
  // schedule (Mon–Sat shift1, shift2)
  mon_s1: string; mon_s2: string;
  tue_s1: string; tue_s2: string;
  wed_s1: string; wed_s2: string;
  thu_s1: string; thu_s2: string;
  fri_s1: string; fri_s2: string;
  sat_s1: string; sat_s2: string;
  _errors?: string[];
  _status?: 'pending' | 'success' | 'error';
  _resultMsg?: string;
}

interface DoctorsProps {
  userRole: string;
}

// ─── CSV Template ─────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  'name', 'department', 'phone', 'fee', 'services', 'details', 'photo_url',
  'mon_s1', 'mon_s2', 'tue_s1', 'tue_s2', 'wed_s1', 'wed_s2',
  'thu_s1', 'thu_s2', 'fri_s1', 'fri_s2', 'sat_s1', 'sat_s2'
];

const DEPARTMENTS = [
  'General Medicine', 'Cardiology', 'Pediatrics', 'Orthopedics', 'Gynecology',
  'Neurology', 'Dermatology', 'ENT', 'Ophthalmology', 'Psychiatry',
  'Pulmonology', 'Gastroenterology', 'Urology', 'Oncology', 'Radiology', 'Anesthesiology'
];

const DOC_CATEGORIES: { key: DoctorDocument['category']; label: string; icon: any; accept: string; color: string }[] = [
  { key: 'photo',       label: 'Profile Photo',        icon: ImageIcon,     accept: 'image/*',                              color: 'teal' },
  { key: 'certificate', label: 'Degree / Certificate', icon: Award,         accept: 'image/*,.pdf',                         color: 'violet' },
  { key: 'license',     label: 'Medical License',      icon: FileBadge,     accept: 'image/*,.pdf',                         color: 'amber' },
  { key: 'document',    label: 'Other Documents',      icon: Folder,        accept: 'image/*,.pdf,.doc,.docx',              color: 'rose' },
];

function downloadCSVTemplate() {
  const exampleRow = [
    'Dr. Priya Verma', 'Cardiology', '+919876543210', '500',
    'ECG, Echo, BP Management', 'Experienced Cardiologist with 8+ years.', 'https://example.com/photo.jpg',
    '09:00-13:00', '15:00-18:00',
    '09:00-13:00', '15:00-18:00',
    '09:00-13:00', '',
    '09:00-13:00', '15:00-18:00',
    '09:00-13:00', '15:00-18:00',
    '09:00-13:00', '',
  ];
  const csvContent = [CSV_HEADERS.join(','), exampleRow.join(',')].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vardan_doctors_bulk_import_template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────

function parseCSV(text: string): BulkDoctorRow[] {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const rows: BulkDoctorRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    // Handle quoted commas
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (const ch of lines[i]) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    cells.push(cur.trim());

    const row: any = {};
    headers.forEach((h, idx) => { row[h] = (cells[idx] || '').replace(/"/g, '').trim(); });

    const errors: string[] = [];
    if (!row.name) errors.push('Name required');
    if (!row.department) errors.push('Department required');
    if (!row.phone) errors.push('Phone required');
    if (!row.fee || isNaN(Number(row.fee))) errors.push('Valid fee required');

    row._errors = errors;
    row._status = 'pending';
    rows.push(row as BulkDoctorRow);
  }
  return rows;
}

function buildScheduleFromRow(row: BulkDoctorRow): Record<string, string[]> {
  const days: [string, string, string][] = [
    ['Monday',    row.mon_s1, row.mon_s2],
    ['Tuesday',   row.tue_s1, row.tue_s2],
    ['Wednesday', row.wed_s1, row.wed_s2],
    ['Thursday',  row.thu_s1, row.thu_s2],
    ['Friday',    row.fri_s1, row.fri_s2],
    ['Saturday',  row.sat_s1, row.sat_s2],
  ];
  const schedule: Record<string, string[]> = {};
  for (const [day, s1, s2] of days) {
    if (s1) {
      schedule[day] = s2 ? [s1, s2] : [s1];
    }
  }
  if (Object.keys(schedule).length === 0) {
    schedule['Monday'] = ['09:00-13:00', '15:00-18:00'];
  }
  return schedule;
}

// ─── Document Upload Zone (per category) ─────────────────────────────────────

function DocCategoryZone({
  catKey, label, icon: Icon, color, accept,
  documents, onUpload, onDelete, uploading
}: {
  catKey: DoctorDocument['category'];
  label: string;
  icon: any;
  color: string;
  accept: string;
  documents: DoctorDocument[];
  onUpload: (file: File, cat: DoctorDocument['category']) => void;
  onDelete: (doc: DoctorDocument) => void;
  uploading: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const colorMap: Record<string, string> = {
    teal:   'border-teal-500/40   bg-teal-500/5   text-teal-400',
    violet: 'border-violet-500/40 bg-violet-500/5 text-violet-400',
    amber:  'border-amber-500/40  bg-amber-500/5  text-amber-400',
    rose:   'border-rose-500/40   bg-rose-500/5   text-rose-400',
  };

  const catDocs = documents.filter(d => d.category === catKey);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(f => onUpload(f, catKey));
  };

  return (
    <div className="space-y-2">
      <div
        className={`relative border-2 border-dashed rounded-xl p-3 cursor-pointer transition-all ${
          dragging ? colorMap[color] : 'border-card-border/40 bg-card-bg/20 hover:bg-card-bg/40'
        }`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={e => {
            Array.from(e.target.files || []).forEach(f => onUpload(f, catKey));
            e.target.value = '';
          }}
        />
        <div className="flex items-center gap-2">
          <Icon size={16} className={`${colorMap[color].split(' ')[2]} flex-shrink-0`} />
          <span className="text-xs font-semibold text-text-main">{label}</span>
          {uploading && <Loader2 size={12} className="animate-spin text-text-muted ml-auto" />}
          {!uploading && (
            <span className="ml-auto text-[10px] text-text-muted">
              {catDocs.length > 0 ? `${catDocs.length} file${catDocs.length > 1 ? 's' : ''}` : 'Drop or click'}
            </span>
          )}
        </div>
      </div>

      {catDocs.length > 0 && (
        <div className="space-y-1 pl-1">
          {catDocs.map(doc => (
            <div key={doc.id} className="flex items-center gap-2 text-xs group">
              <FileText size={12} className="text-text-muted flex-shrink-0" />
              <a
                href={doc.file_url}
                target="_blank"
                rel="noreferrer"
                className="flex-1 text-text-muted hover:text-text-main truncate"
                title={doc.filename}
                onClick={e => e.stopPropagation()}
              >
                {doc.filename}
              </a>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onDelete(doc); }}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-red-400 hover:text-red-300 transition-all"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Doctors({ userRole }: DoctorsProps) {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);

  // Single Add/Edit modal
  const [showModal, setShowModal] = useState(false);
  const [editingDoc, setEditingDoc] = useState<Doctor | null>(null);
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
    Saturday: ['09:00-13:00', '15:00-18:00'],
  });

  // Single photo upload
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Categorized documents (for edit modal)
  const [docUploading, setDocUploading] = useState(false);
  const [doctorDocs, setDoctorDocs] = useState<DoctorDocument[]>([]);
  const [showDocsSection, setShowDocsSection] = useState(false);

  // Bulk Import modal
  const [showBulk, setShowBulk] = useState(false);
  const [bulkDragging, setBulkDragging] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkDoctorRow[]>([]);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkDone, setBulkDone] = useState(false);
  const [importMode, setImportMode] = useState<'csv' | 'ai'>('csv');
  const [aiFiles, setAiFiles] = useState<{ file: File; status: 'pending' | 'parsing' | 'success' | 'error'; error?: string }[]>([]);
  const [aiParsing, setAiParsing] = useState(false);

  // ── Fetch doctors ──────────────────────────────────────────────────────────

  const fetchDoctors = useCallback(async () => {
    try {
      const res = await fetch('/api/doctors', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      setDoctors(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDoctors(); }, [fetchDoctors]);

  // ── Single doctor photo upload ─────────────────────────────────────────────

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
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
          body: JSON.stringify({ filename: file.name, base64Data: reader.result, category: 'photo' }),
        });
        const data = await res.json();
        if (res.ok && data.url) {
          setPhotoUrl(data.url);
        } else {
          setUploadError(data.error || 'Failed to upload image');
        }
      } catch {
        setUploadError('Failed to upload image. Please try again.');
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => { setUploadError('Failed to read file.'); setUploading(false); };
  };

  // ── Category document upload ───────────────────────────────────────────────

  const handleDocUpload = async (file: File, cat: DoctorDocument['category']) => {
    if (!editingDoc) return;
    setDocUploading(true);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const upRes = await fetch('/api/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
          body: JSON.stringify({ filename: file.name, base64Data: reader.result, category: cat }),
        });
        const upData = await upRes.json();
        if (!upRes.ok || !upData.url) { setDocUploading(false); return; }

        const docRes = await fetch(`/api/doctors/${editingDoc.id}/documents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
          body: JSON.stringify({ category: cat, filename: upData.filename || file.name, file_url: upData.url }),
        });
        const docData = await docRes.json();
        if (docRes.ok) {
          setDoctorDocs(prev => [docData, ...prev]);
        }
      } catch (err) {
        console.error('Doc upload failed:', err);
      } finally {
        setDocUploading(false);
      }
    };
    reader.onerror = () => setDocUploading(false);
  };

  const handleDocDelete = async (doc: DoctorDocument) => {
    if (!editingDoc) return;
    try {
      await fetch(`/api/doctors/${editingDoc.id}/documents/${doc.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      setDoctorDocs(prev => prev.filter(d => d.id !== doc.id));
    } catch (err) {
      console.error('Doc delete failed:', err);
    }
  };

  // ── Open modals ────────────────────────────────────────────────────────────

  const openAddModal = () => {
    setEditingDoc(null);
    setName(''); setDepartment('General Medicine'); setPhone('');
    setFee(300); setDetails(''); setPhotoUrl(''); setServices('');
    setSchedule({
      Monday: ['09:00-13:00', '15:00-18:00'], Tuesday: ['09:00-13:00', '15:00-18:00'],
      Wednesday: ['09:00-13:00', '15:00-18:00'], Thursday: ['09:00-13:00', '15:00-18:00'],
      Friday: ['09:00-13:00', '15:00-18:00'], Saturday: ['09:00-13:00', '15:00-18:00'],
    });
    setDoctorDocs([]); setShowDocsSection(false); setUploadError('');
    setShowModal(true);
  };

  const openEditModal = async (doc: Doctor) => {
    setEditingDoc(doc);
    setName(doc.name); setDepartment(doc.department); setPhone(doc.phone);
    setFee(doc.fee); setDetails(doc.details || ''); setPhotoUrl(doc.photo_url || '');
    setServices(doc.services || '');
    setSchedule(JSON.parse(doc.weekly_schedule_json));
    setUploadError(''); setShowDocsSection(false);

    // Fetch existing docs
    try {
      const res = await fetch(`/api/doctors/${doc.id}/documents`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      setDoctorDocs(Array.isArray(data) ? data : []);
    } catch { setDoctorDocs([]); }

    setShowModal(true);
  };

  // ── Single save ────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingDoc ? `/api/doctors/${editingDoc.id}` : '/api/doctors';
    const method = editingDoc ? 'PUT' : 'POST';
    const body = {
      name, department, phone, fee,
      weekly_schedule_json: JSON.stringify(schedule),
      details, photo_url: photoUrl, services,
      active: editingDoc ? editingDoc.active : 1,
    };
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) { setShowModal(false); fetchDoctors(); }
    } catch (err) { console.error(err); }
  };

  const handleDeactivate = async (id: number) => {
    if (!confirm('Are you sure you want to deactivate this doctor?')) return;
    try {
      await fetch(`/api/doctors/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      fetchDoctors();
    } catch (err) { console.error(err); }
  };

  const toggleDay = (day: string) => {
    setSchedule(prev => {
      const updated = { ...prev };
      if (updated[day]) delete updated[day];
      else updated[day] = ['09:00-13:00', '15:00-18:00'];
      return updated;
    });
  };

  const updateDaySchedule = (day: string, index: number, value: string) => {
    setSchedule(prev => {
      const updated = { ...prev };
      if (updated[day]) updated[day][index] = value;
      return updated;
    });
  };

  // ── Bulk Import ─────────────────────────────────────────────────────────────

  const handleBulkDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setBulkDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseBulkFile(file);
  };

  const parseBulkFile = (file: File) => {
    const reader = new FileReader();
    reader.readAsText(file);
    reader.onload = () => {
      const rows = parseCSV(reader.result as string);
      setBulkRows(rows);
      setBulkDone(false);
    };
  };

  const handleBulkImport = async () => {
    const validRows = bulkRows.filter(r => !r._errors?.length);
    if (validRows.length === 0) return;
    setBulkImporting(true);

    const payload = validRows.map(row => ({
      name: row.name,
      department: row.department,
      phone: row.phone,
      fee: Number(row.fee),
      services: row.services || null,
      details: row.details || null,
      photo_url: row.photo_url || null,
      weekly_schedule_json: JSON.stringify(buildScheduleFromRow(row)),
    }));

    try {
      const res = await fetch('/api/doctors/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ doctors: payload }),
      });
      const data = await res.json();

      // Map results back to rows
      setBulkRows(prev => {
        let resultIdx = 0;
        return prev.map(row => {
          if (row._errors?.length) return row;
          const result = data.results?.[resultIdx++];
          return {
            ...row,
            _status: result?.status || 'error',
            _resultMsg: result?.error || (result?.status === 'success' ? '✓ Saved' : 'Unknown error'),
          };
        });
      });
      setBulkDone(true);
      fetchDoctors();
    } catch (err) {
      console.error('Bulk import failed:', err);
    } finally {
      setBulkImporting(false);
    }
  };

  const openBulkModal = () => {
    setBulkRows([]);
    setBulkDone(false);
    setImportMode('csv');
    setAiFiles([]);
    setShowBulk(true);
  };

  const parseAIFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (files.length > 50) {
      alert("Maximum 50 files can be uploaded at once.");
      return;
    }

    setAiParsing(true);
    setBulkDone(false);

    // Initialize files list in state
    const initialFiles = files.map(f => ({
      file: f,
      status: 'pending' as const
    }));
    setAiFiles(initialFiles);

    // Process files sequentially
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setAiFiles(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'parsing' } : item));

      try {
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Failed to read file"));
        });

        const res = await fetch('/api/doctors/parse-document', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
          body: JSON.stringify({ filename: file.name, base64Data }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to parse document');
        }

        // Map to BulkDoctorRow
        const schedule = data.weekly_schedule_json || {};
        const errors: string[] = [];
        if (!data.name) errors.push('Name required');
        if (!data.department) errors.push('Department required');
        if (!data.phone) errors.push('Phone required');
        if (!data.fee || isNaN(Number(data.fee))) errors.push('Valid fee required');

        const row: BulkDoctorRow = {
          name: data.name || '',
          department: data.department || 'General Medicine',
          phone: data.phone || '',
          fee: data.fee || 300,
          services: data.services || '',
          details: data.details || '',
          photo_url: data.photo_url || '',
          mon_s1: schedule.Monday?.[0] || '',
          mon_s2: schedule.Monday?.[1] || '',
          tue_s1: schedule.Tuesday?.[0] || '',
          tue_s2: schedule.Tuesday?.[1] || '',
          wed_s1: schedule.Wednesday?.[0] || '',
          wed_s2: schedule.Wednesday?.[1] || '',
          thu_s1: schedule.Thursday?.[0] || '',
          thu_s2: schedule.Thursday?.[1] || '',
          fri_s1: schedule.Friday?.[0] || '',
          fri_s2: schedule.Friday?.[1] || '',
          sat_s1: schedule.Saturday?.[0] || '',
          sat_s2: schedule.Saturday?.[1] || '',
          _errors: errors,
          _status: 'pending'
        };

        setBulkRows(prev => [...prev, row]);
        setAiFiles(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'success' } : item));
      } catch (err: any) {
        console.error(`Failed parsing ${file.name}:`, err);
        setAiFiles(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'error', error: err.message || 'Unknown error' } : item));
      }
    }

    setAiParsing(false);
  };

  const handleAIDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setBulkDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) parseAIFiles(files);
  };

  const handleRemoveBulkRow = (index: number) => {
    setBulkRows(prev => prev.filter((_, idx) => idx !== index));
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const validBulkCount = bulkRows.filter(r => !r._errors?.length).length;
  const invalidBulkCount = bulkRows.filter(r => r._errors?.length).length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold font-hero text-text-main">Doctor Management</h1>
          <p className="text-text-muted mt-1 font-body">Manage doctors, availability, fees, and departments.</p>
        </div>
        {userRole === 'owner' && (
          <div className="flex items-center gap-3">
            <button
              onClick={openBulkModal}
              className="flex items-center gap-2 px-4 py-3 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-300 font-bold rounded-xl transition-all active:scale-95"
            >
              <FileUp size={18} />
              <span>Bulk Import</span>
            </button>
            <button
              onClick={openAddModal}
              className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-teal-500 to-violet-600 hover:from-teal-600 hover:to-violet-700 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95"
            >
              <UserPlus size={20} />
              <span>Add Doctor</span>
            </button>
          </div>
        )}
      </div>

      {/* Doctor Cards */}
      {loading ? (
        <div className="text-center py-12 text-text-muted">Loading doctors...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {doctors.map((doc) => (
            <div key={doc.id} className={`glass-panel p-6 flex flex-col relative overflow-hidden transition-all duration-300 hover:scale-[1.02] border ${doc.active ? 'border-card-border' : 'border-red-500/20 opacity-70'}`}>
              <div className="absolute -right-8 -top-8 w-24 h-24 rounded-full bg-accent-color/10 blur-xl" />

              <div className="flex items-start gap-4 mb-4">
                {doc.photo_url ? (
                  <img src={doc.photo_url} alt={doc.name} className="w-16 h-16 rounded-2xl object-cover border border-card-border shadow-sm flex-shrink-0" />
                ) : (
                  <div className="p-3 bg-accent-color/10 rounded-2xl text-accent-color w-16 h-16 flex items-center justify-center flex-shrink-0">
                    <Stethoscope size={24} />
                  </div>
                )}
                <div>
                  <h2 className="text-xl font-bold font-hero text-text-main">{doc.name}</h2>
                  <span className="inline-block px-2.5 py-1 bg-violet-500/10 text-violet-400 font-body text-xs rounded-full mt-1">{doc.department}</span>
                  {!doc.active && <span className="inline-block px-2.5 py-1 bg-red-500/10 text-red-400 font-body text-xs rounded-full ml-2">Inactive</span>}
                </div>
              </div>

              {doc.details && <p className="text-xs font-body text-text-muted mb-4 leading-relaxed line-clamp-3">{doc.details}</p>}

              {doc.services && (
                <div className="mb-4 font-body">
                  <div className="text-xs font-semibold text-text-main mb-1.5">Services Offered:</div>
                  <div className="flex flex-wrap gap-1">
                    {doc.services.split(',').map((svc: string) => (
                      <span key={svc} className="px-2.5 py-0.5 bg-teal-500/10 text-teal-400 text-[10px] font-bold rounded-md border border-teal-500/20">{svc.trim()}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3 font-body text-sm text-text-muted mb-6">
                <div className="flex items-center gap-2"><Phone size={16} className="text-accent-color" /><span>{doc.phone}</span></div>
                <div className="flex items-center gap-2"><IndianRupee size={16} className="text-accent-color" /><span>Consultation Fee: <span className="text-text-main font-bold">₹{doc.fee}</span></span></div>
                <div className="border-t border-card-border/50 pt-3">
                  <div className="flex items-center gap-2 font-semibold text-text-main mb-1.5"><Calendar size={16} /><span>Weekly Schedule</span></div>
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    {Object.entries(JSON.parse(doc.weekly_schedule_json)).map(([day, slots]: any) => (
                      <div key={day} className="flex justify-between border-b border-card-border/20 py-0.5">
                        <span className="font-medium text-text-main">{day.slice(0, 3)}:</span>
                        <span>{slots.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {userRole === 'owner' && (
                <div className="flex gap-2 pt-4 border-t border-card-border/50">
                  <button onClick={() => openEditModal(doc)} className="flex-1 py-2.5 bg-card-bg border border-card-border hover:bg-card-border/20 text-text-main rounded-xl flex items-center justify-center gap-1.5 text-sm font-semibold transition-all">
                    <Edit2 size={14} /><span>Edit</span>
                  </button>
                  {doc.active ? (
                    <button onClick={() => handleDeactivate(doc.id)} className="py-2.5 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition-all">
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Add/Edit Modal ──────────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="glass-panel w-full max-w-2xl p-6 border border-card-border shadow-2xl relative max-h-[92vh] overflow-y-auto my-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold font-hero text-text-main">
                {editingDoc ? 'Edit Doctor Details' : 'Add New Doctor'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-card-border/30 rounded-lg text-text-muted transition-all">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 font-body">
              {/* Name */}
              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Doctor's Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50"
                  required />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-text-muted mb-1.5">Department</label>
                  <select value={department} onChange={e => setDepartment(e.target.value)}
                    className="w-full px-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50">
                    {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-text-muted mb-1.5">Consultation Fee (₹)</label>
                  <input type="number" value={fee} onChange={e => setFee(Number(e.target.value))}
                    className="w-full px-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50"
                    required />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Phone Number (with country code)</label>
                <input type="text" value={phone} onChange={e => setPhone(e.target.value)}
                  className="w-full px-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50"
                  placeholder="+919415577651" required />
              </div>

              {/* Photo Upload */}
              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Doctor's Profile Photo</label>
                <div
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFileUpload(f); }}
                  onClick={() => document.getElementById('doctor-photo-upload')?.click()}
                  className={`w-full p-5 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${
                    isDragging ? 'border-accent-color bg-accent-color/10' : 'border-card-border/50 bg-card-bg/20 hover:bg-card-bg/40'
                  }`}
                >
                  <input type="file" id="doctor-photo-upload" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} className="hidden" />
                  {uploading ? (
                    <div className="flex flex-col items-center gap-2 py-3"><Loader2 className="animate-spin text-accent-color" size={28} /><span className="text-sm font-semibold text-text-main">Uploading...</span></div>
                  ) : photoUrl ? (
                    <div className="flex flex-col items-center gap-3 w-full relative">
                      <div className="relative group">
                        <img src={photoUrl} alt="Preview" className="w-20 h-20 rounded-full object-cover border-2 border-accent-color/50 shadow-md"
                          onError={e => { (e.target as HTMLElement).style.display = 'none'; }} />
                        <button type="button" onClick={e => { e.stopPropagation(); setPhotoUrl(''); }}
                          className="absolute -top-1 -right-1 p-1 bg-red-500 hover:bg-red-600 text-white rounded-full transition-all shadow-md active:scale-90">
                          <X size={12} />
                        </button>
                      </div>
                      <span className="text-xs text-text-muted break-all text-center px-4 bg-black/20 py-1 rounded-md border border-card-border/30">{photoUrl}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-center py-1">
                      <div className="p-3 bg-accent-color/10 rounded-full text-accent-color"><Upload size={22} /></div>
                      <p className="text-sm font-bold text-text-main">Drag & drop photo here</p>
                      <p className="text-xs text-text-muted">or click to browse (JPG, PNG)</p>
                    </div>
                  )}
                  {uploadError && <p className="text-xs text-red-400 font-semibold text-center">{uploadError}</p>}
                </div>
                <div className="mt-2">
                  <span className="text-xs text-text-muted font-semibold block mb-1">Or paste direct photo URL:</span>
                  <input type="text" value={photoUrl} onChange={e => setPhotoUrl(e.target.value)}
                    className="w-full px-4 py-2 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50 text-xs"
                    placeholder="https://example.com/photo.jpg or /uploads/..." />
                </div>
              </div>

              {/* Services */}
              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Services Offered (comma-separated)</label>
                <input type="text" value={services} onChange={e => setServices(e.target.value)}
                  className="w-full px-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50"
                  placeholder="ECG, Consultation, Echo, BP Control" />
              </div>

              {/* Bio */}
              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Bio / Doctor Details</label>
                <textarea value={details} onChange={e => setDetails(e.target.value)}
                  className="w-full px-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50 h-20 resize-none"
                  placeholder="Experience, background, specializations..." />
              </div>

              {/* Categorized Document Upload (only for existing doctor / edit mode) */}
              {editingDoc && (
                <div className="border border-card-border/50 rounded-2xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowDocsSection(!showDocsSection)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-card-bg/40 hover:bg-card-bg/70 transition-all text-sm font-semibold text-text-main"
                  >
                    <div className="flex items-center gap-2">
                      <ClipboardList size={16} className="text-accent-color" />
                      <span>Additional Documents</span>
                      {doctorDocs.length > 0 && (
                        <span className="px-2 py-0.5 bg-accent-color/20 text-accent-color text-[10px] font-bold rounded-full">
                          {doctorDocs.length}
                        </span>
                      )}
                    </div>
                    {showDocsSection ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
                  </button>

                  {showDocsSection && (
                    <div className="p-4 space-y-4 border-t border-card-border/30">
                      <p className="text-xs text-text-muted">Upload categorized documents for this doctor. Supported: JPG, PNG, PDF, DOC, DOCX</p>
                      <div className="grid grid-cols-1 gap-4">
                        {DOC_CATEGORIES.map(cat => (
                          <DocCategoryZone
                            key={cat.key}
                            catKey={cat.key}
                            label={cat.label}
                            icon={cat.icon}
                            color={cat.color}
                            accept={cat.accept}
                            documents={doctorDocs}
                            onUpload={handleDocUpload}
                            onDelete={handleDocDelete}
                            uploading={docUploading}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Schedule */}
              <div className="space-y-3 border-t border-card-border/50 pt-4">
                <h3 className="text-md font-bold text-text-main">Weekly Schedule Availability</h3>
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => {
                  const isActive = !!schedule[day];
                  return (
                    <div key={day} className="flex flex-col gap-2 p-2.5 bg-card-bg/30 border border-card-border/50 rounded-xl">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 font-semibold text-sm text-text-main cursor-pointer">
                          <input type="checkbox" checked={isActive} onChange={() => toggleDay(day)}
                            className="rounded border-card-border text-accent-color focus:ring-accent-color" />
                          <span>{day}</span>
                        </label>
                      </div>
                      {isActive && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-text-muted">Shift 1:</span>
                            <input type="text" value={schedule[day][0] || ''} onChange={e => updateDaySchedule(day, 0, e.target.value)}
                              className="w-full px-2 py-1 bg-card-bg border border-card-border rounded mt-1" placeholder="09:00-13:00" />
                          </div>
                          <div>
                            <span className="text-text-muted">Shift 2 (Optional):</span>
                            <input type="text" value={schedule[day][1] || ''} onChange={e => updateDaySchedule(day, 1, e.target.value)}
                              className="w-full px-2 py-1 bg-card-bg border border-card-border rounded mt-1" placeholder="15:00-18:00" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-3 pt-6 border-t border-card-border/50">
                <button type="button" onClick={() => setShowModal(false)}
                  className="flex-1 py-3 bg-card-bg border border-card-border hover:bg-card-border/20 text-text-main font-bold rounded-xl transition-all">
                  Cancel
                </button>
                <button type="submit"
                  className="flex-1 py-3 bg-gradient-to-r from-teal-500 to-violet-600 hover:from-teal-600 hover:to-violet-700 text-white font-bold rounded-xl transition-all shadow-lg">
                  {editingDoc ? 'Save Changes' : 'Add Doctor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Bulk Import Modal ───────────────────────────────────────────────── */}
      {showBulk && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="glass-panel w-full max-w-5xl border border-card-border shadow-2xl relative my-4 flex flex-col max-h-[92vh]">

            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-card-border/50 flex-shrink-0">
              <div>
                <h2 className="text-2xl font-bold font-hero text-text-main">Bulk Doctor Import</h2>
                <p className="text-sm text-text-muted mt-0.5">Import multiple doctors at once (max 50)</p>
              </div>
              <button onClick={() => setShowBulk(false)} className="p-2 hover:bg-card-border/30 rounded-lg text-text-muted transition-all">
                <X size={20} />
              </button>
            </div>

            {/* Tab Selector */}
            <div className="flex border-b border-card-border/30 px-6 bg-card-bg/25 flex-shrink-0">
              <button
                type="button"
                onClick={() => { setImportMode('csv'); setBulkRows([]); setBulkDone(false); }}
                className={`py-3 px-4 text-sm font-semibold border-b-2 transition-all ${
                  importMode === 'csv'
                    ? 'border-accent-color text-accent-color'
                    : 'border-transparent text-text-muted hover:text-text-main'
                }`}
              >
                CSV Template Import
              </button>
              <button
                type="button"
                onClick={() => { setImportMode('ai'); setBulkRows([]); setBulkDone(false); setAiFiles([]); }}
                className={`py-3 px-4 text-sm font-semibold border-b-2 transition-all ${
                  importMode === 'ai'
                    ? 'border-accent-color text-accent-color'
                    : 'border-transparent text-text-muted hover:text-text-main'
                }`}
              >
                ✨ Smart AI Import (PDF, Image, Text)
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

              {importMode === 'ai' ? (
                <div className="space-y-4">
                  {/* AI Upload Zone */}
                  <div>
                    <p className="text-sm font-bold text-text-main mb-2">Upload doctors' details in PDF, text, or photos</p>
                    <div
                      onDragOver={e => { e.preventDefault(); setBulkDragging(true); }}
                      onDragLeave={() => setBulkDragging(false)}
                      onDrop={handleAIDrop}
                      onClick={() => document.getElementById('bulk-ai-input')?.click()}
                      className={`w-full p-8 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${
                        bulkDragging ? 'border-violet-500 bg-violet-500/10' : 'border-card-border/50 bg-card-bg/20 hover:bg-card-bg/40'
                      }`}
                    >
                      <input id="bulk-ai-input" type="file" multiple accept=".pdf,.txt,.jpg,.jpeg,.png,.webp" className="hidden"
                        onChange={e => { const files = Array.from(e.target.files || []); if (files.length > 0) parseAIFiles(files); e.target.value = ''; }} />
                      <div className="p-4 bg-violet-500/10 rounded-2xl text-violet-400"><FileUp size={32} /></div>
                      <div className="text-center">
                        <p className="text-base font-bold text-text-main">Drag & drop your files here</p>
                        <p className="text-sm text-text-muted">or click to browse · Supports PDF, TXT, JPG, PNG, WEBP · Max 50 files</p>
                      </div>
                    </div>
                  </div>

                  {/* AI Files Status list */}
                  {aiFiles.length > 0 && (
                    <div className="space-y-2 bg-card-bg/10 border border-card-border/40 p-4 rounded-2xl">
                      <p className="text-sm font-semibold text-text-main">Processing Files ({aiFiles.length})</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[200px] overflow-y-auto pr-1">
                        {aiFiles.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2.5 bg-card-bg/40 border border-card-border/30 rounded-xl text-xs">
                            <span className="truncate max-w-[70%] font-medium text-text-main" title={item.file.name}>{item.file.name}</span>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {item.status === 'pending' && <span className="text-text-muted">Waiting...</span>}
                              {item.status === 'parsing' && <span className="flex items-center gap-1 text-violet-400 font-semibold"><Loader2 size={12} className="animate-spin" /> Analyzing...</span>}
                              {item.status === 'success' && <span className="text-teal-400 font-semibold flex items-center gap-1"><CheckCircle size={12} /> Done</span>}
                              {item.status === 'error' && <span className="text-red-400 font-semibold flex items-center gap-1" title={item.error}><AlertCircle size={12} /> Failed</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Step 1: Download Template */}
                  <div className="flex items-center gap-4 p-4 bg-teal-500/5 border border-teal-500/20 rounded-2xl">
                    <div className="p-3 bg-teal-500/10 rounded-xl text-teal-400 flex-shrink-0"><Download size={22} /></div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-text-main">Step 1: Download CSV Template</p>
                      <p className="text-xs text-text-muted mt-0.5">Fill in the template with doctor details. Each row = 1 doctor.</p>
                    </div>
                    <button onClick={downloadCSVTemplate}
                      className="flex items-center gap-2 px-4 py-2 bg-teal-500/20 hover:bg-teal-500/30 border border-teal-500/30 text-teal-300 font-bold rounded-xl text-sm transition-all flex-shrink-0">
                      <Download size={15} /> Download Template
                    </button>
                  </div>

                  {/* Step 2: Upload CSV */}
                  <div>
                    <p className="text-sm font-bold text-text-main mb-2">Step 2: Upload your filled CSV file</p>
                    <div
                      onDragOver={e => { e.preventDefault(); setBulkDragging(true); }}
                      onDragLeave={() => setBulkDragging(false)}
                      onDrop={handleBulkDrop}
                      onClick={() => document.getElementById('bulk-csv-input')?.click()}
                      className={`w-full p-8 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${
                        bulkDragging ? 'border-violet-500 bg-violet-500/10' : 'border-card-border/50 bg-card-bg/20 hover:bg-card-bg/40'
                      }`}
                    >
                      <input id="bulk-csv-input" type="file" accept=".csv,.txt" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) parseBulkFile(f); e.target.value = ''; }} />
                      <div className="p-4 bg-violet-500/10 rounded-2xl text-violet-400"><FileText size={32} /></div>
                      <div className="text-center">
                        <p className="text-base font-bold text-text-main">Drag & drop your CSV file here</p>
                        <p className="text-sm text-text-muted">or click to browse · Max 50 doctors per file</p>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Preview Table */}
              {bulkRows.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-bold text-text-main">Step 3: Review & Import</p>
                      <span className="px-2.5 py-1 bg-teal-500/10 text-teal-400 text-xs font-bold rounded-full border border-teal-500/20">
                        {validBulkCount} valid
                      </span>
                      {invalidBulkCount > 0 && (
                        <span className="px-2.5 py-1 bg-red-500/10 text-red-400 text-xs font-bold rounded-full border border-red-500/20">
                          {invalidBulkCount} errors
                        </span>
                      )}
                    </div>
                    {bulkDone && (
                      <span className="flex items-center gap-1.5 text-teal-400 text-sm font-bold">
                        <CheckCircle size={16} /> Import complete!
                      </span>
                    )}
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-card-border/50">
                    <table className="w-full text-xs font-body">
                      <thead>
                        <tr className="bg-card-bg/60 border-b border-card-border/50">
                          {['#', 'Name', 'Department', 'Phone', 'Fee', 'Services', 'Status', 'Action'].map(h => (
                            <th key={h} className="px-3 py-2.5 text-left text-text-muted font-semibold whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {bulkRows.map((row, i) => {
                          const hasErr = (row._errors?.length || 0) > 0;
                          const isSuccess = row._status === 'success';
                          const isError = row._status === 'error';
                          return (
                            <tr key={i} className={`border-b border-card-border/30 transition-colors ${
                              hasErr ? 'bg-red-500/5' : isSuccess ? 'bg-teal-500/5' : isError ? 'bg-orange-500/5' : ''
                            }`}>
                              <td className="px-3 py-2 text-text-muted">{i + 1}</td>
                              <td className="px-3 py-2 font-semibold text-text-main whitespace-nowrap">{row.name || '—'}</td>
                              <td className="px-3 py-2 text-text-muted whitespace-nowrap">{row.department || '—'}</td>
                              <td className="px-3 py-2 text-text-muted whitespace-nowrap">{row.phone || '—'}</td>
                              <td className="px-3 py-2 text-text-muted">{row.fee ? `₹${row.fee}` : '—'}</td>
                              <td className="px-3 py-2 text-text-muted max-w-[150px] truncate">{row.services || '—'}</td>
                              <td className="px-3 py-2">
                                {hasErr ? (
                                  <div className="flex items-start gap-1">
                                    <AlertCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
                                    <span className="text-red-400">{row._errors?.join(', ')}</span>
                                  </div>
                                ) : isSuccess ? (
                                  <span className="flex items-center gap-1 text-teal-400"><CheckCircle size={12} /> Saved</span>
                                ) : isError ? (
                                  <span className="text-orange-400">{row._resultMsg}</span>
                                ) : (
                                  <span className="text-text-muted">Ready</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveBulkRow(i)}
                                  className="text-red-400 hover:text-red-300 font-semibold p-1 transition-all active:scale-95"
                                  title="Remove from import list"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-card-border/50 flex items-center justify-between gap-4 flex-shrink-0 bg-card-bg/30">
              <div className="text-xs text-text-muted">
                {bulkRows.length > 0
                  ? `${bulkRows.length} rows detected · ${validBulkCount} will be imported`
                  : importMode === 'ai' ? 'Drop files to auto-extract doctor details' : 'Download the template, fill it, then upload'}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowBulk(false)}
                  className="px-5 py-2.5 bg-card-bg border border-card-border hover:bg-card-border/20 text-text-main font-bold rounded-xl text-sm transition-all">
                  Close
                </button>
                {validBulkCount > 0 && !bulkDone && (
                  <button
                    onClick={handleBulkImport}
                    disabled={bulkImporting || aiParsing}
                    className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-teal-500 to-violet-600 hover:from-teal-600 hover:to-violet-700 disabled:opacity-60 text-white font-bold rounded-xl text-sm transition-all shadow-lg"
                  >
                    {bulkImporting ? (
                      <><Loader2 size={16} className="animate-spin" /> Importing...</>
                    ) : (
                      <><CheckCircle size={16} /> Import {validBulkCount} Doctors</>
                    )}
                  </button>
                )}
                {bulkDone && validBulkCount > 0 && (
                  <button onClick={() => { setBulkRows([]); setBulkDone(false); setAiFiles([]); }}
                    className="px-5 py-2.5 bg-teal-500/20 hover:bg-teal-500/30 border border-teal-500/30 text-teal-300 font-bold rounded-xl text-sm transition-all">
                    Import More
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
