import { useState, useEffect } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Users, Calendar, HelpCircle, MessageSquare } from 'lucide-react';

interface StatsData {
  summary: {
    patients: number;
    appointments: number;
    pendingQueries: number;
  };
  followUps: { status: string; count: number }[];
  callChart: { day: string; calls: number; success: number }[];
}

export default function Analytics() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/monitor/stats', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  // Compute follow-up statistics
  const getFollowUpMetrics = () => {
    if (!stats) return { total: 0, responded: 0, rate: 0 };
    let total = 0;
    let responded = 0;
    for (const f of stats.followUps) {
      total += f.count;
      if (f.status === 'responded') {
        responded += f.count;
      }
    }
    const rate = total > 0 ? Math.round((responded / total) * 100) : 0;
    return { total, responded, rate };
  };

  const { total: totalFU, responded: respondedFU, rate: responseRate } = getFollowUpMetrics();

  // Circular progress ring parameters
  const radius = 50;
  const stroke = 8;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (responseRate / 100) * circumference;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8 overflow-y-auto max-h-[calc(100vh-120px)]">
      <div>
        <h1 className="text-3xl font-extrabold font-hero text-text-main">VardanAI Analytics</h1>
        <p className="text-text-muted mt-1 font-body">Track patient engagement, bookings utilization, and follow-up health metrics.</p>
      </div>

      {loading || !stats ? (
        <div className="text-center py-12 text-text-muted font-body">Loading analytics telemetry...</div>
      ) : (
        <>
          {/* Hero Stat Blocks (frosted glassmorphism) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-body">
            
            {/* Patients Stat */}
            <div className="glass-panel p-6 border border-card-border relative overflow-hidden flex items-center justify-between group hover:border-accent-color/30 transition-all duration-300">
              <div className="space-y-2">
                <span className="text-sm font-semibold text-text-muted">Total Patients</span>
                <h2 className="text-4xl font-extrabold font-hero text-text-main transition-all group-hover:scale-105">
                  {stats.summary.patients}
                </h2>
                <p className="text-[10px] text-text-muted">WhatsApp registered records</p>
              </div>
              <div className="p-4 bg-accent-color/10 rounded-2xl text-accent-color transition-all group-hover:bg-accent-color/20">
                <Users size={28} />
              </div>
            </div>

            {/* Appointments Stat */}
            <div className="glass-panel p-6 border border-card-border relative overflow-hidden flex items-center justify-between group hover:border-violet-500/30 transition-all duration-300">
              <div className="space-y-2">
                <span className="text-sm font-semibold text-text-muted">Total Appointments</span>
                <h2 className="text-4xl font-extrabold font-hero text-text-main transition-all group-hover:scale-105">
                  {stats.summary.appointments}
                </h2>
                <p className="text-[10px] text-text-muted">Bookings logged in DB</p>
              </div>
              <div className="p-4 bg-violet-500/10 rounded-2xl text-violet-400 transition-all group-hover:bg-violet-500/20">
                <Calendar size={28} />
              </div>
            </div>

            {/* Unresolved queries Stat */}
            <div className="glass-panel p-6 border border-card-border relative overflow-hidden flex items-center justify-between group hover:border-yellow-500/30 transition-all duration-300">
              <div className="space-y-2">
                <span className="text-sm font-semibold text-text-muted">Pending Audits</span>
                <h2 className="text-4xl font-extrabold font-hero text-text-main transition-all group-hover:scale-105">
                  {stats.summary.pendingQueries}
                </h2>
                <p className="text-[10px] text-text-muted">Awaiting reception answers</p>
              </div>
              <div className="p-4 bg-yellow-500/10 rounded-2xl text-yellow-400 transition-all group-hover:bg-yellow-500/20">
                <HelpCircle size={28} />
              </div>
            </div>

          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Circular Progress Ring Card: Follow-up responded rate */}
            <div className="lg:col-span-1 glass-panel p-6 border border-card-border flex flex-col items-center justify-center text-center gap-4 relative overflow-hidden">
              <div className="absolute -right-16 -bottom-16 w-36 h-36 rounded-full bg-accent-color/5 blur-2xl"></div>
              
              <h3 className="font-bold font-hero text-text-main text-lg border-b border-card-border/50 pb-2 w-full">
                Follow-Up Conversion
              </h3>

              <div className="relative flex items-center justify-center my-4">
                <svg height={radius * 2} width={radius * 2} className="transform -rotate-90">
                  <circle
                    stroke="rgba(255,255,255,0.05)"
                    fill="transparent"
                    strokeWidth={stroke}
                    r={normalizedRadius}
                    cx={radius}
                    cy={radius}
                  />
                  <circle
                    stroke="url(#progressGrad)"
                    fill="transparent"
                    strokeWidth={stroke}
                    strokeDasharray={circumference + ' ' + circumference}
                    style={{ strokeDashoffset }}
                    r={normalizedRadius}
                    cx={radius}
                    cy={radius}
                    strokeLinecap="round"
                    className="transition-all duration-500"
                  />
                  <defs>
                    <linearGradient id="progressGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="hsl(265, 85%, 60%)" />
                      <stop offset="100%" stopColor="hsl(180, 80%, 40%)" />
                    </linearGradient>
                  </defs>
                </svg>
                
                <div className="absolute flex flex-col items-center justify-center font-body text-center">
                  <span className="text-2xl font-extrabold text-text-main font-hero">{responseRate}%</span>
                  <span className="text-[9px] text-text-muted uppercase tracking-wider font-semibold">Rate</span>
                </div>
              </div>

              <div className="space-y-1.5 font-body text-xs text-text-muted mt-2">
                <div className="flex justify-between w-48 border-b border-card-border/30 pb-1">
                  <span>Total Scheduled:</span>
                  <span className="font-bold text-text-main">{totalFU}</span>
                </div>
                <div className="flex justify-between w-48">
                  <span>Responded Recovery:</span>
                  <span className="font-bold text-text-main">{respondedFU}</span>
                </div>
              </div>
            </div>

            {/* Gradient Bar Chart Card: Daily load graph */}
            <div className="lg:col-span-2 glass-panel p-6 border border-card-border flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-card-border/50 pb-2">
                <h3 className="font-bold font-hero text-text-main text-lg flex items-center gap-2">
                  <MessageSquare size={18} className="text-violet-400" />
                  <span>Agent Conversational Load (Last 7 Days)</span>
                </h3>
              </div>

              <div className="h-64 flex items-center justify-center">
                {stats.callChart.length === 0 ? (
                  <div className="text-text-muted font-body text-sm">No activity records logged this week.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.callChart} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="day" stroke="#888" tickLine={false} style={{ fontSize: 10, fontFamily: 'Plus Jakarta Sans' }} />
                      <YAxis stroke="#888" tickLine={false} style={{ fontSize: 10, fontFamily: 'Plus Jakarta Sans' }} />
                      <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: 8, fontSize: 11, fontFamily: 'Plus Jakarta Sans' }} />
                      <Bar dataKey="calls" fill="url(#analyticsGrad)" radius={[6, 6, 0, 0]}>
                        <defs>
                          <linearGradient id="analyticsGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(180, 80%, 40%)" />
                            <stop offset="100%" stopColor="hsl(265, 85%, 60%)" />
                          </linearGradient>
                        </defs>
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

          </div>
        </>
      )}
    </div>
  );
}
