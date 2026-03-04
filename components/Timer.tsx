'use client';

import { useEffect, useState } from 'react';

export function Timer({ initialSeconds, onExpire }: { initialSeconds: number; onExpire: () => void }) {
  const [seconds, setSeconds] = useState(initialSeconds);

  useEffect(() => {
    const id = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(id);
          onExpire();
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [onExpire]);

  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  const danger = seconds <= 300;

  return (
    <div className="card" style={{ color: danger ? 'var(--danger)' : 'inherit' }}>
      <strong>Time Left:</strong> {String(min).padStart(2, '0')}:{String(sec).padStart(2, '0')}
    </div>
  );
}
