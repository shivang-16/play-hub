import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dots & Boxes',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
