'use client';

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export function PerformanceChart({
  data,
}: {
  data: Array<{ name: string; quant: number; dilr: number; varc: number }>;
}) {
  return (
    <div className="card" style={{ height: 300 }}>
      <h4 style={{ marginTop: 0 }}>Accuracy Trend</h4>
      <ResponsiveContainer width="100%" height="90%">
        <LineChart data={data}>
          <XAxis dataKey="name" />
          <YAxis domain={[0, 100]} />
          <Tooltip />
          <Line dataKey="quant" stroke="#0ea5e9" strokeWidth={2} />
          <Line dataKey="dilr" stroke="#14b8a6" strokeWidth={2} />
          <Line dataKey="varc" stroke="#f97316" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
