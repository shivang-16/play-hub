'use client';

import Link from 'next/link';
import styles from './hub.module.css';
import WelcomePopup from '../../components/WelcomePopup';

const GAMES = [
  {
    href: '/4-in-a-row',
    title: '4 in a Row',
    icon: '🔴',
    accent: '#ff6b6b',
    glow: 'rgba(255,107,107,0.3)',
    gradient: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%)',
    description: 'Drop discs, outsmart your rival. Connect four to win — challenge friends or battle a smart bot.',
    tags: ['2-8 Players', 'Strategy', 'VS Bot'],
    players: '1-8',
  },
  {
    href: '/word-puzzle',
    title: 'Word Search',
    icon: '📝',
    accent: '#c8972a',
    glow: 'rgba(200,151,42,0.3)',
    gradient: 'linear-gradient(135deg, #c8972a 0%, #8a6018 100%)',
    description: 'Race to find hidden words on the board. Longer words earn more points — beat friends or go solo.',
    tags: ['1-8 Players', 'Words', 'Competitive'],
    players: '1-8',
  },
  {
    href: '/dots-and-boxes',
    title: 'Dots & Boxes',
    icon: '⬜',
    accent: '#a044ff',
    glow: 'rgba(160,68,255,0.3)',
    gradient: 'linear-gradient(135deg, #a044ff 0%, #6a3093 100%)',
    description: 'Draw lines between dots to claim boxes. Complete a box, take another turn — the most boxes wins!',
    tags: ['1-8 Players', 'Strategy', 'VS Bot'],
    players: '1-8',
  },
];

export default function HubPage() {
  return (
    <div className={styles.page}>
      <WelcomePopup />
      {/* Hero */}
      <header className={styles.hero}>
        <div className={styles.logoWrap}>
          <span className={styles.logoDice}>🎲</span>
          <span className={styles.logoController}>🎮</span>
          <span className={styles.logoPuzzle}>🧩</span>
        </div>
        <h1 className={styles.title}>Play Arena</h1>
        <p className={styles.tagline}>Pick a game. Challenge your friends. Have fun.</p>
      </header>

      {/* Game cards */}
      <main className={styles.grid}>
        {GAMES.map((g) => (
          <Link
            key={g.href}
            href={g.href}
            className={styles.card}
            style={{
              '--accent': g.accent,
              '--glow': g.glow,
              '--grad': g.gradient,
            } as React.CSSProperties}
          >
            <div className={styles.cardShine} />
            <div className={styles.cardInner}>
              <div className={styles.cardHeader}>
                <span className={styles.cardIcon}>{g.icon}</span>
                <div className={styles.cardPlayerBadge}>{g.players} Players</div>
              </div>
              <h2 className={styles.cardTitle}>{g.title}</h2>
              <p className={styles.cardDesc}>{g.description}</p>
              <div className={styles.cardTags}>
                {g.tags.map((t) => (
                  <span key={t} className={styles.tag}>{t}</span>
                ))}
              </div>
              <div className={styles.cardBtn}>
                <span>Play Now</span>
                <span className={styles.cardArrow}>→</span>
              </div>
            </div>
          </Link>
        ))}
      </main>

      {/* Footer */}
      <footer className={styles.footer}>
        <span className={styles.footerText}>Made with <span className={styles.heart}>&#10084;</span> by Shivang</span>
      </footer>
    </div>
  );
}
