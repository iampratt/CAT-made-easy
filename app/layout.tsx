import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'CAT Mock Generator',
  description: 'Personalized CAT mock and PYQ practice platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container nav-row">
            <Link href="/" className="brand">CAT Mock Generator</Link>
            <nav className="nav-links">
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/mock">Mocks</Link>
              <Link href="/practice/section">Practice</Link>
              <Link href="/pyq">PYQ Search</Link>
            </nav>
          </div>
        </header>
        <main className="container page">{children}</main>
      </body>
    </html>
  );
}
