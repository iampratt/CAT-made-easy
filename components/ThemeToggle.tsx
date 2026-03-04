'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'night';

const themes: Theme[] = ['light', 'dark', 'night'];

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    const stored = window.localStorage.getItem('cat-theme') as Theme | null;
    return stored && themes.includes(stored) ? stored : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('cat-theme', theme);
  }, [theme]);

  return (
    <div className="theme-toggle" role="group" aria-label="Theme selector">
      {themes.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => setTheme(item)}
          className={`theme-chip ${theme === item ? 'active' : ''}`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
