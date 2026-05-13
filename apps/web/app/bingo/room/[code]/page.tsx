'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { Copy, Check, Crown, Play, Users, Home, Grid } from 'lucide-react';
import styles from './bingo-room.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const MAX_PLAYERS = 8;

const PLAYER_COLORS = [
  '#f87171', '#60a5fa', '#4ade80', '#fbbf24',
  '#a78bfa', '#f472b6', '#34d399', '#fb923c',
];

type Status = 'name' | 'connecting' | 'lobby' | 'starting' | 'error';

export default function BingoRoomPage() {
  const { code: rawCode } = useParams<{ code: string }>();
  const router = useRouter();

  const isCreateMode = rawCode === 'new';

  const [status, setStatus]       = useState<Status>('name');
  const [username, setUsername]   = useState('');
  const [nameInput, setNameInput] = useState('');
  const [nameError, setNameError] = useState(false);
  const [roomCode, setRoomCode]   = useState('');
  const [players, setPlayers]     = useState<string[]>([]);
  const [hostUsername, setHost]   = useState('');
  const [roomError, setRoomError] = useState('');
  const [copied, setCopied]       = useState(false);
  const [gridRows, setGridRows]   = useState(5);
  const [gridCols, setGridCols]   = useState(5);

  const socketRef  = useRef<Socket | null>(null);
  const didConnect = useRef(false);

  const isHost = username !== '' && username === hostUsername;

  const shareableUrl =
    typeof window !== 'undefined' && roomCode
      ? `${window.location.origin}/bingo/room/${roomCode}`
      : '';

  useEffect(() => {
    const saved = sessionStorage.getItem('4inarow_username') || '';
    if (saved) setNameInput(saved);
  }, []);

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

  useEffect(() => {
    if (!username || didConnect.current) return;
    didConnect.current = true;

    const sock = io(API_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = sock;

    sock.on('connect', () => {
      sock.emit('player:join', { username });
      if (isCreateMode) {
        sock.emit('bingo:room:create', { username, gridRows, gridCols });
      } else {
        const code = String(rawCode).toUpperCase().trim();
        sock.emit('bingo:room:join', { username, roomCode: code });
      }
    });

    sock.on('bingo:room:created', (data: { roomCode: string; hostUsername: string; gridRows: number; gridCols: number }) => {
      setRoomCode(data.roomCode);
      setHost(data.hostUsername);
      setPlayers([data.hostUsername]);
      setGridRows(data.gridRows);
      setGridCols(data.gridCols);
      setStatus('lobby');
    });

    sock.on('bingo:room:joinPending', (data: {
      roomCode: string;
      players: string[];
      hostUsername: string;
      gridRows: number;
      gridCols: number;
    }) => {
      setRoomCode(data.roomCode);
      setHost(data.hostUsername);
      setPlayers(data.players);
      setGridRows(data.gridRows ?? 5);
      setGridCols(data.gridCols ?? 5);
      setStatus('lobby');
    });

    sock.on('bingo:room:lobbyUpdate', (data: {
      players: string[];
      hostUsername: string;
      gridRows?: number;
      gridCols?: number;
    }) => {
      setPlayers(data.players);
      setHost(data.hostUsername);
      if (data.gridRows) setGridRows(data.gridRows);
      if (data.gridCols) setGridCols(data.gridCols);
    });

    sock.on('bingo:game:started', (data: unknown) => {
      setStatus('starting');
      sessionStorage.setItem('bingo_pending_game', JSON.stringify(data));
      router.push('/bingo');
    });

    sock.on('bingo:room:error', (data: { message: string }) => {
      setRoomError(data.message);
      setStatus('error');
    });

    sock.on('bingo:room:closed', () => {
      setRoomError('The host closed the room.');
      setStatus('error');
    });

    sock.on('connect_error', () => {
      setRoomError('Could not connect to server.');
      setStatus('error');
    });

    return () => { sock.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  const handleStart = useCallback(() => {
    socketRef.current?.emit('bingo:room:start');
  }, []);

  const handleGridChange = useCallback((rows: number, cols: number) => {
    const r = Math.max(3, Math.min(10, rows));
    const c = Math.max(3, Math.min(10, cols));
    setGridRows(r);
    setGridCols(c);
    socketRef.current?.emit('bingo:room:setGrid', { gridRows: r, gridCols: c });
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(shareableUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [shareableUrl]);

  const handleLeave = useCallback(() => {
    socketRef.current?.emit('bingo:room:leave');
    router.push('/bingo');
  }, [router]);

  if (status === 'name') {
    return (
      <div className={styles.namePage}>
        <div className={styles.nameCard}>
          <div className={styles.nameIcon}>🎱</div>
          <h1 className={styles.nameTitle}>Bingo</h1>
          <p className={styles.nameSubtitle}>
            {isCreateMode ? 'Create a room and invite friends' : `Join room ${String(rawCode).toUpperCase()}`}
          </p>
          <div className={`${styles.nameInputWrap} ${nameError ? styles.shake : ''}`}>
            <input
              className={styles.nameInput}
              type="text"
              placeholder="Enter your name..."
              value={nameInput}
              maxLength={20}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNameSubmit()}
              autoFocus
            />
          </div>
          <button className={styles.nameBtn} onClick={handleNameSubmit}>
            {isCreateMode ? 'Create Room' : 'Join Room'}
          </button>
        </div>
      </div>
    );
  }

  if (status === 'connecting') {
    return (
      <div className={styles.namePage}>
        <div className={styles.nameCard}>
          <div className={styles.spinner} />
          <p className={styles.connectingText}>Connecting...</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={styles.namePage}>
        <div className={styles.nameCard}>
          <div className={styles.errorIcon}>⚠️</div>
          <p className={styles.errorText}>{roomError}</p>
          <button className={styles.nameBtn} onClick={() => router.push('/bingo')}>
            Back to Bingo
          </button>
        </div>
      </div>
    );
  }

  if (status === 'starting') {
    return (
      <div className={styles.namePage}>
        <div className={styles.nameCard}>
          <div className={styles.spinner} />
          <p className={styles.connectingText}>Starting game...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.lobby}>
        {/* Header */}
        <div className={styles.header}>
          <button className={styles.homeBtn} onClick={() => router.push('/')}>
            <Home size={16} />
          </button>
          <h1 className={styles.title}>🎱 Bingo Room</h1>
          <button className={styles.leaveBtn} onClick={handleLeave}>Leave</button>
        </div>

        {/* Room code */}
        <div className={styles.codeSection}>
          <p className={styles.codeLabel}>Room Code</p>
          <div className={styles.codeRow}>
            <span className={styles.code}>{roomCode}</span>
            <button className={styles.copyBtn} onClick={handleCopy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
          </div>
          <p className={styles.codeHint}>Share this code with friends to invite them</p>
        </div>

        {/* Grid size (host only) */}
        {isHost && (
          <div className={styles.gridSection}>
            <div className={styles.sectionHeader}>
              <Grid size={16} />
              <span>Grid Size (host sets)</span>
            </div>
            <div className={styles.gridControls}>
              {[
                { label: '5×5', rows: 5, cols: 5 },
                { label: '6×6', rows: 6, cols: 6 },
                { label: '7×7', rows: 7, cols: 7 },
                { label: '8×8', rows: 8, cols: 8 },
              ].map((opt) => (
                <button
                  key={opt.label}
                  className={`${styles.gridBtn} ${gridRows === opt.rows && gridCols === opt.cols ? styles.gridBtnActive : ''}`}
                  onClick={() => handleGridChange(opt.rows, opt.cols)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className={styles.gridHint}>
              Each player fills {gridRows * gridCols} numbers (1–{gridRows * gridCols}) in their own grid
            </p>
          </div>
        )}
        {!isHost && (
          <div className={styles.gridSection}>
            <p className={styles.gridInfo}>
              Grid: <strong>{gridRows}×{gridCols}</strong> — fill {gridRows * gridCols} numbers (1–{gridRows * gridCols})
            </p>
          </div>
        )}

        {/* Players */}
        <div className={styles.playersSection}>
          <div className={styles.sectionHeader}>
            <Users size={16} />
            <span>Players ({players.length}/{MAX_PLAYERS})</span>
          </div>
          <div className={styles.playerList}>
            {players.map((p, i) => (
              <div key={p} className={styles.playerRow}>
                <div
                  className={styles.playerAvatar}
                  style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }}
                >
                  {p[0]?.toUpperCase()}
                </div>
                <span className={styles.playerName}>{p}</span>
                {p === hostUsername && (
                  <span className={styles.hostBadge}>
                    <Crown size={12} /> Host
                  </span>
                )}
              </div>
            ))}
            {players.length < MAX_PLAYERS && (
              <div className={styles.waitingRow}>
                <div className={styles.waitingDots}>
                  <span /><span /><span />
                </div>
                <span className={styles.waitingLabel}>
                  Waiting for players to join… (up to {MAX_PLAYERS} total)
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Info */}
        <div className={styles.infoBox}>
          <p>📝 Fill your own grid with numbers when game starts</p>
          <p>🔄 Players take turns calling — the called number appears for all</p>
          <p>✅ Tap your cell to mark the called number</p>
          <p>🏆 First to complete 5 lines wins BINGO!</p>
        </div>

        {/* Start button (host only) */}
        {isHost && (
          <button
            className={styles.startBtn}
            onClick={handleStart}
            disabled={players.length < 2}
          >
            <Play size={18} />
            Start Game ({players.length} players)
          </button>
        )}
        {!isHost && (
          <p className={styles.waitingText}>Waiting for the host to start the game...</p>
        )}
      </div>
    </div>
  );
}
