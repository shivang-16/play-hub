'use client';

import {
  useEffect, useState, useRef, useCallback,
  type CSSProperties,
} from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { MessageSquare, Home as HomeIcon, Users, Trophy, Phone, Mic, MicOff, Volume2 } from 'lucide-react';
import styles from './dab.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

// ── Constants ─────────────────────────────────────────────────────────────
const PLAYER_COLORS = [
  '#f87171', '#60a5fa', '#4ade80', '#fbbf24',
  '#a78bfa', '#f472b6', '#34d399', '#fb923c',
];

const GRID_PRESETS = [
  { label: '3×8',   rows: 3,  cols: 8  },
  { label: '4×4',   rows: 4,  cols: 4  },
  { label: '6×6',   rows: 6,  cols: 6  },
  { label: '8×8',   rows: 8,  cols: 8  },
  { label: '10×10', rows: 10, cols: 10 },
];

const RANK_MEDAL = ['🥇', '🥈', '🥉'];

// ── Types ─────────────────────────────────────────────────────────────────
type LineOwner = number | null;
type Phase = 'menu' | 'grid' | 'matchmaking' | 'playing' | 'ended';
type GameMode = 'solo' | 'quick' | 'friend';

interface GameState {
  gameId: string;
  players: string[];
  gridRows: number;
  gridCols: number;
  hLines: LineOwner[][];
  vLines: LineOwner[][];
  boxes: LineOwner[][];
  scores: number[];
  currentTurn: number;
  currentPlayer: string;
  yourIndex: number;
  yourUsername: string;
}

interface ChatMessage {
  username: string;
  message: string;
  timestamp: number;
}

interface RankEntry {
  username: string;
  score: number;
  rank: number;
}

// ── Bot AI ────────────────────────────────────────────────────────────────
function getBotMove(
  hLines: LineOwner[][],
  vLines: LineOwner[][],
  boxes: LineOwner[][]
): { type: 'h' | 'v'; r: number; c: number } | null {
  const rows = boxes.length;
  const cols = boxes[0]!.length;

  const countSides = (r: number, c: number): number => {
    let s = 0;
    if (hLines[r]![c] !== null) s++;
    if (hLines[r + 1]![c] !== null) s++;
    if (vLines[r]![c] !== null) s++;
    if (vLines[r]![c + 1] !== null) s++;
    return s;
  };

  const affectedBoxes = (type: 'h' | 'v', r: number, c: number): [number, number][] => {
    const out: [number, number][] = [];
    if (type === 'h') {
      if (r < rows) out.push([r, c]);
      if (r > 0) out.push([r - 1, c]);
    } else {
      if (c < cols) out.push([r, c]);
      if (c > 0) out.push([r, c - 1]);
    }
    return out.filter(([br, bc]) => boxes[br]![bc] === null);
  };

  // All valid moves
  const moves: { type: 'h' | 'v'; r: number; c: number }[] = [];
  for (let r = 0; r <= rows; r++)
    for (let c = 0; c < cols; c++)
      if (hLines[r]![c] === null) moves.push({ type: 'h', r, c });
  for (let r = 0; r < rows; r++)
    for (let c = 0; c <= cols; c++)
      if (vLines[r]![c] === null) moves.push({ type: 'v', r, c });

  if (moves.length === 0) return null;

  // 1. Complete a box if possible
  const completing = moves.filter((m) =>
    affectedBoxes(m.type, m.r, m.c).some(([br, bc]) => countSides(br, bc) === 3)
  );
  if (completing.length > 0) return completing[Math.floor(Math.random() * completing.length)]!;

  // 2. Avoid creating 3-sided boxes
  const safe = moves.filter((m) =>
    !affectedBoxes(m.type, m.r, m.c).some(([br, bc]) => countSides(br, bc) === 2)
  );
  if (safe.length > 0) return safe[Math.floor(Math.random() * safe.length)]!;

  // 3. Forced — open the smallest chain (pick random)
  return moves[Math.floor(Math.random() * moves.length)]!;
}

// ── Apply move (local) ────────────────────────────────────────────────────
function applyMove(
  state: GameState,
  type: 'h' | 'v',
  row: number,
  col: number,
  playerIdx: number
): GameState {
  const { rows: gr, cols: gc } = { rows: state.gridRows, cols: state.gridCols };
  const newH = state.hLines.map((r) => [...r]);
  const newV = state.vLines.map((r) => [...r]);
  const newBoxes = state.boxes.map((r) => [...r]);
  const newScores = [...state.scores];

  if (type === 'h') newH[row]![col] = playerIdx;
  else newV[row]![col] = playerIdx;

  const toCheck: [number, number][] = [];
  if (type === 'h') {
    if (row < gr) toCheck.push([row, col]);
    if (row > 0) toCheck.push([row - 1, col]);
  } else {
    if (col < gc) toCheck.push([row, col]);
    if (col > 0) toCheck.push([row, col - 1]);
  }

  let completed = 0;
  for (const [br, bc] of toCheck) {
    if (
      newBoxes[br]![bc] === null &&
      newH[br]![bc] !== null &&
      newH[br + 1]![bc] !== null &&
      newV[br]![bc] !== null &&
      newV[br]![bc + 1] !== null
    ) {
      newBoxes[br]![bc] = playerIdx;
      if (newScores[playerIdx] !== undefined) newScores[playerIdx]++;
      completed++;
    }
  }

  const nextTurn =
    completed > 0 ? playerIdx : (playerIdx + 1) % state.players.length;

  return {
    ...state,
    hLines: newH,
    vLines: newV,
    boxes: newBoxes,
    scores: newScores,
    currentTurn: nextTurn,
    currentPlayer: state.players[nextTurn]!,
  };
}

function isGameOver(state: GameState): boolean {
  return state.boxes.every((row) => row.every((b) => b !== null));
}

function computeRankings(state: GameState): RankEntry[] {
  return state.players
    .map((username, idx) => ({ username, score: state.scores[idx] ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .map((p, i, arr) => ({
      ...p,
      rank: i === 0 ? 1 : arr[i - 1]!.score === p.score ? arr[i - 1]!.score === arr[0]!.score ? 1 : i + 1 : i + 1,
    }));
}

// ── Component ─────────────────────────────────────────────────────────────
export default function DotsAndBoxesPage() {
  const router = useRouter();

  const [phase, setPhase]               = useState<Phase>('menu');
  const [gameMode, setGameMode]         = useState<GameMode>('solo');
  const [username, setUsername]         = useState('');
  const [nameInput, setNameInput]       = useState('');
  const [nameShake, setNameShake]       = useState(false);
  const [nameLocked, setNameLocked]     = useState(false);
  const [selectedRows, setSelectedRows] = useState(5);
  const [selectedCols, setSelectedCols] = useState(5);
  const [customRows, setCustomRows]     = useState(5);
  const [customCols, setCustomCols]     = useState(5);
  const [customMode, setCustomMode]     = useState(false);
  const [gameState, setGameState]       = useState<GameState | null>(null);
  const [rankings, setRankings]         = useState<RankEntry[]>([]);
  const [winner, setWinner]             = useState<string | null>(null);
  const [socket, setSocket]             = useState<Socket | null>(null);
  const [hoverLine, setHoverLine]       = useState<{ type: 'h' | 'v'; r: number; c: number } | null>(null);
  const [botThinking, setBotThinking]   = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]       = useState('');
  const [chatOpen, setChatOpen]         = useState(false);
  const [unreadCount, setUnreadCount]   = useState(0);
  const [rematchVotes, setRematchVotes] = useState(0);
  const [rematchNeeded, setRematchNeeded] = useState(0);
  const [rematchVoted, setRematchVoted] = useState(false);
  const [errorMsg, setErrorMsg]         = useState('');

  // ── Call state ────────────────────────────────────────────────────────────
  const [callRoomActive, setCallRoomActive]       = useState(false);
  const [callRoomInitiator, setCallRoomInitiator] = useState<string | null>(null);
  const [callMembers, setCallMembers]             = useState<string[]>([]);
  const [amInCall, setAmInCall]                   = useState(false);
  const [isMuted, setIsMuted]                     = useState(false);
  const [mutedUsers, setMutedUsers]               = useState<Set<string>>(new Set());
  const [speakingUsers, setSpeakingUsers]         = useState<Set<string>>(new Set());
  const [callTimerDisplay, setCallTimerDisplay]   = useState('0:00');
  const [callStartedAt, setCallStartedAt]         = useState<number | null>(null);

  const socketRef    = useRef<Socket | null>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const chatEndRef   = useRef<HTMLDivElement>(null);
  const botBusyRef   = useRef(false);
  // Always-fresh username ref — eliminates stale-closure bugs in callbacks
  const usernameRef  = useRef(username);

  // ── Call refs ─────────────────────────────────────────────────────────────
  const localStreamRef       = useRef<MediaStream | null>(null);
  const peerConnectionsRef   = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const callGameIdRef        = useRef<string | null>(null);
  const speakingStopFnsRef   = useRef<Map<string, () => void>>(new Map());
  // Always-fresh chatOpen ref — eliminates stale-closure in chat listener
  const chatOpenRef  = useRef(chatOpen);
  // Guard: prevent the pending-game effect from double-running (React dev double-invoke)
  const pendingGameHandled = useRef(false);

  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { usernameRef.current  = username;   }, [username]);
  useEffect(() => { chatOpenRef.current  = chatOpen;   }, [chatOpen]);

  // ── Preload saved name ────────────────────────────────────────────────
  useEffect(() => {
    const saved = sessionStorage.getItem('4inarow_username') || '';
    if (saved) setNameInput(saved);
  }, []);

  // ── Check for pending game (from room lobby) ──────────────────────────
  useEffect(() => {
    // Guard prevents React dev-mode double-invoke from creating two sockets
    if (pendingGameHandled.current) return;

    const pending = sessionStorage.getItem('dab_pending_game');
    if (!pending) return;

    pendingGameHandled.current = true;
    sessionStorage.removeItem('dab_pending_game');

    try {
      const data: GameState = JSON.parse(pending);
      const savedName = data.yourUsername;
      setUsername(savedName);
      setNameInput(savedName);
      setNameLocked(true);
      setGameMode('friend');

      // Connect to the server with the new game-page socket and rejoin the game room
      const sock = io(API_URL, { transports: ['websocket', 'polling'] });
      socketRef.current = sock;
      setSocket(sock);

      sock.on('connect', () => {
        sock.emit('player:join', { username: savedName });
        sock.emit('dab:rejoin', { gameId: data.gameId, username: savedName });
      });

      sock.on('dab:rejoined', () => {
        // Server confirmed we're back in the game room — nothing needed, just confirmation
      });

      sock.on('connect_error', () => {
        setErrorMsg('Could not reconnect to the game. Please try again.');
        setPhase('menu');
      });

      setGameState(data);
      setPhase('playing');
      setupSocketListeners(sock, data.gameId);
    } catch {
      pendingGameHandled.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Name confirm ─────────────────────────────────────────────────────────
  const confirmName = useCallback(() => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameShake(true);
      setTimeout(() => setNameShake(false), 500);
      return false;
    }
    sessionStorage.setItem('4inarow_username', trimmed);
    setUsername(trimmed);
    setNameLocked(true);
    return trimmed;
  }, [nameInput]);

  // ── Mode selection ────────────────────────────────────────────────────────
  const handleModeSelect = useCallback(
    (mode: GameMode) => {
      const name = confirmName();
      if (!name) return;
      setGameMode(mode);
      if (mode === 'friend') {
        router.push('/dots-and-boxes/room/new');
        return;
      }
      setPhase('grid');
    },
    [confirmName, router]
  );

  // ── Grid confirm ──────────────────────────────────────────────────────────
  const handleGridConfirm = useCallback(() => {
    const rows = customMode ? Math.max(2, Math.min(15, customRows)) : selectedRows;
    const cols = customMode ? Math.max(2, Math.min(15, customCols)) : selectedCols;
    setSelectedRows(rows);
    setSelectedCols(cols);

    if (gameMode === 'solo') {
      startSoloGame(rows, cols);
    } else {
      startQuickMatch(rows, cols);
    }
  }, [customMode, customRows, customCols, selectedRows, selectedCols, gameMode]);

  // ── Start solo game ───────────────────────────────────────────────────────
  const startSoloGame = useCallback((rows: number, cols: number) => {
    const name = username;
    const botName = '🤖 Dot Bot';
    const initH: LineOwner[][] = Array.from({ length: rows + 1 }, () => new Array(cols).fill(null));
    const initV: LineOwner[][] = Array.from({ length: rows }, () => new Array(cols + 1).fill(null));
    const initBoxes: LineOwner[][] = Array.from({ length: rows }, () => new Array(cols).fill(null));

    const gs: GameState = {
      gameId: 'solo',
      players: [name, botName],
      gridRows: rows,
      gridCols: cols,
      hLines: initH,
      vLines: initV,
      boxes: initBoxes,
      scores: [0, 0],
      currentTurn: 0,
      currentPlayer: name,
      yourIndex: 0,
      yourUsername: name,
    };
    setGameState(gs);
    setPhase('playing');
  }, [username]);

  // ── Bot turn effect ───────────────────────────────────────────────────────
  // botBusyRef (not botThinking state) is the guard so that the timer is
  // never accidentally cancelled by a re-run caused by the state update.
  useEffect(() => {
    if (phase !== 'playing' || !gameState) return;
    if (gameState.gameId !== 'solo') return;
    if (gameState.currentTurn !== 1) return; // bot is player index 1
    if (isGameOver(gameState)) return;
    if (botBusyRef.current) return;

    botBusyRef.current = true;
    setBotThinking(true);

    const delay = 400 + Math.random() * 350;
    const timer = setTimeout(() => {
      const move = getBotMove(gameState.hLines, gameState.vLines, gameState.boxes);
      if (move) {
        const newState = applyMove(gameState, move.type, move.r, move.c, 1);
        setGameState(newState);
        if (isGameOver(newState)) {
          setRankings(computeRankings(newState));
          setWinner(
            newState.scores[0]! > newState.scores[1]! ? newState.yourUsername
              : newState.scores[0]! === newState.scores[1]! ? 'tie'
              : '🤖 Dot Bot'
          );
          setPhase('ended');
        }
      }
      botBusyRef.current = false;
      setBotThinking(false);
    }, delay);

    return () => {
      clearTimeout(timer);
      botBusyRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, gameState]); // intentionally no botThinking — guard is the ref

  // ── Start quick match ────────────────────────────────────────────────────
  const startQuickMatch = useCallback(
    (rows: number, cols: number) => {
      // Always read the latest username from the ref to avoid stale-closure bugs.
      const currentUsername = usernameRef.current;
      setPhase('matchmaking');
      const sock = io(API_URL, { transports: ['websocket', 'polling'] });
      socketRef.current = sock;
      setSocket(sock);

      sock.on('connect', () => {
        sock.emit('player:join', { username: currentUsername });
        sock.emit('dab:queue:join', { username: currentUsername, gridRows: rows, gridCols: cols });
      });

      sock.on('dab:queue:queued', () => {
        // queued — wait for match
      });

      sock.on('dab:game:started', (data: GameState) => {
        setGameState(data);
        setPhase('playing');
        setupSocketListeners(sock, data.gameId);
      });

      sock.on('connect_error', () => {
        setErrorMsg('Could not connect to server. Please try again.');
        setPhase('menu');
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ── Call timer ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!callStartedAt) return;
    const id = setInterval(() => {
      const s = Math.floor((Date.now() - callStartedAt) / 1000);
      setCallTimerDisplay(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(id);
  }, [callStartedAt]);

  // ── WebRTC helpers ────────────────────────────────────────────────────────
  const STUN: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  const startSpeakDetection = useCallback((user: string, stream: MediaStream) => {
    speakingStopFnsRef.current.get(user)?.();
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = 0.3;
      src.connect(an);
      const data = new Uint8Array(an.frequencyBinCount);
      let speaking = false;
      const tick = () => {
        an.getByteFrequencyData(data);
        const rms = data.reduce((s, v) => s + v, 0) / data.length;
        const now = rms > 18;
        if (now !== speaking) {
          speaking = now;
          setSpeakingUsers((p) => { const n = new Set(p); now ? n.add(user) : n.delete(user); return n; });
        }
      };
      const iv = setInterval(tick, 80);
      const stop = () => {
        clearInterval(iv);
        ctx.close().catch(() => {});
        setSpeakingUsers((p) => { const n = new Set(p); n.delete(user); return n; });
      };
      speakingStopFnsRef.current.set(user, stop);
    } catch {}
  }, []);

  const flushCandidates = useCallback(async (remoteUser: string) => {
    const pc = peerConnectionsRef.current.get(remoteUser);
    const q = pendingCandidatesRef.current.get(remoteUser) ?? [];
    pendingCandidatesRef.current.set(remoteUser, []);
    for (const c of q) { try { await pc?.addIceCandidate(new RTCIceCandidate(c)); } catch {} }
  }, []);

  const getOrCreatePC = useCallback((remoteUser: string, gid: string, sock: Socket): RTCPeerConnection => {
    if (peerConnectionsRef.current.has(remoteUser)) return peerConnectionsRef.current.get(remoteUser)!;
    const pc = new RTCPeerConnection(STUN);
    pc.ontrack = (ev) => {
      const rs = ev.streams[0] ?? new MediaStream([ev.track]);
      const audio = document.createElement('audio');
      audio.srcObject = rs; audio.autoplay = true; audio.play().catch(() => {});
      document.body.appendChild(audio);
      startSpeakDetection(remoteUser, rs);
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
          audio.pause(); audio.srcObject = null; audio.remove();
          speakingStopFnsRef.current.get(remoteUser)?.();
          speakingStopFnsRef.current.delete(remoteUser);
        }
      });
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) sock.emit('call:ice', { to: remoteUser, candidate: ev.candidate.toJSON(), gameId: gid });
    };
    peerConnectionsRef.current.set(remoteUser, pc);
    pendingCandidatesRef.current.set(remoteUser, []);
    return pc;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSpeakDetection]);

  // ── Call actions ──────────────────────────────────────────────────────────
  const cleanupCall = useCallback(() => {
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    callGameIdRef.current = null;
    speakingStopFnsRef.current.forEach((s) => s());
    speakingStopFnsRef.current.clear();
    setSpeakingUsers(new Set());
    setMutedUsers(new Set());
    setCallRoomActive(false); setCallRoomInitiator(null); setCallMembers([]);
    setAmInCall(false); setIsMuted(false); setCallStartedAt(null); setCallTimerDisplay('0:00');
  }, []);

  const handleStartCall = useCallback(async () => {
    const sock = socketRef.current;
    const gid = gameStateRef.current?.gameId;
    if (!sock || !gid) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      callGameIdRef.current = gid;
      startSpeakDetection(usernameRef.current, stream);
      sock.emit('call:start', { gameId: gid });
      sock.emit('call:join', { gameId: gid });
      setCallRoomInitiator(usernameRef.current);
      setCallMembers([usernameRef.current]);
      setCallRoomActive(true);
      setAmInCall(true);
      setCallStartedAt(Date.now());
    } catch {
      /* mic permission denied */
    }
  }, [startSpeakDetection]);

  const handleJoinCall = useCallback(async () => {
    const sock = socketRef.current;
    const gid = gameStateRef.current?.gameId;
    if (!sock || !gid) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      callGameIdRef.current = gid;
      startSpeakDetection(usernameRef.current, stream);
      sock.emit('call:join', { gameId: gid });
      setAmInCall(true);
      if (!callStartedAt) setCallStartedAt(Date.now());
    } catch {
      /* mic permission denied */
    }
  }, [startSpeakDetection, callStartedAt]);

  const handleLeaveCall = useCallback(() => {
    const sock = socketRef.current;
    if (!sock || !callGameIdRef.current) return;
    sock.emit('call:leave', { gameId: callGameIdRef.current });
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    callGameIdRef.current = null;
    speakingStopFnsRef.current.forEach((s) => s());
    speakingStopFnsRef.current.clear();
    setSpeakingUsers(new Set());
    setMutedUsers(new Set());
    setAmInCall(false); setIsMuted(false);
    setCallMembers((prev) => {
      const next = prev.filter((u) => u !== usernameRef.current);
      if (next.length === 0) { setCallRoomActive(false); setCallRoomInitiator(null); setCallStartedAt(null); setCallTimerDisplay('0:00'); }
      return next;
    });
  }, []);

  const handleToggleMute = useCallback(() => {
    const sock = socketRef.current;
    const gid = callGameIdRef.current;
    if (!localStreamRef.current || !sock || !gid) return;
    const muted = !isMuted;
    localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    setIsMuted(muted);
    sock.emit('call:mute', { gameId: gid, muted });
  }, [isMuted]);

  // ── Socket listeners ─────────────────────────────────────────────────────
  // Uses refs (usernameRef, chatOpenRef) so this never needs to be recreated.
  const setupSocketListeners = useCallback(
    (sock: Socket, gameId: string) => {
      sock.on('dab:move:made', (data: {
        gameId: string;
        hLines: LineOwner[][];
        vLines: LineOwner[][];
        boxes: LineOwner[][];
        scores: number[];
        currentTurn: number;
        currentPlayer: string;
        boxesCompleted: number;
        lastMove: { playerIdx: number; type: 'h' | 'v'; row: number; col: number };
      }) => {
        if (data.gameId !== gameId) return;
        setGameState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            hLines: data.hLines,
            vLines: data.vLines,
            boxes: data.boxes,
            scores: data.scores,
            currentTurn: data.currentTurn,
            currentPlayer: data.currentPlayer,
          };
        });
      });

      sock.on('dab:game:ended', (data: {
        gameId: string;
        scores: number[];
        players: string[];
        winner: string | null;
        rankings: RankEntry[];
        partyId?: string;
      }) => {
        if (data.gameId !== gameId) return;
        setRankings(data.rankings);
        setWinner(data.winner);
        setRematchNeeded(data.players.length);
        setPhase('ended');
      });

      sock.on('dab:rematch:progress', (data: { votes: number; needed: number }) => {
        setRematchVotes(data.votes);
        setRematchNeeded(data.needed);
      });

      sock.on('dab:rematch:error', () => {
        setRematchVotes(0);
        setRematchVoted(false);
      });

      sock.on('dab:game:started', (data: GameState) => {
        setGameState(data);
        setRankings([]);
        setWinner(null);
        setRematchVotes(0);
        setRematchVoted(false);
        setPhase('playing');
      });

      sock.on('dab:chat:message', (msg: ChatMessage) => {
        setChatMessages((prev) => [...prev, msg]);
        if (!chatOpenRef.current) setUnreadCount((n) => n + 1);
      });

      // ── Call signaling ─────────────────────────────────────────────────
      sock.on('call:ringing', (data: { from: string; gameId: string }) => {
        setCallRoomInitiator(data.from);
        setCallRoomActive(true);
        setCallMembers((prev) => prev.includes(data.from) ? prev : [...prev, data.from]);
      });

      sock.on('call:members', (data: { members: string[]; gameId: string }) => {
        setCallMembers((prev) => {
          const merged = new Set([...prev, ...data.members]);
          return [...merged];
        });
        if (data.members.length > 0 && !callStartedAt) setCallStartedAt(Date.now());
      });

      sock.on('call:peer_joined', async (data: { username: string; gameId: string }) => {
        const stream = localStreamRef.current;
        if (!stream) return;
        const pc = getOrCreatePC(data.username, data.gameId, sock);
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sock.emit('call:offer', { to: data.username, offer, gameId: data.gameId });
        setCallMembers((prev) => prev.includes(data.username) ? prev : [...prev, data.username]);
      });

      sock.on('call:offer', async (data: { from: string; offer: RTCSessionDescriptionInit; gameId: string }) => {
        const stream = localStreamRef.current;
        if (!stream) return;
        const pc = getOrCreatePC(data.from, data.gameId, sock);
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        await flushCandidates(data.from);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sock.emit('call:answer', { to: data.from, answer, gameId: data.gameId });
      });

      sock.on('call:answer', async (data: { from: string; answer: RTCSessionDescriptionInit }) => {
        const pc = peerConnectionsRef.current.get(data.from);
        if (pc && pc.signalingState !== 'stable') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          await flushCandidates(data.from);
        }
      });

      sock.on('call:ice', async (data: { from: string; candidate: RTCIceCandidateInit }) => {
        const pc = peerConnectionsRef.current.get(data.from);
        if (pc?.remoteDescription) {
          try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
        } else {
          const q = pendingCandidatesRef.current.get(data.from) ?? [];
          q.push(data.candidate);
          pendingCandidatesRef.current.set(data.from, q);
        }
      });

      sock.on('call:peer_left', (data: { username: string }) => {
        peerConnectionsRef.current.get(data.username)?.close();
        peerConnectionsRef.current.delete(data.username);
        pendingCandidatesRef.current.delete(data.username);
        speakingStopFnsRef.current.get(data.username)?.();
        speakingStopFnsRef.current.delete(data.username);
        setSpeakingUsers((p) => { const n = new Set(p); n.delete(data.username); return n; });
        setMutedUsers((p) => { const n = new Set(p); n.delete(data.username); return n; });
        setCallMembers((prev) => {
          const next = prev.filter((u) => u !== data.username);
          if (next.length === 0) {
            setCallRoomActive(false); setCallRoomInitiator(null);
            setAmInCall(false); setCallStartedAt(null); setCallTimerDisplay('0:00');
          }
          return next;
        });
      });

      sock.on('call:mute', (data: { username: string; muted: boolean }) => {
        setMutedUsers((prev) => {
          const next = new Set(prev);
          data.muted ? next.add(data.username) : next.delete(data.username);
          return next;
        });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ── Player move (multiplayer) ─────────────────────────────────────────────
  const handleMultiMove = useCallback(
    (type: 'h' | 'v', r: number, c: number) => {
      const sock = socketRef.current;
      if (!gameState || !sock) return;
      if (gameState.currentTurn !== gameState.yourIndex) return;
      const line = type === 'h' ? gameState.hLines[r]![c] : gameState.vLines[r]![c];
      if (line !== null) return;

      sock.emit('dab:move', {
        gameId: gameState.gameId,
        type,
        row: r,
        col: c,
      });
    },
    [gameState]
  );

  // ── Player move (solo) ────────────────────────────────────────────────────
  const handleSoloMove = useCallback(
    (type: 'h' | 'v', r: number, c: number) => {
      if (!gameState || gameState.gameId !== 'solo') return;
      if (gameState.currentTurn !== 0) return; // human is player 0
      const line = type === 'h' ? gameState.hLines[r]![c] : gameState.vLines[r]![c];
      if (line !== null) return;

      const newState = applyMove(gameState, type, r, c, 0);
      setGameState(newState);
      if (isGameOver(newState)) {
        const rk = computeRankings(newState);
        setRankings(rk);
        setWinner(
          newState.scores[0]! > newState.scores[1]! ? newState.yourUsername
            : newState.scores[0]! === newState.scores[1]! ? 'tie'
            : '🤖 Dot Bot'
        );
        setPhase('ended');
      }
    },
    [gameState]
  );

  const handleMove = useCallback(
    (type: 'h' | 'v', r: number, c: number) => {
      if (!gameState) return;
      if (gameState.gameId === 'solo') handleSoloMove(type, r, c);
      else handleMultiMove(type, r, c);
    },
    [gameState, handleSoloMove, handleMultiMove]
  );

  // ── Rematch ───────────────────────────────────────────────────────────────
  const handleRematch = useCallback(() => {
    const sock = socketRef.current;
    if (!gameState || !sock) return;
    setRematchVoted(true);
    sock.emit('dab:rematch:vote', { gameId: gameState.gameId });
  }, [gameState]);

  // ── Chat ──────────────────────────────────────────────────────────────────
  const handleChatSend = useCallback(() => {
    const msg = chatInput.trim();
    const sock = socketRef.current;
    if (!msg || !sock || !gameState) return;
    sock.emit('dab:chat', { gameId: gameState.gameId, message: msg });
    setChatInput('');
  }, [chatInput, gameState]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    if (chatOpen) setUnreadCount(0);
  }, [chatOpen]);

  // ── Board rendering ───────────────────────────────────────────────────────
  const renderBoard = useCallback(() => {
    if (!gameState) return null;

    const { gridRows, gridCols, hLines, vLines, boxes, currentTurn, yourIndex, gameId } = gameState;
    const isSolo = gameId === 'solo';
    const isMyTurn = isSolo ? currentTurn === 0 : currentTurn === yourIndex;

    // Compute cell size based on viewport
    const vpW = typeof window !== 'undefined' ? window.innerWidth : 800;
    const vpH = typeof window !== 'undefined' ? window.innerHeight : 600;
    const sidebarW = vpW < 720 ? 0 : 200;
    const chatW = vpW < 720 ? 0 : 70;
    const avW = vpW - sidebarW - chatW - 32;
    const avH = vpH - (vpW < 720 ? 160 : 180);
    const margin = 22;
    const cellByW = Math.floor((avW - margin * 2) / gridCols);
    const cellByH = Math.floor((avH - margin * 2) / gridRows);
    const cell = Math.max(24, Math.min(72, Math.min(cellByW, cellByH)));

    const svgW = margin * 2 + gridCols * cell;
    const svgH = margin * 2 + gridRows * cell;
    const dotR = Math.max(4, Math.min(7, cell * 0.1));
    const lineW = Math.max(2, Math.min(5, cell * 0.07));
    const hitW = Math.max(18, cell * 0.38); // click target width

    const myColor = PLAYER_COLORS[isSolo ? 0 : yourIndex] ?? '#f87171';

    return (
      <svg
        className={styles.boardSvg}
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={{ cursor: isMyTurn ? 'pointer' : 'default' }}
      >
        <defs>
          {/* Cylinder shading for horizontal sticks: top=bright, bottom=dark (same hue) */}
          <linearGradient id="stickShadingH" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"   stopColor="white" stopOpacity="0.55" />
            <stop offset="30%"  stopColor="white" stopOpacity="0.10" />
            <stop offset="65%"  stopColor="black" stopOpacity="0.00" />
            <stop offset="100%" stopColor="black" stopOpacity="0.45" />
          </linearGradient>
          {/* Cylinder shading for vertical sticks: left=bright, right=dark */}
          <linearGradient id="stickShadingV" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="white" stopOpacity="0.55" />
            <stop offset="30%"  stopColor="white" stopOpacity="0.10" />
            <stop offset="65%"  stopColor="black" stopOpacity="0.00" />
            <stop offset="100%" stopColor="black" stopOpacity="0.45" />
          </linearGradient>
          {/* Box gradient overlay — top-left bright, bottom-right dark */}
          <linearGradient id="boxGrad3d" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="white" stopOpacity="0.30" />
            <stop offset="45%"  stopColor="white" stopOpacity="0.02" />
            <stop offset="100%" stopColor="black" stopOpacity="0.30" />
          </linearGradient>
          {/* Dot radial gradient — shiny dark sphere on light board */}
          <radialGradient id="dotGrad" cx="32%" cy="30%" r="68%">
            <stop offset="0%"   stopColor="rgba(255,255,255,0.95)" />
            <stop offset="38%"  stopColor="rgba(205, 180, 246, 0.8)" />
            <stop offset="100%" stopColor="rgba(50,20,100,0.95)" />
          </radialGradient>
          {/* Hollow cell inset shadow — dark top-left, lighter bottom-right */}
          <linearGradient id="cellInset" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#555566" stopOpacity="0.30" />
            <stop offset="45%"  stopColor="#555566" stopOpacity="0.04" />
            <stop offset="100%" stopColor="white"   stopOpacity="0.20" />
          </linearGradient>
          {/* Board surface gradient — purplish grey */}
          <linearGradient id="boardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"   stopColor="#ddd8ee" />
            <stop offset="100%" stopColor="#cdc6e0" />
          </linearGradient>
        </defs>

        {/* Board surface — grey-white background */}
        <rect x={0} y={0} width={svgW} height={svgH}
          rx={14} ry={14}
          fill="url(#boardGrad)"
        />

        {/* Empty cell backgrounds — hollow recessed look */}
        {Array.from({ length: gridRows }, (_, r) =>
          Array.from({ length: gridCols }, (_, c) => {
            if (boxes[r]![c] !== null) return null;
            const bx = margin + c * cell + 2;
            const by = margin + r * cell + 2;
            const cw = cell - 4;
            const ch = cell - 4;
            return (
              <g key={`cbg-${r}-${c}`}>
                {/* base cell — slightly darker than board to create depth */}
                <rect x={bx} y={by} width={cw} height={ch} rx={4}
                  fill="#b8b0d0"
                />
                {/* inset shadow overlay */}
                <rect x={bx} y={by} width={cw} height={ch} rx={4}
                  fill="url(#cellInset)"
                />
                {/* inner surface — the "floor" of the hollow */}
                <rect x={bx + 2} y={by + 2} width={cw - 4} height={ch - 4} rx={3}
                  fill="#cec8e2"
                />
              </g>
            );
          })
        )}

        {/* Box fills — colored base + 3D gradient overlay */}
        {boxes.map((rowArr, r) =>
          rowArr.map((owner, c) => {
            if (owner === null) return null;
            const bx = margin + c * cell;
            const by = margin + r * cell;
            return (
              <g key={`bf-${r}-${c}`}>
                <rect x={bx} y={by} width={cell} height={cell}
                  fill={PLAYER_COLORS[owner] ?? '#888'}
                  className={styles.boxFill}
                />
                <rect x={bx} y={by} width={cell} height={cell}
                  fill="url(#boxGrad3d)"
                  className={styles.boxFill}
                />
              </g>
            );
          })
        )}

        {/* Horizontal lines */}
        {hLines.map((rowArr, r) =>
          rowArr.map((owner, c) => {
            const x1 = margin + c * cell;
            const x2 = margin + (c + 1) * cell;
            const y  = margin + r * cell;
            const isHover =
              hoverLine?.type === 'h' && hoverLine.r === r && hoverLine.c === c;
            const color = PLAYER_COLORS[owner ?? -1] ?? '#888';
            return (
              <g key={`hl-${r}-${c}`}>
                {owner !== null ? (
                  /* Wooden stick — rounded rect base color + cylinder shading overlay */
                  <>
                    <rect
                      x={x1} y={y - (lineW + 2) / 2}
                      width={x2 - x1} height={lineW + 2}
                      rx={(lineW + 2) / 2}
                      fill={color}
                      className={styles.lineDrawn}
                    />
                    <rect
                      x={x1} y={y - (lineW + 2) / 2}
                      width={x2 - x1} height={lineW + 2}
                      rx={(lineW + 2) / 2}
                      fill="url(#stickShadingH)"
                      style={{ pointerEvents: 'none' }}
                    />
                  </>
                ) : isHover && isMyTurn ? (
                  <rect
                    x={x1} y={y - lineW / 2}
                    width={x2 - x1} height={lineW}
                    rx={lineW / 2}
                    fill={myColor}
                    className={styles.lineHover}
                  />
                ) : (
                  <line x1={x1} y1={y} x2={x2} y2={y}
                    strokeWidth={lineW - 1} stroke="rgba(80,60,120,0.25)"
                    className={styles.lineEmpty} />
                )}
                {owner === null && (
                  <rect
                    x={x1 + 5} y={y - hitW / 2}
                    width={cell - 10} height={hitW}
                    fill="transparent"
                    className={styles.lineHit}
                    onMouseEnter={() => isMyTurn && setHoverLine({ type: 'h', r, c })}
                    onMouseLeave={() => setHoverLine(null)}
                    onClick={() => handleMove('h', r, c)}
                    onTouchEnd={(e) => { e.preventDefault(); handleMove('h', r, c); }}
                    style={{ cursor: isMyTurn ? 'pointer' : 'default' }}
                  />
                )}
              </g>
            );
          })
        )}

        {/* Vertical lines */}
        {vLines.map((rowArr, r) =>
          rowArr.map((owner, c) => {
            const x  = margin + c * cell;
            const y1 = margin + r * cell;
            const y2 = margin + (r + 1) * cell;
            const isHover =
              hoverLine?.type === 'v' && hoverLine.r === r && hoverLine.c === c;
            const color = PLAYER_COLORS[owner ?? -1] ?? '#888';
            return (
              <g key={`vl-${r}-${c}`}>
                {owner !== null ? (
                  /* Wooden stick — rounded rect base color + cylinder shading overlay */
                  <>
                    <rect
                      x={x - (lineW + 2) / 2} y={y1}
                      width={lineW + 2} height={y2 - y1}
                      rx={(lineW + 2) / 2}
                      fill={color}
                      className={styles.lineDrawn}
                    />
                    <rect
                      x={x - (lineW + 2) / 2} y={y1}
                      width={lineW + 2} height={y2 - y1}
                      rx={(lineW + 2) / 2}
                      fill="url(#stickShadingV)"
                      style={{ pointerEvents: 'none' }}
                    />
                  </>
                ) : isHover && isMyTurn ? (
                  <rect
                    x={x - lineW / 2} y={y1}
                    width={lineW} height={y2 - y1}
                    rx={lineW / 2}
                    fill={myColor}
                    className={styles.lineHover}
                  />
                ) : (
                  <line x1={x} y1={y1} x2={x} y2={y2}
                    strokeWidth={lineW - 1} stroke="rgba(80,60,120,0.25)"
                    className={styles.lineEmpty} />
                )}
                {owner === null && (
                  <rect
                    x={x - hitW / 2} y={y1 + 5}
                    width={hitW} height={cell - 10}
                    fill="transparent"
                    className={styles.lineHit}
                    onMouseEnter={() => isMyTurn && setHoverLine({ type: 'v', r, c })}
                    onMouseLeave={() => setHoverLine(null)}
                    onClick={() => handleMove('v', r, c)}
                    onTouchEnd={(e) => { e.preventDefault(); handleMove('v', r, c); }}
                    style={{ cursor: isMyTurn ? 'pointer' : 'default' }}
                  />
                )}
              </g>
            );
          })
        )}

        {/* Dots — shiny sphere via radial gradient */}
        {Array.from({ length: gridRows + 1 }, (_, r) =>
          Array.from({ length: gridCols + 1 }, (_, c) => (
            <circle
              key={`d-${r}-${c}`}
              cx={margin + c * cell}
              cy={margin + r * cell}
              r={dotR}
              fill="url(#dotGrad)"
              className={styles.dot}
            />
          ))
        )}
      </svg>
    );
  }, [gameState, hoverLine, handleMove]);

  // Socket cleanup is handled explicitly in each leave/home button handler.
  // A useEffect cleanup here would fire during React dev-mode double-invoke,
  // disconnecting the socket before the user ever makes a move.

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════

  // ── Menu ──────────────────────────────────────────────────────────────────
  if (phase === 'menu') {
    return (
      <div className={styles.container}>
        <div className={styles.menuWrap}>
          <div className={styles.menuCard}>
            <h1 className={styles.gameTitle}>Dots &amp; Boxes</h1>
            <p className={styles.gameTagline}>Draw lines. Claim boxes. Outsmart everyone.</p>

            {errorMsg && <p className={styles.errorText}>{errorMsg}</p>}

            {!nameLocked ? (
              <input
                className={`${styles.input} ${nameShake ? styles.inputShake : ''}`}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleModeSelect('solo')}
                placeholder="Your name…"
                maxLength={18}
                autoFocus
              />
            ) : (
              <p style={{ color: '#c084fc', fontSize: '1rem' }}>
                Playing as <strong style={{ color: '#e0aaff' }}>{username}</strong>
                <button
                  onClick={() => { setNameLocked(false); }}
                  style={{ marginLeft: 8, background: 'none', border: 'none', color: '#9a8abf', cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'inherit' }}
                >
                  (change)
                </button>
              </p>
            )}

            <div className={styles.modeGroup}>
              <button className={`${styles.btn} ${styles.btnGold}`} onClick={() => handleModeSelect('solo')}>
                🤖 Solo vs Bot
              </button>
              <button className={`${styles.btn} ${styles.btnPurple}`} onClick={() => handleModeSelect('quick')}>
                <Users size={18} /> Quick Match
              </button>
              <button className={`${styles.btn} ${styles.btnGreen}`} onClick={() => handleModeSelect('friend')}>
                🔗 Play with Friends
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Grid selection ────────────────────────────────────────────────────────
  if (phase === 'grid') {
    return (
      <div className={styles.container}>
        <div className={styles.menuWrap}>
          <div className={styles.menuCard}>
            <h1 className={styles.gameTitle}>Choose Grid</h1>
            <p className={styles.gameTagline}>Pick a grid size for your game</p>

            <div className={styles.gridSelectWrap}>
              <p className={styles.sectionTitle}>Grid size (rows × cols of boxes)</p>
              <div className={styles.gridChips}>
                {GRID_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    className={`${styles.gridChip} ${
                      !customMode && preset.rows === selectedRows && preset.cols === selectedCols
                        ? styles.gridChipActive
                        : ''
                    }`}
                    onClick={() => {
                      setSelectedRows(preset.rows);
                      setSelectedCols(preset.cols);
                      setCustomMode(false);
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  className={`${styles.gridChip} ${customMode ? styles.gridChipActive : ''}`}
                  onClick={() => setCustomMode(true)}
                >
                  Custom
                </button>
              </div>

              {customMode && (
                <div className={styles.customInputRow}>
                  <input
                    type="number"
                    className={styles.customInput}
                    value={customRows}
                    min={2} max={15}
                    onChange={(e) => setCustomRows(Number(e.target.value))}
                  />
                  <span className={styles.customLabel}>×</span>
                  <input
                    type="number"
                    className={styles.customInput}
                    value={customCols}
                    min={2} max={15}
                    onChange={(e) => setCustomCols(Number(e.target.value))}
                  />
                </div>
              )}
            </div>

            <button className={`${styles.btn} ${styles.btnPurple}`} onClick={handleGridConfirm}>
              {gameMode === 'solo' ? '🤖 Start vs Bot' : '🔍 Find Match'}
            </button>
            <button
              className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`}
              onClick={() => setPhase('menu')}
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Matchmaking ───────────────────────────────────────────────────────────
  if (phase === 'matchmaking') {
    return (
      <div className={styles.container}>
        <div className={styles.menuWrap}>
          <div className={styles.menuCard}>
            <h1 className={styles.gameTitle}>Finding Match</h1>
            <div className={styles.waitScreen}>
              <div className={styles.spinner} />
              <p className={styles.waitTitle}>Searching for Opponents</p>
              <p className={styles.waitSub}>
                Grid: {selectedRows}×{selectedCols} · Waiting for players…
              </p>
              <button
                className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`}
                onClick={() => {
                  socketRef.current?.emit('dab:queue:leave');
                  socketRef.current?.disconnect();
                  setSocket(null);
                  setPhase('menu');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Playing ───────────────────────────────────────────────────────────────
  if (phase === 'playing' && gameState) {
    const isSolo = gameState.gameId === 'solo';
    const isMyTurn = isSolo
      ? gameState.currentTurn === 0
      : gameState.currentTurn === gameState.yourIndex;
    const currentColor = PLAYER_COLORS[gameState.currentTurn] ?? '#fff';

    return (
      <div className={styles.container}>
        <div className={styles.gameLayout}>
          {/* Sidebar */}
          <aside className={styles.sidebar}>
            <p className={styles.sidebarTitle}>Scores</p>
            <div className={styles.scoreList}>
              {gameState.players.map((p, i) => (
                <div
                  key={p}
                  className={`${styles.scoreRow} ${gameState.currentTurn === i ? styles.scoreRowActive : ''} ${speakingUsers.has(p) ? styles.scoreRowSpeaking : mutedUsers.has(p) ? styles.scoreRowMuted : ''}`}
                >
                  <span
                    className={styles.scoreSwatch}
                    style={{ background: PLAYER_COLORS[i] ?? '#888' }}
                  />
                  <span className={styles.scoreName}>{p}</span>
                  <span className={styles.scoreVal}>{gameState.scores[i] ?? 0}</span>
                  {speakingUsers.has(p) && <span className={styles.speakingIcon}><Volume2 size={13} /></span>}
                  {mutedUsers.has(p) && !speakingUsers.has(p) && <span className={styles.mutedIcon}><MicOff size={13} /></span>}
                  {gameState.currentTurn === i && <span className={styles.turnArrow}>▶</span>}
                </div>
              ))}
            </div>

            <div className={styles.divider} />
          </aside>

          {/* Main board area */}
          <main className={styles.mainArea}>
            {/* Status */}
            <div className={styles.statusBanner}>
              <span
                className={styles.turnDot}
                style={{ background: currentColor, color: currentColor }}
              />
              <span className={styles.statusText}>
                {isMyTurn
                  ? isSolo
                    ? 'Your turn — draw a line!'
                    : `Your turn (${gameState.yourUsername})`
                  : isSolo
                  ? botThinking
                    ? '🤖 Bot is thinking…'
                    : '🤖 Bot\'s turn'
                  : `${gameState.currentPlayer}'s turn`}
              </span>
            </div>

            {/* Board */}
            <div className={styles.boardOuter}>
              {renderBoard()}
            </div>
          </main>

          {/* Chat + Call (multiplayer only) */}
          {!isSolo && (
            <div className={`${styles.chatPanel} ${chatOpen ? styles.chatOpen : ''}`}>
              <div className={styles.chatHeader}>
                <span>
                  Chat
                  {callMembers.length > 0 && (
                    <span className={styles.chatCallIndicator}>
                      <Mic size={10} /> {callMembers.length} in call
                    </span>
                  )}
                </span>
                <button
                  style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1.2rem' }}
                  onClick={() => setChatOpen(false)}
                >
                  ✕
                </button>
              </div>
              <div className={styles.chatMessages}>
                {chatMessages.map((m, i) => (
                  <div key={i} className={styles.chatMsg}>
                    <strong>{m.username}</strong>{m.message}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className={styles.chatInputRow}>
                <input
                  className={styles.chatInputField}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleChatSend()}
                  placeholder="Say something…"
                  maxLength={200}
                />
                <button className={styles.chatSendBtn} onClick={handleChatSend}>Send</button>
              </div>

              {/* Chat toggle */}
              <button
                className={styles.chatToggle}
                onClick={() => setChatOpen((o) => !o)}
              >
                {unreadCount > 0 && (
                  <span className={styles.unreadBadge}>{unreadCount}</span>
                )}
                <MessageSquare size={16} />
              </button>

              {/* Call tab button — sits below the chat toggle */}
              <button
                className={`${styles.callTabBtn} ${callRoomActive ? styles.callTabBtnDisabled : ''}`}
                onClick={callRoomActive ? undefined : handleStartCall}
                disabled={callRoomActive}
                title={callRoomActive ? 'Call already in progress' : 'Start voice call'}
              >
                <span className={styles.callTabBtnInner}>
                  <Phone size={18} />
                  {callRoomActive && <span className={styles.callTabBtnCross}>✕</span>}
                </span>
              </button>
            </div>
          )}

          {/* Floating call bar */}
          {callRoomActive && !isSolo && (
            <div className={`${styles.callFloatingBar} ${amInCall ? styles.callFloatingBarActive : ''}`}>
              <span className={styles.callFloatingIcon}><Mic size={18} /></span>
              <div className={styles.callFloatingInfo}>
                <span className={styles.callFloatingLabel}>
                  {amInCall ? 'In call' : `${callRoomInitiator} started a call`}
                  {callMembers.map((m) => (
                    <span
                      key={m}
                      className={`${styles.callFloatingMember} ${speakingUsers.has(m) ? styles.callFloatingMemberSpeaking : ''}`}
                    >
                      {m}
                    </span>
                  ))}
                </span>
                {amInCall && <span className={styles.callFloatingTimer}>{callTimerDisplay}</span>}
              </div>
              <div className={styles.callFloatingActions}>
                {!amInCall ? (
                  <button className={`${styles.callFloatBtn} ${styles.callFloatBtnJoin}`} onClick={handleJoinCall}>
                    Join
                    {callMembers.length > 0 && (
                      <span className={styles.callMemberCount}>{callMembers.length}</span>
                    )}
                  </button>
                ) : (
                  <>
                    <button
                      className={`${styles.callFloatBtn} ${isMuted ? styles.callFloatBtnMuted : ''}`}
                      onClick={handleToggleMute}
                      title={isMuted ? 'Unmute' : 'Mute'}
                    >
                      {isMuted ? <MicOff size={15} /> : <Mic size={15} />}
                    </button>
                    <button className={`${styles.callFloatBtn} ${styles.callFloatBtnLeave}`} onClick={handleLeaveCall}>
                      Leave
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Ended ─────────────────────────────────────────────────────────────────
  if (phase === 'ended') {
    const isSolo = gameState?.gameId === 'solo';
    const winnerLabel =
      winner === 'tie'
        ? "It's a Tie! 🤝"
        : winner === gameState?.yourUsername
        ? '🎉 You Win!'
        : `${winner} Wins!`;

    return (
      <div className={styles.container}>
        <div className={styles.menuWrap}>
          <div className={styles.endScreen}>
            <h1 className={styles.endTitle}>
              {winner === 'tie' ? "🤝 Tie!" : winner === gameState?.yourUsername ? '🏆 Victory!' : '🎮 Game Over'}
            </h1>
            <p className={styles.endSubtitle}>{winnerLabel}</p>

            <div className={styles.rankList}>
              {rankings.map((entry, i) => (
                <div key={entry.username} className={styles.rankRow}>
                  <span className={styles.rankNum}>{RANK_MEDAL[i] ?? `#${entry.rank}`}</span>
                  <span
                    className={styles.rankSwatch}
                    style={{
                      background: PLAYER_COLORS[gameState?.players.indexOf(entry.username) ?? 0] ?? '#888',
                    }}
                  />
                  <span className={styles.rankName}>{entry.username}</span>
                  <span className={styles.rankScore}>{entry.score} boxes</span>
                </div>
              ))}
            </div>

            {!isSolo && rematchNeeded > 0 && (
              <p className={styles.rematchProgress}>
                {rematchVoted
                  ? `Rematch: ${rematchVotes}/${rematchNeeded} voted ✓`
                  : `Vote to rematch (${rematchVotes}/${rematchNeeded})`}
              </p>
            )}

            <div className={styles.endActions}>
              {isSolo ? (
                <button
                  className={`${styles.btn} ${styles.btnGold}`}
                  onClick={() => {
                    if (gameState) startSoloGame(gameState.gridRows, gameState.gridCols);
                  }}
                >
                  🔄 Play Again
                </button>
              ) : !rematchVoted ? (
                <button
                  className={`${styles.btn} ${styles.btnPurple}`}
                  onClick={handleRematch}
                >
                  🔄 Rematch
                </button>
              ) : null}

              <button
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={() => {
                  cleanupCall();
                  socketRef.current?.disconnect();
                  setSocket(null);
                  setGameState(null);
                  setRankings([]);
                  setWinner(null);
                  setRematchVoted(false);
                  setRematchVotes(0);
                  setPhase('menu');
                }}
              >
                <HomeIcon size={16} /> Home
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
