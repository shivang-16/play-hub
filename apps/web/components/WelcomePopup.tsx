'use client';

import { useEffect, useState } from 'react';
import { CHARACTERS } from './characters';
import CharacterAvatar from './CharacterAvatar';
import styles from './characters.module.css';

const STORAGE_KEY = 'playarena_welcomed';

export default function WelcomePopup() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Show once per session
    if (!sessionStorage.getItem(STORAGE_KEY)) {
      const t = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  const handleClose = () => {
    sessionStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;

  const rashu = CHARACTERS.rashu;

  return (
    <div
      className={styles.backdrop}
      onClick={handleClose}
      style={{ '--char-color': rashu.color, '--char-glow': `${rashu.color}55` } as React.CSSProperties}
    >
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={handleClose}>✕</button>

        <CharacterAvatar character={rashu} gesture="welcome" size={120} />

        <p className={styles.charName}>{rashu.displayName}</p>
        <h2 className={styles.welcomeTitle}>Welcome to Play Arena!</h2>
        <p className={styles.welcomeSub}>Your friendly game guide</p>

        <div className={styles.bubble}>
          Hey there! 👋 I&apos;m <strong style={{ color: '#f472b6' }}>Rashu</strong>, your game guide! We have three amazing games — 4 in a Row, Word Search, and Dots &amp; Boxes. Pick one and let&apos;s have some fun! 🎮
        </div>

        <div className={styles.actions}>
          <button className={styles.btnPrimary} onClick={handleClose}>
            Let&apos;s Play! 🎉
          </button>
        </div>
      </div>
    </div>
  );
}
