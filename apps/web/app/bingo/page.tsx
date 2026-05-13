'use client';

import {
  useEffect, useState, useRef, useCallback,
  type CSSProperties,
} from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  Home as HomeIcon, MessageSquare, Phone, Mic, MicOff, Users,
} from 'lucide-react';
import styles from './bingo.module.css';
import GameGuide from '../../components/GameGuide';
import WinCelebration from '../../components/WinCelebration';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

const PLAYER_COLORS = [
  '#f87171', '#60a5fa', '#4ade80', '#fbbf24',
  '#a78bfa', '#f472b6', '#34d399', '#fb923c',
];

// ── Types ──────────────────────────────────────────────────────────────────
type Phase = 'menu' | 'matchmaking' | 'filling' | 'playing' | 'ended';
type GameMode = 'bot' | 'quick' | 'friend';

interface PlayerInfo {
  username: string;
  colorIndex: number;
  markedCells?: boolean[][];
  bingoLines?: number;
  rank?: number | null;
}

interface GameData {
  gameId: string;
  gridRows: number;
  gridCols: number;
  players: PlayerInfo[];
  yourUsername: string;
  yourColorIndex: number;
  isBot: boolean;
  botUsername: string | null;
  status: 'filling' | 'playing';
  currentCallerUsername: string;
}

interface ChatMessage {
  username: string;
  message: string;
  timestamp: number;
}

interface RankEntry {
  username: string;
  rank: number;
}

const RANK_MEDAL = ['🥇', '🥈', '🥉'];
const WIN_LINES = 5;

// ── Component ──────────────────────────────────────────────────────────────
export default function BingoPage() {
  const router = useRouter();

  const [phase, setPhase]               = useState<Phase>('menu');
  const [gameMode, setGameMode]         = useState<GameMode>('bot');
  const [username, setUsername]         = useState('');
  const [nameInput, setNameInput]       = useState('');
  const [nameShake, setNameShake]       = useState(false);
  const [nameLocked, setNameLocked]     = useState(false);
  const [errorMsg, setErrorMsg]         = useState('');

  // Game state
  const [gameData, setGameData]         = useState<GameData | null>(null);
  const [gridRows, setGridRows]         = useState(5);
  const [gridCols, setGridCols]         = useState(5);
  const [players, setPlayers]           = useState<PlayerInfo[]>([]);
  const [myCard, setMyCard]             = useState<(number | null)[][]>([]);
  const [myMarked, setMyMarked]         = useState<boolean[][]>([]);
  const [calledNumbers, setCalledNumbers] = useState<number[]>([]);
  const [currentCall, setCurrentCall]   = useState<number | null>(null);
  const [currentCaller, setCurrentCaller] = useState('');
  const [rankings, setRankings]         = useState<RankEntry[]>([]);
  const [winner, setWinner]             = useState<string | null>(null);
  const [callAnim, setCallAnim]         = useState(false);
  const [callBlockMsg, setCallBlockMsg] = useState('');

  // Card filling phase
  const [submittedPlayers, setSubmittedPlayers] = useState<Set<string>>(new Set());
  const [cardSubmitted, setCardSubmitted]       = useState(false);
  const [fillError, setFillError]               = useState('');
  const [fillInput, setFillInput]               = useState<string[][]>([]);


  // Celebrations
  const [showGuide, setShowGuide]               = useState(false);
  const [showCelebration, setShowCelebration]   = useState(false);
  const [newBingoUsername, setNewBingoUsername] = useState<string | null>(null);
  const celebrationShownRef = useRef(false);

  // Rematch
  const [rematchVotes, setRematchVotes] = useState(0);
  const [rematchNeeded, setRematchNeeded] = useState(0);
  const [rematchVoted, setRematchVoted] = useState(false);

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]       = useState('');
  const [chatOpen, setChatOpen]         = useState(false);
  const [unreadCount, setUnreadCount]   = useState(0);

  // Call (voice)
  const [callRoomActive, setCallRoomActive]       = useState(false);
  const [callMembers, setCallMembers]             = useState<string[]>([]);
  const [amInCall, setAmInCall]                   = useState(false);
  const [isMuted, setIsMuted]                     = useState(false);
  const [mutedUsers, setMutedUsers]               = useState<Set<string>>(new Set());
  const [speakingUsers, setSpeakingUsers]         = useState<Set<string>>(new Set());
  const [callTimerDisplay, setCallTimerDisplay]   = useState('0:00');
  const [callStartedAt, setCallStartedAt]         = useState<number | null>(null);

  const socketRef    = useRef<Socket | null>(null);
  const gameDataRef  = useRef<GameData | null>(null);
  const chatEndRef   = useRef<HTMLDivElement>(null);
  const usernameRef  = useRef(username);
  const chatOpenRef  = useRef(chatOpen);
  const pendingHandled = useRef(false);

  const localStreamRef       = useRef<MediaStream | null>(null);
  const peerConnectionsRef   = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const callGameIdRef        = useRef<string | null>(null);
  const speakingStopFnsRef   = useRef<Map<string, () => void>>(new Map());

  useEffect(() => { gameDataRef.current = gameData; }, [gameData]);
  useEffect(() => { usernameRef.current = username; }, [username]);
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);

  useEffect(() => {
    const saved = sessionStorage.getItem('4inarow_username') || '';
    if (saved) setNameInput(saved);
  }, []);

  // ── Call timer ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!callStartedAt) return;
    const id = setInterval(() => {
      const s = Math.floor((Date.now() - callStartedAt) / 1000);
      setCallTimerDisplay(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(id);
  }, [callStartedAt]);

  // ── Scroll chat ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatOpen]);

  // ── Number call animation ──────────────────────────────────────────────────
  useEffect(() => {
    if (currentCall === null) return;
    setCallAnim(true);
    const t = setTimeout(() => setCallAnim(false), 1000);
    return () => clearTimeout(t);
  }, [currentCall]);


  // ── Init card grid for filling ────────────────────────────────────────────
  const initFillGrid = useCallback((rows: number, cols: number) => {
    setFillInput(Array.from({ length: rows }, () => new Array(cols).fill('')));
    setMyCard(Array.from({ length: rows }, () => new Array(cols).fill(null)));
    setMyMarked(Array.from({ length: rows }, () => new Array(cols).fill(false)));
  }, []);

  // ── Apply game data on start ──────────────────────────────────────────────
  const applyGameStart = useCallback((data: GameData) => {
    setGameData(data);
    setGridRows(data.gridRows);
    setGridCols(data.gridCols);
    setPlayers(data.players);
    setCurrentCaller(data.currentCallerUsername);
    setCalledNumbers([]);
    setCurrentCall(null);
    setCardSubmitted(false);
    setSubmittedPlayers(new Set());
    setFillError('');
    celebrationShownRef.current = false;
    initFillGrid(data.gridRows, data.gridCols);
    setPhase('filling');
  }, [initFillGrid]);

  // ── WebRTC helpers ────────────────────────────────────────────────────────
  const stopSpeakingDetection = useCallback((peerId: string) => {
    const stop = speakingStopFnsRef.current.get(peerId);
    if (stop) { stop(); speakingStopFnsRef.current.delete(peerId); }
  }, []);

  const startSpeakingDetection = useCallback((peerId: string, stream: MediaStream) => {
    stopSpeakingDetection(peerId);
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let speaking = false;
      const interval = setInterval(() => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        if (avg > 15 && !speaking) {
          speaking = true;
          setSpeakingUsers((p) => new Set([...p, peerId]));
        } else if (avg <= 15 && speaking) {
          speaking = false;
          setSpeakingUsers((p) => { const n = new Set(p); n.delete(peerId); return n; });
        }
      }, 150);
      speakingStopFnsRef.current.set(peerId, () => { clearInterval(interval); ctx.close(); });
    } catch { /* ignore */ }
  }, [stopSpeakingDetection]);

  const createPeerConnection = useCallback((peerId: string, sock: Socket, gameId: string) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    localStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!));
    pc.onicecandidate = (e) => {
      if (e.candidate) sock.emit('call:ice', { gameId, to: peerId, candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      startSpeakingDetection(peerId, stream);
      let audio = document.getElementById(`audio-${peerId}`) as HTMLAudioElement | null;
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = `audio-${peerId}`;
        audio.autoplay = true;
        document.body.appendChild(audio);
      }
      audio.srcObject = stream;
    };
    peerConnectionsRef.current.set(peerId, pc);
    return pc;
  }, [startSpeakingDetection]);

  const cleanupCall = useCallback(() => {
    peerConnectionsRef.current.forEach((pc, id) => {
      stopSpeakingDetection(id);
      pc.close();
    });
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    document.querySelectorAll('audio[id^="audio-"]').forEach((el) => el.remove());
    setAmInCall(false);
    setIsMuted(false);
    setCallStartedAt(null);
    setSpeakingUsers(new Set());
    callGameIdRef.current = null;
  }, [stopSpeakingDetection]);

  // ── Socket listeners ──────────────────────────────────────────────────────
  const setupSocketListeners = useCallback((sock: Socket) => {
    // Card filling phase
    sock.on('bingo:card:submitted', (data: { username: string }) => {
      setSubmittedPlayers((p) => new Set([...p, data.username]));
    });

    sock.on('bingo:card:accepted', () => {
      setCardSubmitted(true);
      setFillError('');
    });

    sock.on('bingo:card:error', (data: { message: string }) => {
      setFillError(data.message);
    });

    sock.on('bingo:game:filling:complete', (data: { gameId: string; currentCallerUsername: string }) => {
      setCurrentCaller(data.currentCallerUsername);
      setPhase('playing');
    });

    // Gameplay
    sock.on('bingo:number:called', (data: {
      gameId: string;
      calledNumber: number;
      calledNumbers: number[];
      nextCallerUsername: string;
      players: PlayerInfo[];
      remaining: number;
    }) => {
      setCurrentCall(data.calledNumber);
      setCalledNumbers(data.calledNumbers);
      setCurrentCaller(data.nextCallerUsername);
      setPlayers(data.players);
      setCallBlockMsg('');
    });

    sock.on('bingo:mark:error', (data: { message: string }) => {
      setFillError(data.message);
      setTimeout(() => setFillError(''), 3000);
    });

    sock.on('bingo:error', (data: { message: string }) => {
      setCallBlockMsg(data.message);
      setTimeout(() => setCallBlockMsg(''), 4000);
    });

    sock.on('bingo:cell:marked', (data: {
      username: string;
      row: number;
      col: number;
      bingoLines: number;
      winReached: boolean;
      players: PlayerInfo[];
    }) => {
      setPlayers(data.players);
      if (data.username === usernameRef.current) {
        setMyMarked((prev) => {
          const next = prev.map((r) => [...r]);
          if (next[data.row]) next[data.row]![data.col] = true;
          return next;
        });
      }
    });

    sock.on('bingo:player:bingo', (data: { username: string; totalLines: number; rankings: RankEntry[] }) => {
      setRankings(data.rankings);
      setNewBingoUsername(data.username);
      if (data.username === usernameRef.current && !celebrationShownRef.current) {
        celebrationShownRef.current = true;
        setShowCelebration(true);
      }
      setTimeout(() => setNewBingoUsername(null), 3000);
    });

    sock.on('bingo:game:ended', (data: { winner: string | null; rankings: RankEntry[] }) => {
      setWinner(data.winner);
      setRankings(data.rankings);
      setPhase('ended');
      if (data.winner === usernameRef.current && !celebrationShownRef.current) {
        celebrationShownRef.current = true;
        setShowCelebration(true);
      }
    });

    sock.on('bingo:rematch:progress', (data: { votes: number; needed: number }) => {
      setRematchVotes(data.votes);
      setRematchNeeded(data.needed);
    });

    sock.on('bingo:game:started', (data: GameData) => {
      celebrationShownRef.current = false;
      setRematchVoted(false);
      setRematchVotes(0);
      setChatMessages([]);
      applyGameStart(data);
    });

    sock.on('bingo:chat:message', (msg: ChatMessage) => {
      setChatMessages((p) => [...p, msg]);
      if (!chatOpenRef.current) setUnreadCount((n) => n + 1);
    });

    // Voice call events (same pattern as all other games)
    sock.on('call:started', (data: { gameId: string; initiator: string; members: string[] }) => {
      setCallRoomActive(true);
      setCallMembers(data.members);
      callGameIdRef.current = data.gameId;
    });

    sock.on('call:peer_joined', (data: { username: string; members: string[] }) => {
      setCallMembers(data.members);
    });

    sock.on('call:peer_left', (data: { username: string; members: string[] }) => {
      setCallMembers(data.members);
      const pc = peerConnectionsRef.current.get(data.username);
      if (pc) { pc.close(); peerConnectionsRef.current.delete(data.username); }
      stopSpeakingDetection(data.username);
      const audio = document.getElementById(`audio-${data.username}`);
      if (audio) audio.remove();
      if (data.members.length <= 1) {
        setCallRoomActive(false);
        cleanupCall();
      }
    });

    sock.on('call:ended', () => {
      setCallRoomActive(false);
      cleanupCall();
    });

    sock.on('call:offer', async (data: { from: string; offer: RTCSessionDescriptionInit; gameId: string }) => {
      if (!localStreamRef.current) return;
      const pc = createPeerConnection(data.from, sock, data.gameId);
      await pc.setRemoteDescription(data.offer);
      const pending = pendingCandidatesRef.current.get(data.from) ?? [];
      for (const c of pending) await pc.addIceCandidate(c);
      pendingCandidatesRef.current.delete(data.from);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sock.emit('call:answer', { gameId: data.gameId, to: data.from, answer });
    });

    sock.on('call:answer', async (data: { from: string; answer: RTCSessionDescriptionInit }) => {
      const pc = peerConnectionsRef.current.get(data.from);
      if (pc) await pc.setRemoteDescription(data.answer);
    });

    sock.on('call:ice', async (data: { from: string; candidate: RTCIceCandidateInit }) => {
      const pc = peerConnectionsRef.current.get(data.from);
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(data.candidate);
      } else {
        const arr = pendingCandidatesRef.current.get(data.from) ?? [];
        arr.push(data.candidate);
        pendingCandidatesRef.current.set(data.from, arr);
      }
    });

    sock.on('call:mute', (data: { username: string; muted: boolean }) => {
      setMutedUsers((p) => {
        const n = new Set(p);
        if (data.muted) n.add(data.username); else n.delete(data.username);
        return n;
      });
    });
  }, [applyGameStart, cleanupCall, createPeerConnection, stopSpeakingDetection]);

  // ── Name confirm ──────────────────────────────────────────────────────────
  const confirmName = useCallback(() => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameShake(true);
      setTimeout(() => setNameShake(false), 600);
      return;
    }
    sessionStorage.setItem('4inarow_username', trimmed);
    setUsername(trimmed);
    setNameLocked(true);
  }, [nameInput]);

  // ── Mode select → connect socket ──────────────────────────────────────────
  const handleModeSelect = useCallback((mode: GameMode) => {
    const name = username.trim();
    if (!name) {
      setNameShake(true);
      setTimeout(() => setNameShake(false), 600);
      return;
    }
    setGameMode(mode);

    if (mode === 'friend') {
      router.push('/bingo/room/new');
      return;
    }

    const sock = io(API_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = sock;
    setupSocketListeners(sock);

    sock.on('connect', () => {
      sock.emit('player:join', { username: name });
      if (mode === 'bot') {
        sock.emit('bingo:bot:start', { username: name });
      } else {
        sock.emit('bingo:queue:join', { username: name });
      }
    });

    sock.on('bingo:game:started', (data: GameData) => {
      applyGameStart(data);
    });

    sock.on('bingo:queue:queued', () => {
      setPhase('matchmaking');
    });

    sock.on('connect_error', () => {
      setErrorMsg('Could not connect to server. Please try again.');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, router, setupSocketListeners, applyGameStart]);

  // ── Pending game from room lobby ──────────────────────────────────────────
  useEffect(() => {
    if (pendingHandled.current) return;
    const pending = sessionStorage.getItem('bingo_pending_game');
    if (!pending) return;
    pendingHandled.current = true;
    sessionStorage.removeItem('bingo_pending_game');

    try {
      const data: GameData = JSON.parse(pending);
      const savedName = data.yourUsername;
      setUsername(savedName);
      setNameInput(savedName);
      setNameLocked(true);
      setGameMode('friend');

      const sock = io(API_URL, { transports: ['websocket', 'polling'] });
      socketRef.current = sock;
      setupSocketListeners(sock);

      sock.on('connect', () => {
        sock.emit('player:join', { username: savedName });
        sock.emit('bingo:rejoin', { gameId: data.gameId, username: savedName });
      });

      sock.on('bingo:rejoined', (state: {
        gridRows: number; gridCols: number;
        calledNumbers: number[]; currentCall: number | null;
        players: PlayerInfo[]; yourCard: (number | null)[][];
        status: string; winner: string | null; rankings: RankEntry[];
        currentCallerUsername: string;
      }) => {
        setGridRows(state.gridRows);
        setGridCols(state.gridCols);
        setCalledNumbers(state.calledNumbers ?? []);
        setCurrentCall(state.currentCall ?? null);
        setPlayers(state.players ?? []);
        setCurrentCaller(state.currentCallerUsername ?? '');
        if (state.yourCard) {
          setMyCard(state.yourCard);
          setMyMarked(Array.from({ length: state.gridRows }, () => new Array(state.gridCols).fill(false)));
        }
        if (state.status === 'completed' || state.winner) {
          setWinner(state.winner);
          setRankings(state.rankings ?? []);
          setPhase('ended');
        } else if (state.status === 'playing') {
          setPhase('playing');
        } else {
          setPhase('filling');
        }
      });

      applyGameStart(data);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleFillRandom = useCallback(() => {
    const total = gridRows * gridCols;
    const nums: number[] = [];
    for (let i = 1; i <= total; i++) nums.push(i);
    for (let i = nums.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nums[i], nums[j]] = [nums[j]!, nums[i]!];
    }
    const newGrid: string[][] = [];
    let idx = 0;
    for (let r = 0; r < gridRows; r++) {
      newGrid[r] = [];
      for (let c = 0; c < gridCols; c++) {
        newGrid[r]![c] = String(nums[idx++]);
      }
    }
    setFillInput(newGrid);
    setFillError('');
  }, [gridRows, gridCols]);

  const handleSubmitCard = useCallback(() => {
    const gameId = gameDataRef.current?.gameId;
    if (!gameId || !socketRef.current) return;

    // Validate all cells are filled
    const rows = fillInput.length;
    const cols = fillInput[0]?.length ?? 0;
    const card: number[][] = [];
    const seen = new Set<number>();
    const maxNum = rows * cols;

    for (let r = 0; r < rows; r++) {
      card[r] = [];
      for (let c = 0; c < cols; c++) {
        const val = parseInt(fillInput[r]![c] ?? '', 10);
        if (!val || val < 1 || val > maxNum) {
          setFillError(`All cells must have numbers between 1 and ${maxNum}`);
          return;
        }
        if (seen.has(val)) {
          setFillError(`Duplicate number: ${val}. Each number must be unique.`);
          return;
        }
        seen.add(val);
        card[r]![c] = val;
      }
    }

    setFillError('');
    setMyCard(card);
    socketRef.current.emit('bingo:card:submit', { gameId, card });
  }, [fillInput]);

  const handleCallNumber = useCallback((num: number) => {
    const gameId = gameDataRef.current?.gameId;
    if (!gameId || !socketRef.current) return;
    if (calledNumbers.includes(num)) return;
    socketRef.current.emit('bingo:call:number', { gameId, number: num });
    // Auto-mark on own card immediately after calling
    myCard.forEach((row, r) => {
      row.forEach((val, c) => {
        if (val === num && !(myMarked[r]?.[c])) {
          socketRef.current!.emit('bingo:mark:cell', { gameId, row: r, col: c });
        }
      });
    });
  }, [calledNumbers, myCard, myMarked]);

  const handleMarkCell = useCallback((row: number, col: number) => {
    const gameId = gameDataRef.current?.gameId;
    if (!gameId || !socketRef.current) return;
    if (myMarked[row]?.[col]) return; // already marked
    socketRef.current.emit('bingo:mark:cell', { gameId, row, col });
  }, [myMarked]);

  const handleRematch = useCallback(() => {
    const gameId = gameDataRef.current?.gameId;
    if (!gameId || !socketRef.current) return;
    socketRef.current.emit('bingo:rematch:vote', { gameId });
    setRematchVoted(true);
  }, []);

  const handleSendChat = useCallback(() => {
    const msg = chatInput.trim();
    const gameId = gameDataRef.current?.gameId;
    if (!msg || !gameId || !socketRef.current) return;
    socketRef.current.emit('bingo:chat', { gameId, message: msg });
    setChatInput('');
  }, [chatInput]);

  const handleChatOpen = useCallback(() => {
    setChatOpen((o) => {
      if (!o) setUnreadCount(0);
      return !o;
    });
  }, []);

  const handleStartCall = useCallback(async () => {
    const gameId = gameDataRef.current?.gameId;
    if (!gameId || !socketRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      startSpeakingDetection(usernameRef.current, stream);
      setAmInCall(true);
      setCallStartedAt(Date.now());
      socketRef.current.emit('call:start', { gameId });
    } catch { setErrorMsg('Could not access microphone.'); }
  }, [startSpeakingDetection]);

  const handleJoinCall = useCallback(async () => {
    const gameId = callGameIdRef.current ?? gameDataRef.current?.gameId;
    const sock = socketRef.current;
    if (!gameId || !sock) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      startSpeakingDetection(usernameRef.current, stream);
      setAmInCall(true);
      setCallStartedAt(Date.now());
      sock.emit('call:join', { gameId });
      sock.once('call:join_ack', async (data: { peers: string[] }) => {
        for (const peer of data.peers) {
          const pc = createPeerConnection(peer, sock, gameId);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sock.emit('call:offer', { gameId, to: peer, offer });
        }
      });
    } catch { setErrorMsg('Could not access microphone.'); }
  }, [createPeerConnection, startSpeakingDetection]);

  const handleLeaveCall = useCallback(() => {
    const gameId = gameDataRef.current?.gameId;
    if (gameId) socketRef.current?.emit('call:leave', { gameId });
    cleanupCall();
    setCallRoomActive(false);
  }, [cleanupCall]);

  const handleToggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsMuted(!track.enabled);
    const gameId = gameDataRef.current?.gameId;
    if (gameId) socketRef.current?.emit('call:mute', { gameId, muted: !track.enabled });
  }, []);

  // ── Computed ──────────────────────────────────────────────────────────────
  const myPlayerInfo = players.find((p) => p.username === usernameRef.current);
  const opponents = players.filter((p) => p.username !== usernameRef.current);
  const isMyTurn = currentCaller === usernameRef.current;
  const myLines = myPlayerInfo?.bingoLines ?? 0;

  // Calling mode only activates after this player has marked the current call on their own card
  const currentCallOnMyCard = currentCall !== null && myCard.some((row, r) =>
    row.some((num, c) => num === currentCall && !(myMarked[r]?.[c]))
  );
  const canCallNow = isMyTurn && !currentCallOnMyCard;

  // ── Menu ──────────────────────────────────────────────────────────────────
  if (phase === 'menu') {
    return (
      <div className={styles.menuPage}>
        <div className={styles.menuCard}>
          <button className={styles.homeBtn} onClick={() => router.push('/')}>
            <HomeIcon size={18} />
          </button>
          <div className={styles.menuBalls}>
            {['B','I','N','G','O'].map((l, i) => (
              <div key={l} className={styles.menuBall} style={{ background: ['#a855f7','#3b82f6','#22c55e','#f59e0b','#ef4444'][i] }}>
                {l}
              </div>
            ))}
          </div>
          <h1 className={styles.menuTitle}>BINGO</h1>
          <p className={styles.menuSubtitle}>Fill your own grid — take turns calling numbers — first to 5 lines wins!</p>

          <div className={`${styles.nameRow} ${nameShake ? styles.shake : ''}`}>
            <input
              className={styles.nameInput}
              type="text"
              placeholder="Enter your name..."
              value={nameInput}
              maxLength={20}
              disabled={nameLocked}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmName()}
            />
            {!nameLocked && (
              <button className={styles.nameConfirmBtn} onClick={() => confirmName()}>OK</button>
            )}
            {nameLocked && (
              <button className={styles.nameEditBtn} onClick={() => { setNameLocked(false); setUsername(''); }}>Edit</button>
            )}
          </div>

          {errorMsg && <p className={styles.errorMsg}>{errorMsg}</p>}

          <div className={styles.modes}>
            <button className={`${styles.modeBtn} ${styles.modeBtnBot}`} onClick={() => handleModeSelect('bot')}>
              <span className={styles.modeBtnIcon}>🤖</span>
              <span className={styles.modeBtnLabel}>vs Bot</span>
              <span className={styles.modeBtnDesc}>Play solo against AI</span>
            </button>
            <button className={`${styles.modeBtn} ${styles.modeBtnQuick}`} onClick={() => handleModeSelect('quick')}>
              <span className={styles.modeBtnIcon}>⚡</span>
              <span className={styles.modeBtnLabel}>Quick Match</span>
              <span className={styles.modeBtnDesc}>Match with a random player</span>
            </button>
            <button className={`${styles.modeBtn} ${styles.modeBtnFriend}`} onClick={() => handleModeSelect('friend')}>
              <span className={styles.modeBtnIcon}>👥</span>
              <span className={styles.modeBtnLabel}>Play with Friends</span>
              <span className={styles.modeBtnDesc}>Create or join a private room</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'matchmaking') {
    return (
      <div className={styles.menuPage}>
        <div className={styles.menuCard}>
          <div className={styles.spinner} />
          <p className={styles.matchmakingText}>Finding a player...</p>
          <button className={styles.cancelBtn} onClick={() => {
            socketRef.current?.emit('bingo:queue:leave');
            socketRef.current?.disconnect();
            setPhase('menu');
          }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'ended') {
    return (
      <div className={styles.menuPage}>
        {showCelebration && (
          <WinCelebration
            gameKey="bingo"
            winnerName={winner ?? ''}
            currentUser={usernameRef.current}
            onClose={() => setShowCelebration(false)}
          />
        )}
        <div className={styles.endCard}>
          <button className={styles.homeBtn} onClick={() => router.push('/')}>
            <HomeIcon size={18} />
          </button>
          <h2 className={styles.endTitle}>
            {winner === usernameRef.current ? '🎉 BINGO! You won!' : `🎱 ${winner ?? 'Game'} wins!`}
          </h2>
          <div className={styles.rankList}>
            {rankings.map((r) => (
              <div key={r.username} className={`${styles.rankRow} ${r.username === usernameRef.current ? styles.rankRowMe : ''}`}>
                <span className={styles.rankMedal}>{RANK_MEDAL[r.rank - 1] ?? `#${r.rank}`}</span>
                <span className={styles.rankName}>{r.username}</span>
              </div>
            ))}
          </div>
          {gameMode !== 'bot' && (
            <div className={styles.rematchSection}>
              {!rematchVoted ? (
                <button className={styles.rematchBtn} onClick={handleRematch}>🔁 Play Again</button>
              ) : (
                <p className={styles.rematchProgress}>
                  Waiting for rematch... ({rematchVotes}/{rematchNeeded})
                </p>
              )}
            </div>
          )}
          <button className={styles.menuBackBtn} onClick={() => router.push('/bingo')}>Back to Menu</button>
        </div>
      </div>
    );
  }

  // ── Filling phase ─────────────────────────────────────────────────────────
  if (phase === 'filling') {
    const total = gridRows * gridCols;

    // Compute which cells are duplicate or out of range for live highlighting
    const allValues = fillInput.flat().map((v) => parseInt(v, 10)).filter((v) => !isNaN(v) && v > 0);
    const valueCounts = new Map<number, number>();
    for (const v of allValues) valueCounts.set(v, (valueCounts.get(v) ?? 0) + 1);

    return (
      <div className={styles.gamePage}>
        {showGuide && <GameGuide gameKey="bingo" onDone={() => setShowGuide(false)} />}
        <div className={styles.fillOverlay}>
          <div className={styles.fillCard}>
            <h2 className={styles.fillTitle}>Fill Your Bingo Card</h2>
            <p className={styles.fillSubtitle}>
              Enter {total} unique numbers from 1 to {total}
            </p>

            <div
              className={styles.fillGrid}
              style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` } as CSSProperties}
            >
              {fillInput.map((row, r) =>
                row.map((val, c) => {
                  const num = parseInt(val, 10);
                  const outOfRange = val !== '' && (!num || num < 1 || num > total);
                  const isDuplicate = val !== '' && num >= 1 && num <= total && (valueCounts.get(num) ?? 0) > 1;
                  const isInvalid = outOfRange || isDuplicate;
                  return (
                    <input
                      key={`${r}-${c}`}
                      type="number"
                      min={1}
                      max={total}
                      className={`${styles.fillCell} ${isInvalid ? styles.fillCellError : val ? styles.fillCellOk : ''}`}
                      value={val}
                      title={outOfRange ? `Use 1–${total}` : isDuplicate ? `${num} already used` : ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        // Block values higher than total as user types
                        const parsed = parseInt(v, 10);
                        if (v !== '' && parsed > total) {
                          setFillError(`Numbers must be between 1 and ${total}`);
                          return;
                        }
                        setFillError('');
                        setFillInput((prev) => {
                          const next = prev.map((rr) => [...rr]);
                          next[r]![c] = v;
                          return next;
                        });
                      }}
                      placeholder="?"
                    />
                  );
                })
              )}
            </div>

            {fillError && <p className={styles.fillError}>{fillError}</p>}

            {!cardSubmitted ? (
              <div className={styles.fillActions}>
                <button className={styles.fillRandomBtn} onClick={handleFillRandom}>
                  🎲 Fill Random
                </button>
                <button className={styles.submitCardBtn} onClick={handleSubmitCard}>
                  ✅ Submit Card
                </button>
              </div>
            ) : (
              <div className={styles.waitingSubmit}>
                <div className={styles.spinner} />
                <p>Waiting for others to submit...</p>
                <p className={styles.submittedCount}>
                  {submittedPlayers.size}/{players.filter((p) => !p.username.startsWith('🤖')).length} submitted
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Playing phase ─────────────────────────────────────────────────────────
  const recentCalls = [...calledNumbers].reverse().slice(0, 6);

  return (
    <div className={styles.gamePage}>
      {showGuide && <GameGuide gameKey="bingo" onDone={() => setShowGuide(false)} />}
      {showCelebration && (
        <WinCelebration
          gameKey="bingo"
          winnerName={winner ?? ''}
          currentUser={usernameRef.current}
          onClose={() => setShowCelebration(false)}
        />
      )}

      {/* BINGO announcement */}
      {newBingoUsername && (
        <div className={styles.bingoBanner}>
          🎱 {newBingoUsername} got BINGO!
        </div>
      )}


      {/* Top bar */}
      <div className={styles.topBar}>
        <button className={styles.topHomeBtn} onClick={() => router.push('/')}>
          <HomeIcon size={16} />
        </button>

        <div className={styles.calledBalls}>
          {recentCalls.map((n, i) => (
            <div
              key={`${n}-${i}`}
              className={`${styles.calledBall} ${i === 0 ? styles.calledBallLatest : ''}`}
              style={{ background: getBallColor(n) } as CSSProperties}
            >
              {n}
            </div>
          ))}
          {recentCalls.length === 0 && <span className={styles.noCallsYet}>Numbers appear here...</span>}
        </div>

        <div className={styles.progressBadge}>
          <span>{calledNumbers.length}</span>/<span>{gridRows * gridCols}</span>
        </div>

        <div className={styles.topActions}>
          <button className={styles.guideBtn} onClick={() => setShowGuide(true)}>?</button>
          <button className={styles.chatToggleBtn} onClick={handleChatOpen}>
            <MessageSquare size={16} />
            {unreadCount > 0 && <span className={styles.unreadBadge}>{unreadCount}</span>}
          </button>
          {!callRoomActive && gameMode !== 'bot' && (
            <button className={styles.callStartBtn} onClick={handleStartCall}>
              <Phone size={16} />
            </button>
          )}
        </div>
      </div>

      <div className={styles.mainArea}>
        {/* Left sidebar: opponents */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarBingoTitle}>
            {['B','I','N','G','O'].map((l, i) => (
              <div key={l} className={styles.sidebarBingoBall} style={{ background: ['#a855f7','#3b82f6','#22c55e','#f59e0b','#ef4444'][i] } as CSSProperties}>
                {l}
              </div>
            ))}
          </div>
          {opponents.map((p) => (
            <div
              key={p.username}
              className={styles.opponentCard}
              style={{ '--player-color': PLAYER_COLORS[p.colorIndex % 8] } as CSSProperties}
            >
              <div className={styles.opponentAvatar} style={{ background: PLAYER_COLORS[p.colorIndex % 8] }}>
                {p.username[0]?.toUpperCase()}
                {speakingUsers.has(p.username) && <span className={styles.speakingDot} />}
              </div>
              <div className={styles.opponentInfo}>
                <span className={styles.opponentName}>{p.username}</span>
                <span className={styles.opponentLines}>{p.bingoLines ?? 0}/{WIN_LINES} lines</span>
                {mutedUsers.has(p.username) && <MicOff size={10} />}
              </div>
              {(p.bingoLines ?? 0) > 0 && (
                <div className={styles.miniLines}>
                  {Array.from({ length: p.bingoLines ?? 0 }).map((_, i) => (
                    <div
                      key={i}
                      className={styles.miniLine}
                      style={{ background: PLAYER_COLORS[p.colorIndex % 8] } as CSSProperties}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Center: card + call button */}
        <div className={styles.cardArea}>
          {/* Current call + caller info */}
          <div className={`${styles.currentCallDisplay} ${callAnim ? styles.callAnimIn : ''}`}>
            {currentCall !== null ? (
              <>
                <div className={styles.currentCallBall} style={{ background: getBallColor(currentCall) }}>
                  <span className={styles.currentCallNum}>{currentCall}</span>
                </div>
                <span className={styles.currentCallLabel}>Current Call</span>
              </>
            ) : (
              <span className={styles.waitingCall}>
                {isMyTurn ? (canCallNow ? 'Tap a number on your card to call it!' : 'Mark the called number first!') : `Waiting for ${currentCaller}...`}
              </span>
            )}
          </div>

          {/* Caller info */}
          <div className={styles.callerInfo}>
            {isMyTurn ? (
              <>
                <p className={styles.callerLabel} style={{ color: canCallNow ? '#4ade80' : '#fbbf24' }}>
                  {canCallNow ? '🎙️ Your turn — tap any number to call' : '👆 Mark the called number on your card first'}
                </p>
                {callBlockMsg && (
                  <p className={styles.callBlockMsg}>{callBlockMsg}</p>
                )}
              </>
            ) : (
              <p className={styles.callerLabel}>
                🎙️ <strong>{currentCaller}</strong>&apos;s turn to call
              </p>
            )}
          </div>

          {/* Card grid */}
          <div
            className={`${styles.cardGrid} ${canCallNow ? styles.cardGridCalling : ''}`}
            style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` } as CSSProperties}
          >
            {myCard.map((row, r) =>
              row.map((num, c) => {
                const isMarked = myMarked[r]?.[c] ?? false;
                const isCurrentCall = num === currentCall;
                const isCalled = num !== null && calledNumbers.includes(num);
                const isCallable = canCallNow && !isCalled && !isMarked;
                return (
                  <div
                    key={`${r}-${c}`}
                    className={`${styles.cardCell}
                      ${isMarked ? styles.cardCellMarked : ''}
                      ${isCurrentCall && !isMarked ? styles.cardCellHighlight : ''}
                      ${isCallable ? styles.cardCellCallable : ''}
                      ${canCallNow && isCalled && !isMarked ? styles.cardCellCalledDim : ''}`}
                    style={isMarked
                      ? { borderColor: `${PLAYER_COLORS[(myPlayerInfo?.colorIndex ?? 0) % 8]}99` } as CSSProperties
                      : undefined
                    }
                    onClick={() => {
                      if (isCallable && num !== null) {
                        handleCallNumber(num);
                      } else {
                        handleMarkCell(r, c);
                      }
                    }}
                  >
                    <span className={styles.cellNum}>{num ?? '?'}</span>
                    {isMarked && (
                      <div className={styles.daub}>
                        <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
                          <path d={scribblePath1(r, c)} />
                          <path d={scribblePath2(r, c)} />
                        </svg>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Lines progress — below the card */}
          <div className={styles.linesProgress}>
            {Array.from({ length: WIN_LINES }).map((_, i) => (
              <div key={i} className={`${styles.lineIndicator} ${i < myLines ? styles.lineIndicatorFilled : ''}`}>
                {i + 1}
              </div>
            ))}
            <span className={styles.linesLabel}>{myLines}/{WIN_LINES} lines</span>
          </div>
        </div>

        {/* Right sidebar: called numbers board */}
        <div className={styles.rightSidebar}>
          {callRoomActive && gameMode !== 'bot' && (
            <div className={styles.callBar}>
              <span className={styles.callBarLabel}>
                <Phone size={12} /> {amInCall ? callTimerDisplay : 'Call active'}
              </span>
              <div className={styles.callBarMembers}>
                {callMembers.map((m) => (
                  <div key={m} className={`${styles.callMember} ${speakingUsers.has(m) ? styles.callMemberSpeaking : ''}`}>
                    {m[0]?.toUpperCase()}
                  </div>
                ))}
              </div>
              {!amInCall ? (
                <button className={styles.joinCallBtn} onClick={handleJoinCall}>Join</button>
              ) : (
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button className={styles.muteBtn} onClick={handleToggleMute}>
                    {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
                  </button>
                  <button className={styles.leaveCallBtn} onClick={handleLeaveCall}>Leave</button>
                </div>
              )}
            </div>
          )}

          <div className={styles.numberBoard}>
            <p className={styles.boardTitle}>Called Numbers</p>
            <div className={styles.boardGrid} style={{ gridTemplateColumns: `repeat(5, 1fr)` }}>
              {Array.from({ length: gridRows * gridCols }, (_, i) => i + 1).map((n) => {
                const called = calledNumbers.includes(n);
                const isCurrent = n === currentCall;
                return (
                  <div
                    key={n}
                    className={`${styles.boardNum} ${called ? styles.boardNumCalled : ''} ${isCurrent ? styles.boardNumCurrent : ''}`}
                    style={isCurrent ? { background: getBallColor(n) } as CSSProperties : undefined}
                  >
                    {n}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Chat panel */}
      {chatOpen && (
        <div className={styles.chatPanel}>
          <div className={styles.chatHeader}>
            <span>Chat</span>
            <button className={styles.chatClose} onClick={handleChatOpen}>✕</button>
          </div>
          <div className={styles.chatMessages}>
            {chatMessages.map((m, i) => (
              <div key={i} className={`${styles.chatMsg} ${m.username === usernameRef.current ? styles.chatMsgMe : ''}`}>
                <span className={styles.chatMsgUser}>{m.username}</span>
                <span className={styles.chatMsgText}>{m.message}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className={styles.chatInput}>
            <input
              type="text"
              value={chatInput}
              maxLength={200}
              placeholder="Type a message..."
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
            />
            <button onClick={handleSendChat}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Seeded random so the same cell always gets the same scribble (stable across re-renders)
function seededRand(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

function scribblePath1(row: number, col: number): string {
  const r = seededRand(row * 31 + col * 97 + 7);
  const jitter = () => (r() - 0.5) * 5;
  const x1 = 5 + jitter(), y1 = 5 + jitter();
  const x2 = 20 + jitter(), y2 = 12 + jitter();
  const x3 = 35 + jitter(), y3 = 5 + jitter();
  const cx1 = 12 + jitter(), cy1 = 20 + jitter();
  const cx2 = 28 + jitter(), cy2 = 20 + jitter();
  const x4 = 20 + jitter(), y4 = 35 + jitter();
  return `M${x1} ${y1} C${cx1} ${cy1}, ${cx2} ${cy2}, ${x3} ${y3} M${x2} ${y2} C${cx1+3} ${cy1+5}, ${cx2-3} ${cy2+5}, ${x4} ${y4}`;
}

function scribblePath2(row: number, col: number): string {
  const r = seededRand(row * 53 + col * 71 + 13);
  const jitter = () => (r() - 0.5) * 5;
  const x1 = 35 + jitter(), y1 = 5 + jitter();
  const x2 = 5 + jitter(), y2 = 35 + jitter();
  const cx1 = 25 + jitter(), cy1 = 15 + jitter();
  const cx2 = 15 + jitter(), cy2 = 28 + jitter();
  return `M${x1} ${y1} C${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}

function getBallColor(num: number): string {
  const colors = ['#a855f7','#3b82f6','#22c55e','#f59e0b','#ef4444'];
  if (num <= 15) return colors[0]!;
  if (num <= 30) return colors[1]!;
  if (num <= 45) return colors[2]!;
  if (num <= 60) return colors[3]!;
  return colors[4]!;
}
