import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthNav } from '@/components/AuthNav';
import { ThemeToggle } from '@/components/ThemeToggle';
import './globals.css';

export const metadata: Metadata = {
  title: 'CAT Mock Generator',
  description: 'Personalized CAT mock and PYQ practice platform',
};

const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem('cat-theme');
    var theme = stored === 'dark' || stored === 'night' || stored === 'light' ? stored : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <header className="site-header">
          <div className="container nav-row">
            <Link href="/" className="brand">CAT Mock Generator</Link>
            <div className="header-controls">
              <AuthNav />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="container page">{children}</main>
      </body>
    </html>
  );
}
