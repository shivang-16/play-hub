import type { Metadata } from 'next';
import React from "react";

export const metadata: Metadata = {
  title: '4 in a Row',
};

export default async function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
   

      <main className="flex flex-1 flex-col">
        <div className="flex-1">{children}</div>
      </main>
  );
}
