'use client';

import React from 'react';
import { Character } from './characters';
import styles from './characters.module.css';

// Gesture emojis per context
const GESTURES: Record<string, string> = {
  welcome: '👋',
  guide:   '💡',
  win:     '🎉',
  clap:    '👏',
};

interface Props {
  character: Character;
  gesture?: keyof typeof GESTURES;
  size?: number;
}

// Beautiful hand-crafted SVG avatar for each character
function RashuSVG({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Background circle */}
      <circle cx="60" cy="60" r="60" fill="#fce7f3"/>
      {/* Hair — long black hair */}
      <ellipse cx="60" cy="42" rx="30" ry="34" fill="#1a0a0a"/>
      <rect x="30" y="50" width="12" height="45" rx="6" fill="#1a0a0a"/>
      <rect x="78" y="50" width="12" height="45" rx="6" fill="#1a0a0a"/>
      {/* Neck */}
      <rect x="53" y="82" width="14" height="16" rx="4" fill="#f9c4b0"/>
      {/* Face */}
      <ellipse cx="60" cy="62" rx="24" ry="26" fill="#f9c4b0"/>
      {/* Blush */}
      <ellipse cx="42" cy="68" rx="7" ry="4" fill="rgba(255,150,150,0.35)"/>
      <ellipse cx="78" cy="68" rx="7" ry="4" fill="rgba(255,150,150,0.35)"/>
      {/* Eyes */}
      <ellipse cx="50" cy="60" rx="5" ry="6" fill="#1a0a0a"/>
      <ellipse cx="70" cy="60" rx="5" ry="6" fill="#1a0a0a"/>
      <circle cx="52" cy="58" r="1.5" fill="white"/>
      <circle cx="72" cy="58" r="1.5" fill="white"/>
      {/* Eyebrows */}
      <path d="M44 53 Q50 50 56 53" stroke="#1a0a0a" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      <path d="M64 53 Q70 50 76 53" stroke="#1a0a0a" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      {/* Nose */}
      <ellipse cx="60" cy="68" rx="3" ry="2" fill="#e8a898"/>
      {/* Lips */}
      <path d="M52 75 Q60 80 68 75" stroke="#e05090" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      <path d="M52 75 Q56 73 60 74 Q64 73 68 75" stroke="#e05090" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      {/* Shoulder / top */}
      <path d="M20 120 Q30 95 55 92 Q65 90 65 92 Q90 95 100 120Z" fill="#f472b6"/>
      {/* Hair highlight */}
      <ellipse cx="48" cy="35" rx="6" ry="12" fill="rgba(255,255,255,0.08)" transform="rotate(-15 48 35)"/>
    </svg>
  );
}

function TanyaSVG({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Background */}
      <circle cx="60" cy="60" r="60" fill="#ede9fe"/>
      {/* Hair — wavy brown */}
      <ellipse cx="60" cy="42" rx="28" ry="32" fill="#6b3a1f"/>
      <path d="M32 52 Q28 72 34 90" stroke="#6b3a1f" strokeWidth="11" strokeLinecap="round" fill="none"/>
      <path d="M88 52 Q92 72 86 90" stroke="#6b3a1f" strokeWidth="11" strokeLinecap="round" fill="none"/>
      {/* Hair waves */}
      <path d="M32 60 Q28 68 34 76 Q28 84 34 90" stroke="#8b5a2b" strokeWidth="4" strokeLinecap="round" fill="none"/>
      <path d="M88 60 Q92 68 86 76 Q92 84 86 90" stroke="#8b5a2b" strokeWidth="4" strokeLinecap="round" fill="none"/>
      {/* Neck */}
      <rect x="53" y="82" width="14" height="16" rx="4" fill="#f5c5a3"/>
      {/* Face */}
      <ellipse cx="60" cy="62" rx="24" ry="26" fill="#f5c5a3"/>
      {/* Blush */}
      <ellipse cx="41" cy="68" rx="7" ry="4" fill="rgba(255,150,120,0.3)"/>
      <ellipse cx="79" cy="68" rx="7" ry="4" fill="rgba(255,150,120,0.3)"/>
      {/* Eyes — slightly almond */}
      <ellipse cx="50" cy="60" rx="5.5" ry="5.5" fill="#2d1a0e"/>
      <ellipse cx="70" cy="60" rx="5.5" ry="5.5" fill="#2d1a0e"/>
      <circle cx="52" cy="58" r="1.5" fill="white"/>
      <circle cx="72" cy="58" r="1.5" fill="white"/>
      {/* Eyebrows — arched */}
      <path d="M43 52 Q50 48 57 52" stroke="#4a2800" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      <path d="M63 52 Q70 48 77 52" stroke="#4a2800" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      {/* Nose */}
      <ellipse cx="60" cy="68" rx="3" ry="2" fill="#d8a88a"/>
      {/* Lips */}
      <path d="M52 76 Q60 81 68 76" stroke="#c0507a" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      <path d="M52 76 Q56 73 60 74.5 Q64 73 68 76" stroke="#c0507a" strokeWidth="1.5" fill="none"/>
      {/* Clothing */}
      <path d="M18 120 Q28 96 55 92 Q65 90 65 92 Q92 96 102 120Z" fill="#818cf8"/>
      {/* Hair highlight */}
      <ellipse cx="47" cy="36" rx="5" ry="10" fill="rgba(255,255,255,0.1)" transform="rotate(-12 47 36)"/>
    </svg>
  );
}

function SimmuSVG({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Background */}
      <circle cx="60" cy="60" r="60" fill="#d1fae5"/>
      {/* Hair — dark, pulled up / bun style */}
      <ellipse cx="60" cy="38" rx="27" ry="28" fill="#1c0f0f"/>
      {/* Bun */}
      <circle cx="60" cy="18" r="12" fill="#1c0f0f"/>
      <circle cx="60" cy="16" r="8" fill="#2c1515"/>
      {/* Side hair strands */}
      <rect x="32" y="46" width="10" height="38" rx="5" fill="#1c0f0f"/>
      <rect x="78" y="46" width="10" height="38" rx="5" fill="#1c0f0f"/>
      {/* Neck */}
      <rect x="53" y="82" width="14" height="16" rx="4" fill="#c68642"/>
      {/* Face — warmer skin tone */}
      <ellipse cx="60" cy="63" rx="24" ry="26" fill="#c68642"/>
      {/* Blush */}
      <ellipse cx="41" cy="68" rx="7" ry="4" fill="rgba(200,100,80,0.3)"/>
      <ellipse cx="79" cy="68" rx="7" ry="4" fill="rgba(200,100,80,0.3)"/>
      {/* Eyes — bright and large */}
      <ellipse cx="50" cy="61" rx="5.5" ry="6" fill="#0d0606"/>
      <ellipse cx="70" cy="61" rx="5.5" ry="6" fill="#0d0606"/>
      <circle cx="52" cy="59" r="1.5" fill="white"/>
      <circle cx="72" cy="59" r="1.5" fill="white"/>
      {/* Eyeliner */}
      <path d="M44 58 Q50 55 56 58" stroke="#0d0606" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <path d="M64 58 Q70 55 76 58" stroke="#0d0606" strokeWidth="2" strokeLinecap="round" fill="none"/>
      {/* Eyebrows */}
      <path d="M44 52 Q50 49 56 52" stroke="#1c0f0f" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      <path d="M64 52 Q70 49 76 52" stroke="#1c0f0f" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      {/* Nose */}
      <ellipse cx="60" cy="69" rx="3" ry="2" fill="#a06030"/>
      {/* Lips */}
      <path d="M52 77 Q60 83 68 77" stroke="#b03060" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      <path d="M52 77 Q56 74 60 75.5 Q64 74 68 77" stroke="#b03060" strokeWidth="1.5" fill="none"/>
      {/* Clothing */}
      <path d="M18 120 Q28 96 55 92 Q65 90 65 92 Q92 96 102 120Z" fill="#34d399"/>
      {/* Bun highlight */}
      <ellipse cx="56" cy="13" rx="4" ry="5" fill="rgba(255,255,255,0.12)"/>
    </svg>
  );
}

const AVATAR_SVGS: Record<string, (props: { size: number }) => React.ReactElement> = {
  rashu: RashuSVG,
  tanya: TanyaSVG,
  simmu: SimmuSVG,
};

export default function CharacterAvatar({ character, gesture = 'welcome', size = 120 }: Props) {
  const AvatarSVG = AVATAR_SVGS[character.name];
  const emoji = GESTURES[gesture] ?? '👋';

  return (
    <div className={styles.avatarWrap} style={{ width: size, height: size }}>
      <div className={styles.avatarRing} style={{ '--char-color': character.color } as React.CSSProperties} />
      <div className={styles.avatarImg} style={{ width: size, height: size, background: character.secondaryColor }}>
        {AvatarSVG && <AvatarSVG size={size} />}
      </div>
      <div className={styles.gestureBadge} style={{ background: character.color }}>
        {emoji}
      </div>
    </div>
  );
}
