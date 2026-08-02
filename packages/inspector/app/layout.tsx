import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Noetic Inspector',
  description: 'Edit, chat with, and inspect a Noetic agent.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="h-screen overflow-hidden bg-page text-ink antialiased">{children}</body>
    </html>
  );
}
