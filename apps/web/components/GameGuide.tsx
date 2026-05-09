'use client';

import { useState } from 'react';
import { CHARACTERS, GAME_CHARACTERS, GAME_GUIDES, CharacterName } from './characters';
import CharacterAvatar from './CharacterAvatar';
import styles from './characters.module.css';

interface Props {
  gameKey: string;        // e.g. '4-in-a-row'
  onDone: () => void;     // called when guide is dismissed
}

export default function GameGuide({ gameKey, onDone }: Props) {
  const charName: CharacterName = GAME_CHARACTERS[gameKey] ?? 'rashu';
  const character = CHARACTERS[charName];
  const steps = GAME_GUIDES[gameKey] ?? [];
  const [step, setStep] = useState(0);

  const isLast = step === steps.length - 1;

  const handleNext = () => {
    if (isLast) {
      onDone();
    } else {
      setStep((s) => s + 1);
    }
  };

  if (!steps.length) {
    onDone();
    return null;
  }

  const cssVars = {
    '--char-color': character.color,
    '--char-glow': `${character.color}55`,
    '--char-secondary': character.secondaryColor,
  } as React.CSSProperties;

  return (
    <div className={styles.backdrop} style={cssVars}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onDone}>✕</button>

        <CharacterAvatar character={character} gesture="guide" size={110} />

        <p className={styles.charName}>{character.displayName}</p>

        <div className={styles.bubble} key={step}>
          {steps[step]}
        </div>

        {/* Progress dots */}
        <div className={styles.dots}>
          {steps.map((_, i) => (
            <div
              key={i}
              className={`${styles.dot} ${i === step ? styles.dotActive : ''}`}
            />
          ))}
        </div>

        <div className={styles.actions}>
          <button className={styles.btnPrimary} onClick={handleNext} style={cssVars}>
            {isLast ? 'Got it! 🚀' : 'Next →'}
          </button>
          <button className={styles.btnSkip} onClick={onDone}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
