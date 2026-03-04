import Link from 'next/link';
import { PerformanceChart } from '@/components/PerformanceChart';
import { ScoreCard } from '@/components/ScoreCard';

const trend = [
  { name: 'M1', quant: 48, dilr: 42, varc: 58 },
  { name: 'M2', quant: 53, dilr: 46, varc: 62 },
  { name: 'M3', quant: 60, dilr: 51, varc: 66 },
  { name: 'M4', quant: 64, dilr: 57, varc: 70 },
];

export default function DashboardPage() {
  return (
    <section className="grid" style={{ gap: 16 }}>
      <div className="grid grid-3">
        <ScoreCard title="Latest Score" value="84" subtitle="Estimated 95 percentile" />
        <ScoreCard title="Mocks Completed" value="12" subtitle="4 in last 14 days" />
        <ScoreCard title="Weakest Topic" value="Time & Work" subtitle="Accuracy 36%" />
      </div>
      <PerformanceChart data={trend} />
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Actions</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link className="btn" href="/mock">Generate New Mock</Link>
          <Link className="btn secondary" href="/practice/topic">Practice Weak Topics</Link>
          <Link className="btn secondary" href="/pyq">Search PYQs</Link>
        </div>
      </div>
    </section>
  );
}
