'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  XCircle, Clock, Copy, Check, Crown,
  Play, Users, Puzzle, Target,
} from 'lucide-react';
import styles from './wp-room.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const MAX_PLAYERS = 8;

// ── Difficulty levels ─────────────────────────────────────────────────────
const DIFFICULTIES = [
  { id: 'easy',   label: 'Easy',   color: '#4ade80', wordCount: 8,  gridLabel: '12×12', desc: 'Short board, quick game' },
  { id: 'medium', label: 'Medium', color: '#fbbf24', wordCount: 14, gridLabel: '17×17', desc: 'Balanced challenge'        },
  { id: 'hard',   label: 'Hard',   color: '#f87171', wordCount: 20, gridLabel: '22×22', desc: 'Large board, test your eyes' },
] as const;

type Difficulty = typeof DIFFICULTIES[number]['id'];

export const WP_PLAYER_COLORS = [
  { id: 0, label: 'Red',    hex: '#f87171' },
  { id: 1, label: 'Blue',   hex: '#60a5fa' },
  { id: 2, label: 'Green',  hex: '#4ade80' },
  { id: 3, label: 'Yellow', hex: '#fbbf24' },
  { id: 4, label: 'Purple', hex: '#a78bfa' },
  { id: 5, label: 'Pink',   hex: '#f472b6' },
  { id: 6, label: 'Teal',   hex: '#34d399' },
  { id: 7, label: 'Orange', hex: '#fb923c' },
];

type Status = 'name_prompt' | 'connecting' | 'lobby' | 'starting' | 'closed';

export default function WPRoomPage() {
  const { code: rawCode } = useParams<{ code: string }>();
  const router = useRouter();

  const isCreateMode = rawCode === 'new';
  const [status, setStatus]           = useState<Status>('name_prompt');
  const [socket, setSocket]           = useState<Socket | null>(null);
  const [username, setUsername]       = useState('');
  const [nameInput, setNameInput]     = useState('');
  const [nameError, setNameError]     = useState(false);
  const [roomCode, setRoomCode]       = useState('');
  const [players, setPlayers]         = useState<string[]>([]);
  const [hostUsername, setHost]       = useState('');
  const [difficulty, setDifficulty]   = useState<Difficulty>('medium');
  const [wordCount, setWordCount]     = useState(14);
  const [roomError, setRoomError]     = useState('');
  const [copied, setCopied]           = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Skip name prompt if username already saved from menu page
  useEffect(() => {
    const saved = sessionStorage.getItem('4inarow_username');
    if (saved && status === 'name_prompt') {
      setUsername(saved);
      setStatus('connecting');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shareableUrl =
    typeof window !== 'undefined' && roomCode
      ? `${window.location.origin}/room/${roomCode}`
      : '';

  const isHost = username === hostUsername;

  // ── Name submit handler ────────────────────────────────────────────────
  const handleNameSubmit = useCallback(() => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameError(true);
      setTimeout(() => setNameError(false), 600);
      return;
    }
    sessionStorage.setItem('4inarow_username', trimmed);
    setUsername(trimmed);
    setStatus('connecting');
  }, [nameInput]);

  // ── Connect once username is set ────────────────────────────────────────
  useEffect(() => {
    if (!username || status !== 'connecting') return;

    // Prevent re-running this effect when status changes later
    const alreadyConnected = socketRef.current?.connected;
    if (alreadyConnected) return;

    const sock = io(API_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = sock;
    setSocket(sock);

    sock.on('connect', () => {
      sock.emit('player:join', { username });
      if (isCreateMode) {
        sock.emit('wp:room:create', { username });
      } else {
        sock.emit('wp:room:join', { username, roomCode: rawCode.toUpperCase() });
      }
    });

    sock.on('wp:room:created', (data: { roomCode: string; hostUsername: string }) => {
      setRoomCode(data.roomCode);
      setHost(data.hostUsername);
      setPlayers([data.hostUsername]);
      setStatus('lobby');
      window.history.replaceState(null, '', `/room/${data.roomCode}`);
    });

    sock.on('wp:room:joinPending', (data: {
      roomCode: string; players: string[]; hostUsername: string; wordCount: number;
    }) => {
      setRoomCode(data.roomCode);
      setPlayers(data.players);
      setHost(data.hostUsername);
      setWordCount(data.wordCount);
      const d = DIFFICULTIES.find((x) => x.wordCount === data.wordCount);
      setDifficulty(d ? d.id : 'medium');
      setStatus('lobby');
    });

    sock.on('wp:room:lobbyUpdate', (data: {
      players: string[]; hostUsername: string; wordCount: number;
    }) => {
      setPlayers(data.players);
      setHost(data.hostUsername);
      setWordCount(data.wordCount);
      const d = DIFFICULTIES.find((x) => x.wordCount === data.wordCount);
      setDifficulty(d ? d.id : 'medium');
    });

    sock.on('wp:game:started', (data: any) => {
      sessionStorage.setItem('wp_pendingGame', JSON.stringify({ ...data, username }));
      setStatus('starting');
      router.push('/');
    });

    sock.on('wp:room:closed', (data: { reason?: string }) => {
      setRoomError(data.reason ?? 'Room was closed');
      setStatus('closed');
    });

    sock.on('wp:room:error', (data: { message: string }) => {
      setRoomError(data.message);
      setStatus('closed');
    });

    return () => { sock.close(); socketRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  const handleLeave = useCallback(() => {
    socket?.emit('wp:room:leave');
    router.push('/');
  }, [socket, router]);

  const handleCopy = () => {
    navigator.clipboard.writeText(shareableUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleStart = useCallback(() => {
    socket?.emit('wp:room:start');
  }, [socket]);

  const handleDifficulty = useCallback((d: Difficulty) => {
    const def = DIFFICULTIES.find((x) => x.id === d)!;
    setDifficulty(d);
    setWordCount(def.wordCount);
    socket?.emit('wp:room:setWordCount', { wordCount: def.wordCount });
  }, [socket]);

  // ── Render: name prompt ─────────────────────────────────────────────
  if (status === 'name_prompt') {
    return (
      <div className={styles.page}>
        <div className={styles.promptCard}>
          <div className={styles.promptIcon}><Puzzle size={28} /></div>
          <h2 className={styles.promptTitle}>
            {isCreateMode ? 'Create Word Search Room' : 'Join Word Search'}
          </h2>
          <p className={styles.promptSub}>
            {isCreateMode
              ? 'Enter your name to create a new room'
              : <>Enter your name to join room <strong>{rawCode.toUpperCase()}</strong></>
            }
          </p>
          <div className={`${styles.nameInputWrap} ${nameError ? styles.nameInputError : ''}`}>
            <input
              className={styles.nameInput}
              type="text"
              placeholder="Your name…"
              maxLength={16}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNameSubmit()}
              autoFocus
            />
          </div>
          {nameError && <p className={styles.nameErrorText}>Please enter a name to continue</p>}
          <button className={styles.btnPrimary} onClick={handleNameSubmit}>
            {isCreateMode ? 'Create Room' : 'Join Room'}
          </button>
        </div>
      </div>
    );
  }

  // ── Render: connecting ─────────────────────────────────────────────────
  if (status === 'connecting') {
    return (
      <div className={styles.page}>
        <div className={styles.promptCard}>
          <div className={styles.spinner} />
          <p className={styles.promptSub}>Connecting…</p>
        </div>
      </div>
    );
  }

  // ── Render: starting ────────────────────────────────────────────────
  if (status === 'starting') {
    return (
      <div className={styles.page}>
        <div className={styles.promptCard}>
          <div className={styles.promptIcon}><Puzzle size={28} /></div>
          <h2 className={styles.promptTitle}>Game Starting!</h2>
          <p className={styles.promptSub}>Loading the word search board…</p>
        </div>
      </div>
    );
  }

  // ── Render: closed ──────────────────────────────────────────────────
  if (status === 'closed') {
    return (
      <div className={styles.page}>
        <div className={styles.promptCard}>
          <div className={styles.promptIcon}><XCircle size={40} /></div>
          <h2 className={styles.promptTitle}>Room unavailable</h2>
          <p className={styles.promptSub}>{roomError}</p>
          <button className={styles.btnPrimary} onClick={() => router.push('/')}>
            Back to Word Puzzle
          </button>
        </div>
      </div>
    );
  }

  // ── Render: lobby ───────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerIcon}>
            <svg width="28" height="28" viewBox="0 0 48 48" fill="none">
              <ellipse cx="24" cy="26" rx="10" ry="12" fill="#fbbf24" />
              <rect x="16" y="22" width="16" height="3" rx="1.5" fill="#1a1a2e" opacity="0.7" />
              <rect x="16" y="28" width="16" height="3" rx="1.5" fill="#1a1a2e" opacity="0.7" />
              <ellipse cx="24" cy="14" rx="6" ry="5" fill="#fbbf24" />
              <circle cx="21" cy="13" r="2" fill="#1a1a2e" />
              <circle cx="27" cy="13" r="2" fill="#1a1a2e" />
              <ellipse cx="16" cy="16" rx="6" ry="3" fill="rgba(108,92,231,0.2)" transform="rotate(-30 16 16)" />
              <ellipse cx="32" cy="16" rx="6" ry="3" fill="rgba(108,92,231,0.2)" transform="rotate(30 32 16)" />
              <path d="M22 10 Q24 6 26 10" stroke="#1a1a2e" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <circle cx="22" cy="7" r="1.5" fill="#fd9644" />
              <circle cx="26" cy="7" r="1.5" fill="#fd9644" />
            </svg>
          </div>
          <div>
            <h1 className={styles.title}>Word Puzzle Bees</h1>
            <p className={styles.subtitle}>
              {isHost ? 'Share the link and start when ready' : `Waiting for ${hostUsername} to start`}
            </p>
          </div>
        </div>

        {/* Room code + copy */}
        <div className={styles.codeRow}>
          <div className={styles.codeBox}>
            <span className={styles.codeLabel}>Room Code</span>
            <span className={styles.codeVal}>{roomCode}</span>
          </div>
          <button className={styles.copyBtn} onClick={handleCopy} title="Copy invite link">
            {copied ? <><Check size={14} />Copied!</> : <><Copy size={14} />Copy Link</>}
          </button>
          <button className={styles.leaveBtn} onClick={handleLeave} title="Leave room">
            Leave
          </button>
        </div>

        {/* Player list */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Users size={14} />
            <span>Players ({players.length}/{MAX_PLAYERS})</span>
          </div>
          <div className={styles.playerGrid}>
            {players.map((p, i) => (
              <div key={p} className={styles.playerSlot}>
                <div
                  className={styles.playerDot}
                  style={{ background: WP_PLAYER_COLORS[i % 8]!.hex }}
                />
                <span className={styles.playerName}>{p}</span>
                {p === hostUsername && (
                  <span className={styles.hostBadge}><Crown size={10} /> Host</span>
                )}
                {p === username && p !== hostUsername && (
                  <span className={styles.youBadge}>You</span>
                )}
              </div>
            ))}
            {Array.from({ length: Math.max(0, 2 - players.length) }).map((_, i) => (
              <div key={`empty-${i}`} className={`${styles.playerSlot} ${styles.playerSlotEmpty}`}>
                <div className={styles.playerDotEmpty} />
                <span className={styles.playerNameEmpty}>Waiting…</span>
              </div>
            ))}
          </div>
        </div>

        {/* Difficulty picker (host only) */}
        {isHost && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <Target size={14} />
              <span>Difficulty</span>
            </div>
            <div className={styles.difficultyGrid}>
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.id}
                  className={`${styles.diffBtn} ${difficulty === d.id ? styles.diffBtnActive : ''}`}
                  onClick={() => handleDifficulty(d.id)}
                >
                  <span className={styles.diffDot} style={{ background: d.color }} />
                  <span className={styles.diffLabel}>{d.label}</span>
                  <span className={styles.diffGrid}>{d.gridLabel}</span>
                  <span className={styles.diffDesc}>{d.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!isHost && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <Target size={14} />
              <span>Difficulty: <strong style={{ color: '#6c5ce7' }}>
                {DIFFICULTIES.find((d) => d.wordCount === wordCount)?.label ?? 'Medium'}
              </strong></span>
            </div>
            <div className={styles.waitingRow}>
              <Clock size={13} />
              <span>Waiting for <strong>{hostUsername}</strong> to start…</span>
            </div>
          </div>
        )}

        {/* Start button */}
        {isHost && (
          <button
            className={styles.btnStart}
            onClick={handleStart}
            disabled={players.length < 2}
          >
            {players.length < 2
              ? 'Need at least 2 players'
              : <><Play size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  Start Game — {DIFFICULTIES.find((d) => d.wordCount === wordCount)?.label ?? 'Medium'} ({players.length} players)
                </>
            }
          </button>
        )}

        {roomError && <p className={styles.errorText}>{roomError}</p>}
      </div>
    </div>
  );
}
