import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthNav } from '@/components/AuthNav';
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
            <AuthNav />
          </div>
        </header>
        <main className="container page">{children}</main>
      </body>
    </html>
  );
}
