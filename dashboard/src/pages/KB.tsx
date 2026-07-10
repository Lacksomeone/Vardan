import { useState, useEffect } from 'react';
import { HelpCircle, Edit2, Plus, Sparkles, MessageSquareCode, CheckCircle2 } from 'lucide-react';

interface KbEntry {
  id: number;
  category: string;
  question_variants: string;
  answer_hi: string;
  answer_en: string;
  answer_hinglish: string;
}

interface PendingQuery {
  id: number;
  patient_id: string;
  patient_name: string;
  patient_phone: string;
  question: string;
  created_at: string;
}

export default function KB() {
  const [kbEntries, setKbEntries] = useState<KbEntry[]>([]);
  const [pendingQueries, setPendingQueries] = useState<PendingQuery[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<KbEntry | null>(null);

  // FAQ Form State
  const [category, setCategory] = useState('timings');
  const [variantsText, setVariantsText] = useState('');
  const [answerHi, setAnswerHi] = useState('');
  const [answerEn, setAnswerEn] = useState('');
  const [answerHinglish, setAnswerHinglish] = useState('');

  // Resolve Modal State
  const [resolvingQuery, setResolvingQuery] = useState<PendingQuery | null>(null);
  const [resolveAnswer, setResolveAnswer] = useState('');
  const [addToKb, setAddToKb] = useState(true);
  const [resolveCategory, setResolveCategory] = useState('general');

  const fetchData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      
      const kbRes = await fetch('/api/kb', { headers: { Authorization: `Bearer ${token}` } });
      const kbData = await kbRes.json();
      setKbEntries(kbData);

      const pqRes = await fetch('/api/pending-queries', { headers: { Authorization: `Bearer ${token}` } });
      const pqData = await pqRes.json();
      setPendingQueries(pqData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openAddModal = () => {
    setEditingEntry(null);
    setCategory('general');
    setVariantsText('');
    setAnswerHi('');
    setAnswerEn('');
    setAnswerHinglish('');
    setShowAddModal(true);
  };

  const openEditModal = (entry: KbEntry) => {
    setEditingEntry(entry);
    setCategory(entry.category);
    setVariantsText(JSON.parse(entry.question_variants).join(', '));
    setAnswerHi(entry.answer_hi);
    setAnswerEn(entry.answer_en);
    setAnswerHinglish(entry.answer_hinglish);
    setShowAddModal(true);
  };

  const handleSaveFaq = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingEntry ? `/api/kb/${editingEntry.id}` : '/api/kb';
    const method = editingEntry ? 'PUT' : 'POST';

    const question_variants = variantsText.split(',').map(s => s.trim()).filter(Boolean);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          category,
          question_variants,
          answer_hi: answerHi,
          answer_en: answerEn,
          answer_hinglish: answerHinglish
        })
      });

      if (res.ok) {
        setShowAddModal(false);
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvingQuery) return;

    try {
      const res = await fetch(`/api/pending-queries/${resolvingQuery.id}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          answer: resolveAnswer,
          addToKb,
          category: resolveCategory,
          question_variants: [resolvingQuery.question]
        })
      });

      if (res.ok) {
        setResolvingQuery(null);
        setResolveAnswer('');
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8 overflow-y-auto max-h-[calc(100vh-120px)]">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold font-hero text-text-main">Knowledge Base (RAG)</h1>
          <p className="text-text-muted mt-1 font-body">Ground the bot's responses with hospital facts. Resolve pending queries dynamically.</p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-teal-500 to-violet-600 hover:from-teal-600 hover:to-violet-700 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95"
        >
          <Plus size={20} />
          <span>Add FAQ Entry</span>
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-muted font-body">Loading knowledge base...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Pending Queries (Unresolved Questions) */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center gap-2">
              <MessageSquareCode size={20} className="text-yellow-400" />
              <h2 className="text-xl font-bold font-hero text-text-main">Pending Audits</h2>
            </div>
            
            {pendingQueries.length === 0 ? (
              <div className="glass-panel p-6 text-center text-text-muted font-body text-sm">
                No unresolved queries from patients! The AI is fully trained for now.
              </div>
            ) : (
              <div className="space-y-4">
                {pendingQueries.map(pq => (
                  <div key={pq.id} className="glass-panel p-4 border border-card-border flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] px-2 py-0.5 bg-yellow-500/10 text-yellow-400 font-bold rounded-full font-body">
                        Unresolved
                      </span>
                      <span className="text-[10px] text-text-muted font-body">
                        {new Date(pq.created_at).toLocaleDateString()}
                      </span>
                    </div>

                    <p className="text-sm font-semibold font-body text-text-main italic bg-black/10 p-2.5 rounded-lg border border-card-border/50">
                      "{pq.question}"
                    </p>

                    <div className="text-xs text-text-muted font-body">
                      Asked by: <span className="text-text-main font-bold">{pq.patient_name}</span> ({pq.patient_phone})
                    </div>

                    <button
                      onClick={() => {
                        setResolvingQuery(pq);
                        setResolveAnswer('');
                      }}
                      className="py-2 w-full bg-accent-color/10 hover:bg-accent-color/20 text-accent-color font-bold rounded-lg text-xs font-body transition-all"
                    >
                      Resolve & Answer
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Permanent FAQ Directory */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-2">
              <HelpCircle size={20} className="text-teal-400" />
              <h2 className="text-xl font-bold font-hero text-text-main">Knowledge Base Entries</h2>
            </div>

            <div className="space-y-4">
              {kbEntries.map(entry => (
                <div key={entry.id} className="glass-panel p-5 border border-card-border flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <span className="px-3 py-1 bg-violet-500/10 text-violet-400 font-bold text-xs font-body rounded-full capitalize">
                      Category: {entry.category}
                    </span>
                    <button
                      onClick={() => openEditModal(entry)}
                      className="p-2 hover:bg-card-border/20 text-text-muted hover:text-text-main rounded-lg transition-all"
                    >
                      <Edit2 size={14} />
                    </button>
                  </div>

                  <div className="font-body text-xs text-text-muted">
                    <span className="font-semibold text-text-main">Search Keywords:</span> {JSON.parse(entry.question_variants).join(', ')}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-body text-xs mt-2 border-t border-card-border/40 pt-3">
                    <div className="p-2 bg-black/10 rounded-lg">
                      <div className="font-bold text-teal-400 mb-1">Hindi (Devanagari)</div>
                      <p className="text-text-main">{entry.answer_hi}</p>
                    </div>
                    <div className="p-2 bg-black/10 rounded-lg">
                      <div className="font-bold text-violet-400 mb-1">Hinglish</div>
                      <p className="text-text-main">{entry.answer_hinglish}</p>
                    </div>
                    <div className="p-2 bg-black/10 rounded-lg">
                      <div className="font-bold text-pink-400 mb-1">English</div>
                      <p className="text-text-main">{entry.answer_en}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit FAQ Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="glass-panel w-full max-w-lg p-6 border border-card-border shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold font-hero text-text-main mb-6">
              {editingEntry ? 'Edit FAQ Entry' : 'Create FAQ Entry'}
            </h2>

            <form onSubmit={handleSaveFaq} className="space-y-4 font-body text-sm">
              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50"
                >
                  <option value="timings">Timings</option>
                  <option value="location">Location & Address</option>
                  <option value="emergency">Emergency / ICU</option>
                  <option value="insurance">Insurance & Cashless</option>
                  <option value="general">General Queries</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Search Keywords / Phrase Variants (comma-separated)</label>
                <textarea
                  value={variantsText}
                  onChange={(e) => setVariantsText(e.target.value)}
                  className="w-full px-4 py-2 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none"
                  rows={2}
                  placeholder="fees, consulting fee, consultation, cost, prescription fee"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Hindi Answer (Devanagari)</label>
                <textarea
                  value={answerHi}
                  onChange={(e) => setAnswerHi(e.target.value)}
                  className="w-full px-4 py-2 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none"
                  rows={2}
                  placeholder="वरदान हॉस्पिटल में सामान्य परामर्श शुल्क..."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Hinglish Answer</label>
                <textarea
                  value={answerHinglish}
                  onChange={(e) => setAnswerHinglish(e.target.value)}
                  className="w-full px-4 py-2 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none"
                  rows={2}
                  placeholder="Vardan hospital me general consulting fee..."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">English Answer</label>
                <textarea
                  value={answerEn}
                  onChange={(e) => setAnswerEn(e.target.value)}
                  className="w-full px-4 py-2 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none"
                  rows={2}
                  placeholder="Consultation fee at Vardan Hospital..."
                  required
                />
              </div>

              <div className="flex gap-3 pt-6 border-t border-card-border/50">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-3 bg-card-bg border border-card-border hover:bg-card-border/20 text-text-main font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-gradient-to-r from-teal-500 to-violet-600 hover:from-teal-600 hover:to-violet-700 text-white font-bold rounded-xl transition-all shadow-lg"
                >
                  Save Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Resolve Query Modal */}
      {resolvingQuery && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="glass-panel w-full max-w-md p-6 border border-card-border shadow-2xl relative">
            <h2 className="text-2xl font-bold font-hero text-text-main mb-4 flex items-center gap-2">
              <Sparkles size={20} className="text-yellow-400" />
              <span>Resolve Question</span>
            </h2>

            <form onSubmit={handleResolveSubmit} className="space-y-4 font-body text-sm">
              <div className="p-3 bg-black/10 rounded-lg border border-card-border/50 text-text-main italic mb-3">
                "{resolvingQuery.question}"
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-muted mb-1.5">Response Answer</label>
                <textarea
                  value={resolveAnswer}
                  onChange={(e) => setResolveAnswer(e.target.value)}
                  className="w-full px-4 py-2.5 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-accent-color/50"
                  rows={3}
                  placeholder="Type the response to log..."
                  required
                />
              </div>

              <div className="flex items-center gap-2 p-1.5">
                <input
                  type="checkbox"
                  id="addToKb"
                  checked={addToKb}
                  onChange={(e) => setAddToKb(e.target.checked)}
                  className="rounded border-card-border text-accent-color focus:ring-accent-color"
                />
                <label htmlFor="addToKb" className="font-semibold text-text-main cursor-pointer select-none">
                  Add as permanent Q&A entry in Knowledge Base
                </label>
              </div>

              {addToKb && (
                <div>
                  <label className="block text-sm font-semibold text-text-muted mb-1.5">RAG Category</label>
                  <select
                    value={resolveCategory}
                    onChange={(e) => setResolveCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-card-bg border border-card-border rounded-xl text-text-main focus:outline-none"
                  >
                    <option value="timings">Timings</option>
                    <option value="location">Location & Address</option>
                    <option value="emergency">Emergency / ICU</option>
                    <option value="insurance">Insurance & Cashless</option>
                    <option value="general">General Queries</option>
                  </select>
                </div>
              )}

              <div className="flex gap-3 pt-6 border-t border-card-border/50">
                <button
                  type="button"
                  onClick={() => setResolvingQuery(null)}
                  className="flex-1 py-3 bg-card-bg border border-card-border hover:bg-card-border/20 text-text-main font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-gradient-to-r from-teal-500 to-violet-600 hover:from-teal-600 hover:to-violet-700 text-white font-bold rounded-xl transition-all shadow-lg flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 size={16} />
                  <span>Submit Answer</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
