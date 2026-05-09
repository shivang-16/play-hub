'use client';

import { useEffect, useState } from 'react';
import { CHARACTERS, GAME_CHARACTERS, CharacterName } from './characters';
import CharacterAvatar from './CharacterAvatar';
import styles from './characters.module.css';

interface Props {
  gameKey: string;
  winnerName: string;      // the name of the winner
  currentUser: string;     // current user's username
  onClose: () => void;
}

const WIN_MESSAGES = [
  "Absolutely incredible! You crushed it! 🏆",
  "That was AMAZING! Pure skill right there! ⭐",
  "Unstoppable! You played like a champion! 👑",
  "WOW! That was a masterclass performance! 🔥",
  "You're on fire! What a brilliant game! 🌟",
];

const LOSE_MESSAGES = [
  "Great effort! Every game makes you stronger! 💪",
  "So close! You'll get them next time! 🎯",
  "Impressive play! Keep going — you've got this! 🌈",
  "That was a tough one! Bounce back even stronger! 🚀",
];

const DRAW_MESSAGES = [
  "What a match! Two evenly-matched players! 🤝",
  "Perfectly balanced — as all things should be! ⚖️",
  "A tie! Both of you played brilliantly! 🌟",
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export default function WinCelebration({ gameKey, winnerName, currentUser, onClose }: Props) {
  const charName: CharacterName = GAME_CHARACTERS[gameKey] ?? 'rashu';
  const character = CHARACTERS[charName];
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  const isDraw = !winnerName || winnerName === 'tie';
  const isWinner = winnerName === currentUser;

  const message = isDraw
    ? pickRandom(DRAW_MESSAGES)
    : isWinner
    ? pickRandom(WIN_MESSAGES)
    : pickRandom(LOSE_MESSAGES);

  const headline = isDraw
    ? "It's a Draw! 🤝"
    : isWinner
    ? "You Win! 🏆"
    : `${winnerName} Wins! 🎮`;

  const cssVars = {
    '--char-color': character.color,
    '--char-glow': `${character.color}55`,
    '--char-secondary': character.secondaryColor,
  } as React.CSSProperties;

  return (
    <div className={styles.backdrop} style={cssVars}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>

        {isWinner && (
          <span className={styles.confettiRow}>🎊 🎉 🎊 🎉 🎊</span>
        )}

        <CharacterAvatar
          character={character}
          gesture={isWinner ? 'clap' : 'win'}
          size={110}
        />

        <p className={styles.charName}>{character.displayName}</p>

        <h2 className={styles.celebTitle}>{headline}</h2>

        {isWinner && (
          <span className={styles.confettiRow}>👏 ⭐ 👏 ⭐ 👏</span>
        )}

        <div className={styles.bubble}>
          {message}
        </div>

        <div className={styles.actions}>
          <button className={styles.btnPrimary} onClick={onClose} style={cssVars}>
            {isWinner ? 'Thanks! 😊' : 'Play Again! 🎮'}
          </button>
        </div>
      </div>
    </div>
  );
}
