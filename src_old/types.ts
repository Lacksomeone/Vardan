export interface Patient {
  id: string; // WhatsApp JID
  name: string;
  phone: string;
  age: number;
  gender: string;
  preferred_language: 'hi' | 'en' | 'hinglish';
  created_at?: string;
}

export interface Doctor {
  id: number;
  name: string;
  department: string;
  phone: string;
  weekly_schedule_json: string; // JSON weekly slots
  fee: number;
  active: number;
  created_at?: string;
}

export interface Appointment {
  id?: number;
  patient_id: string;
  doctor_id: number;
  date: string; // YYYY-MM-DD
  time_slot: string; // e.g. "10:00-10:30"
  status: 'pending' | 'confirmed' | 'cancelled' | 'rescheduled';
  created_at?: string;
}

export interface Conversation {
  id?: number;
  patient_id: string;
  role: 'patient' | 'bot' | 'system';
  message: string;
  agent_used: 'router' | 'follow_up' | 'faq' | 'booking';
  language: 'hi' | 'en' | 'hinglish';
  timestamp?: string;
}

export interface FollowUpJob {
  id: number;
  patient_id: string;
  doctor_id: number;
  trigger_date: string;
  message_template: string;
  status: 'pending' | 'sent' | 'escalated' | 'responded';
  created_at?: string;
}

export interface KnowledgeBaseEntry {
  id: number;
  category: string;
  question_variants: string; // JSON array of strings
  answer_hi: string;
  answer_en: string;
  answer_hinglish: string;
  updated_at?: string;
}

export interface PendingQuery {
  id: number;
  patient_id: string;
  question: string;
  status: 'pending' | 'resolved';
  answered_by?: string;
  answer?: string;
  created_at?: string;
}

export interface LLMKeyRecord {
  id: number;
  provider: 'groq' | 'gemini' | 'openrouter';
  key_val: string;
  cooldown_until: number;
  usage_count: number;
  active: number;
}
