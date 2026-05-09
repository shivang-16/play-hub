'use client';

import {
  useEffect, useState, useRef, useCallback,
  type CSSProperties, type PointerEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  Users, Trophy, Home as HomeIcon, Rocket,
  Phone, PhoneOff, Mic, MicOff, MessageSquare, Volume2, BookOpen, X,
} from 'lucide-react';
import styles from './word-puzzle.module.css';
import GameGuide from '../../components/GameGuide';
import WinCelebration from '../../components/WinCelebration';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

// ── Player colours (8 slots, keep in sync with backend PLAYER_COLORS) ────────
const PLAYER_COLORS = [
  '#f87171', '#60a5fa', '#4ade80', '#fbbf24',
  '#a78bfa', '#f472b6', '#34d399', '#fb923c',
];

// ── Types (mirror backend) ─────────────────────────────────────────────────
interface WPCell  { row: number; col: number }
interface WPWord  { id: string; word: string; cells: WPCell[]; claimedBy: string | null; claimedAt: number | null }
interface WPPlayer { username: string; score: number; colorIndex: number }

type GamePhase = 'menu' | 'matchmaking' | 'solo-setup' | 'playing' | 'ended';

// ── Difficulty levels (mirrors lobby page) ────────────────────────────────
const DIFFICULTIES = [
  { id: 'easy',   label: 'Easy',   emoji: '🟢', wordCount: 8,  gridLabel: '12×12', desc: 'Short & sweet'       },
  { id: 'medium', label: 'Medium', emoji: '🟡', wordCount: 14, gridLabel: '17×17', desc: 'Balanced challenge'  },
  { id: 'hard',   label: 'Hard',   emoji: '🔴', wordCount: 20, gridLabel: '22×22', desc: 'Large board, hard!'  },
] as const;

type Difficulty = typeof DIFFICULTIES[number]['id'];

export default function WordPuzzlePage() {
  const router = useRouter();

  // ── Auth / username ─────────────────────────────────────────────────────
  const [username, setUsername]         = useState('');
  const [nameInput, setNameInput]       = useState('');
  const [nameLocked, setNameLocked]     = useState(false); // true once confirmed for this session
  const [nameShake, setNameShake]       = useState(false);
  const [socket, setSocket]             = useState<Socket | null>(null);
  const [phase, setPhase]               = useState<GamePhase>('menu');

  // ── Word pronunciation & definition ─────────────────────────────────────
  const [definitionPopup, setDefinitionPopup] = useState<{ wordId: string; meaning: string; loading: boolean } | null>(null);

  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const load = () => { voicesRef.current = window.speechSynthesis.getVoices(); };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const handlePronounce = useCallback((word: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word.toLowerCase());
    utterance.lang = 'en-US';
    utterance.rate = 1;
    utterance.pitch = 1;
    const voices = voicesRef.current.length
      ? voicesRef.current
      : window.speechSynthesis.getVoices();
    const femaleVoice = voices.find(
      (v) => v.lang.startsWith('en') && /female|samantha|victoria|karen|fiona|zira|susan/i.test(v.name)
    ) ?? voices.find((v) => v.lang.startsWith('en') && /woman|girl/i.test(v.name));
    if (femaleVoice) utterance.voice = femaleVoice;
    window.speechSynthesis.speak(utterance);
  }, []);

  const handleShowDefinition = useCallback(async (wordId: string, word: string) => {
    // Toggle off if already open for this word
    if (definitionPopup?.wordId === wordId) {
      setDefinitionPopup(null);
      return;
    }
    setDefinitionPopup({ wordId, meaning: '', loading: true });
    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      const meanings: string[] = [];
      for (const entry of data) {
        for (const m of entry.meanings ?? []) {
          const def = m.definitions?.[0]?.definition;
          if (def) { meanings.push(`(${m.partOfSpeech}) ${def}`); }
          if (meanings.length >= 2) break;
        }
        if (meanings.length >= 2) break;
      }
      setDefinitionPopup({ wordId, meaning: meanings.length > 0 ? meanings.join(' • ') : 'No definition found.', loading: false });
    } catch {
      setDefinitionPopup({ wordId, meaning: 'Definition not available.', loading: false });
    }
  }, [definitionPopup]);

  // ── Lobby / matchmaking ─────────────────────────────────────────────────
  const [friendRoomCode, setFriendRoomCode] = useState('');
  const [roomError, setRoomError]           = useState('');
  const [mmStatus, setMmStatus]             = useState('Looking for players…');
  const [menuDifficulty, setMenuDifficulty] = useState<Difficulty>('medium');
  const [needReconnect, setNeedReconnect]   = useState<string | null>(null);

  // ── Solo mode state ──────────────────────────────────────────────────────
  const [isSolo, setIsSolo]                   = useState(false);
  const [soloDifficulty, setSoloDifficulty]   = useState<Difficulty>('medium');
  const [soloElapsed, setSoloElapsed]         = useState(0);   // seconds
  const soloTimerRef                          = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Game state ──────────────────────────────────────────────────────────
  const [gameId, setGameId]             = useState<string | null>(null);
  const [board, setBoard]               = useState<string[][]>([]);
  const [gridSize, setGridSize]         = useState(15);
  const [words, setWords]               = useState<WPWord[]>([]);
  const [players, setPlayers]           = useState<WPPlayer[]>([]);
  const [myColorIndex, setMyColorIndex] = useState(0);
  const [endResult, setEndResult]       = useState<WPPlayer[] | null>(null);
  const [showGuide, setShowGuide]       = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const celebrationShownRef = useRef(false);

  // ── Rematch state ──────────────────────────────────────────────────────
  const [rematchWaiting, setRematchWaiting] = useState(false);
  const [rematchVotes, setRematchVotes]     = useState(0);
  const [rematchNeeded, setRematchNeeded]   = useState(0);
  const [rematchError, setRematchError]     = useState<string | null>(null);

  // ── Selection state ─────────────────────────────────────────────────────
  const [selStart, setSelStart]         = useState<WPCell | null>(null);
  const [selEnd, setSelEnd]             = useState<WPCell | null>(null);
  const [lastClaim, setLastClaim]       = useState<{ word: string; correct: boolean } | null>(null);

  // ── Chat state ───────────────────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState<Array<{ username: string; message: string; ts: Date }>>([]);
  const [chatInput, setChatInput]       = useState('');
  const [chatOpen, setChatOpen]         = useState(false);
  const [unreadCount, setUnreadCount]   = useState(0);
  const chatOpenRef                     = useRef(chatOpen);

  // ── Call state ───────────────────────────────────────────────────────────
  const [callRoomActive, setCallRoomActive]         = useState(false);
  const [callRoomInitiator, setCallRoomInitiator]   = useState<string | null>(null);
  const [callMembers, setCallMembers]               = useState<string[]>([]);
  const [amInCall, setAmInCall]                     = useState(false);
  const [isMuted, setIsMuted]                       = useState(false);
  const [mutedUsers, setMutedUsers]                 = useState<Set<string>>(new Set());
  const [speakingUsers, setSpeakingUsers]           = useState<Set<string>>(new Set());
  const [callTimerDisplay, setCallTimerDisplay]     = useState('0:00');
  const [callStartedAt, setCallStartedAt]           = useState<number | null>(null);
  const localStreamRef       = useRef<MediaStream | null>(null);
  const peerConnectionsRef   = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const callGameIdRef        = useRef<string | null>(null);
  const speakingStopFnsRef   = useRef<Map<string, () => void>>(new Map());
  const playCallChimeRef     = useRef<() => void>(() => {});

  const boardRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const pendingReconnectRef = useRef<{ gameId: string; username: string } | null>(null);

  // Keep chatOpenRef in sync
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);

  // ── Restore pending game from sessionStorage (set by room lobby) ────────
  useEffect(() => {
    const pending = sessionStorage.getItem('wp_pendingGame');
    if (pending) {
      sessionStorage.removeItem('wp_pendingGame');
      const data = JSON.parse(pending);
      const uname = data.username || '';
      setUsername(uname);
      setNameInput(uname);
      setNameLocked(true);
      initGame(data, uname);
      // Store gameId so connectSocket can rejoin the room on connect
      pendingReconnectRef.current = { gameId: data.gameId, username: uname };
      setNeedReconnect(uname);
    }
  }, []);

  // ── Socket lifecycle ────────────────────────────────────────────────────
  const connectSocket = useCallback((uname: string): Socket => {
    if (socketRef.current?.connected) return socketRef.current;

    const sock = io(API_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = sock;
    setSocket(sock);

    sock.on('connect', () => {
      sock.emit('player:join', { username: uname });
      // If coming from room lobby, rejoin the game room for chat/call
      const pr = pendingReconnectRef.current;
      if (pr) {
        sock.emit('wp:game:reconnect', { gameId: pr.gameId, username: pr.username });
        pendingReconnectRef.current = null;
      }
    });

    // Matchmaking
    sock.on('wp:matchmaking:queued', (data: { position: number }) => {
      setMmStatus(`In queue (position ${data.position}) — waiting for opponent…`);
    });

    // Game started (via matchmaking or reconnect)
    sock.on('wp:game:started', (data: any) => {
      initGame(data, uname);
    });

    // Word claimed by any player
    sock.on('wp:game:wordClaimed', (data: {
      wordId: string; word: string; claimedBy: string; colorIndex: number; cells: WPCell[];
      players: WPPlayer[];
    }) => {
      setWords((prev) => prev.map((w) =>
        w.id === data.wordId ? { ...w, claimedBy: data.claimedBy } : w
      ));
      setPlayers(data.players);

      if (data.claimedBy === uname) {
        setLastClaim({ word: data.word ?? '?', correct: true });
        setTimeout(() => setLastClaim(null), 1500);
      }
    });

    sock.on('wp:game:claimFailed', () => {
      setLastClaim({ word: '', correct: false });
      setTimeout(() => setLastClaim(null), 1000);
    });

    // Game ended
    sock.on('wp:game:ended', (data: { gameId?: string; players: WPPlayer[]; winner: string | null; words?: WPWord[] }) => {
      if (data.words) setWords(data.words);
      setPlayers(data.players);
      setEndResult(data.players);
      setPhase('ended');
      setRematchWaiting(false);
      setRematchVotes(0);
      setRematchNeeded(0);
      setRematchError(null);
      if (!celebrationShownRef.current) {
        celebrationShownRef.current = true;
        setTimeout(() => setShowCelebration(true), 800);
      }
    });

    // Rematch progress
    sock.on('wp:rematch:progress', (data: { votes: number; needed: number; voted: string[] }) => {
      setRematchVotes(data.votes);
      setRematchNeeded(data.needed);
    });

    // Rematch error
    sock.on('wp:rematch:error', (data: { message: string }) => {
      setRematchError(data.message);
      setRematchWaiting(false);
    });

    // Room events (forwarded here when game starts from lobby)
    sock.on('wp:room:error', (data: { message: string }) => {
      setRoomError(data.message);
    });

    sock.on('wp:game:state', (data: any) => {
      initGame(data, uname);
    });

    // Chat
    sock.on('chat:message', (data: { username: string; message: string }) => {
      setChatMessages((prev) => [...prev, { ...data, ts: new Date() }]);
      if (!chatOpenRef.current && data.username !== uname) {
        setUnreadCount((n) => n + 1);
      }
    });

    // ── Call signaling ────────────────────────────────────────────────────
    sock.on('call:ringing', (data: { from: string; gameId: string }) => {
      setCallRoomActive(true);
      setCallRoomInitiator(data.from);
      setCallStartedAt(Date.now());
      playCallChimeRef.current();
    });

    sock.on('call:members', (data: { members: string[]; gameId: string }) => {
      setCallMembers((prev) => [...new Set([...prev, ...data.members])]);
    });

    sock.on('call:peer_joined', async (data: { username: string; gameId: string }) => {
      const gid = callGameIdRef.current ?? data.gameId;
      setCallMembers((prev) => [...new Set([...prev, data.username])]);
      const pc = getOrCreatePC(data.username, gid, sock);
      const ls = localStreamRef.current;
      if (ls) ls.getTracks().forEach((t) => { if (!pc.getSenders().some((s) => s.track?.id === t.id)) pc.addTrack(t, ls); });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sock.emit('call:offer', { to: data.username, offer, gameId: gid });
    });

    sock.on('call:offer', async (data: { from: string; offer: RTCSessionDescriptionInit; gameId: string }) => {
      const gid = callGameIdRef.current ?? data.gameId;
      setCallMembers((prev) => [...new Set([...prev, data.from])]);
      const pc = getOrCreatePC(data.from, gid, sock);
      const ls = localStreamRef.current;
      if (ls) ls.getTracks().forEach((t) => { if (!pc.getSenders().some((s) => s.track?.id === t.id)) pc.addTrack(t, ls); });
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      await flushCandidates(data.from);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sock.emit('call:answer', { to: data.from, answer, gameId: gid });
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
      if (pc && pc.remoteDescription) {
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
      setMutedUsers((prev) => { const n = new Set(prev); n.delete(data.username); return n; });
      setCallMembers((prev) => {
        const next = prev.filter((u) => u !== data.username);
        if (next.length === 0) { setCallRoomActive(false); setCallRoomInitiator(null); setAmInCall(false); }
        return next;
      });
    });

    sock.on('call:mute', (data: { username: string; muted: boolean }) => {
      setMutedUsers((prev) => { const n = new Set(prev); data.muted ? n.add(data.username) : n.delete(data.username); return n; });
    });

    return sock;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-connect socket when navigating from room lobby with a pending game
  useEffect(() => {
    if (needReconnect) {
      connectSocket(needReconnect);
      setNeedReconnect(null);
    }
  }, [needReconnect, connectSocket]);

  function initGame(data: any, uname: string, solo = false) {
    setGameId(data.gameId);
    setBoard(data.board ?? []);
    setGridSize(data.gridSize ?? 15);
    setWords(data.words ?? []);
    setPlayers(data.players ?? []);
    const seat = data.players.findIndex((p: WPPlayer) => p.username === uname);
    setMyColorIndex(seat >= 0 ? seat % 8 : (data.yourColorIndex ?? 0));
    setEndResult(null);
    setRematchWaiting(false);
    setRematchVotes(0);
    setRematchNeeded(0);
    setRematchError(null);
    celebrationShownRef.current = false;
    setPhase('playing');
    if (!sessionStorage.getItem('guide_word-puzzle')) {
      setShowGuide(true);
    }
    if (solo || data.players.length === 1) {
      setIsSolo(true);
      setSoloElapsed(0);
      if (soloTimerRef.current) clearInterval(soloTimerRef.current);
      soloTimerRef.current = setInterval(() => setSoloElapsed((n) => n + 1), 1000);
    }
  }

  // ── Call timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!callRoomActive || callStartedAt === null) return;
    const fmt = (ms: number) => { const s = Math.floor(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };
    setCallTimerDisplay(fmt(Date.now() - callStartedAt));
    const id = setInterval(() => setCallTimerDisplay(fmt(Date.now() - callStartedAt!)), 1000);
    return () => clearInterval(id);
  }, [callRoomActive, callStartedAt]);

  // ── WebRTC helpers ───────────────────────────────────────────────────────
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
        if (now !== speaking) { speaking = now; setSpeakingUsers((p) => { const n = new Set(p); now ? n.add(user) : n.delete(user); return n; }); }
      };
      const iv = setInterval(tick, 80);
      const stop = () => { clearInterval(iv); ctx.close().catch(()=>{}); setSpeakingUsers((p) => { const n = new Set(p); n.delete(user); return n; }); };
      speakingStopFnsRef.current.set(user, stop);
    } catch {}
  }, []);

  const getOrCreatePC = useCallback((remoteUser: string, gid: string, sock: Socket): RTCPeerConnection => {
    if (peerConnectionsRef.current.has(remoteUser)) return peerConnectionsRef.current.get(remoteUser)!;
    const pc = new RTCPeerConnection(STUN);
    pc.ontrack = (ev) => {
      const rs = ev.streams[0] ?? new MediaStream([ev.track]);
      const audio = document.createElement('audio');
      audio.srcObject = rs; audio.autoplay = true; audio.play().catch(()=>{});
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
  }, [startSpeakDetection]); // eslint-disable-line react-hooks/exhaustive-deps

  const flushCandidates = useCallback(async (remoteUser: string) => {
    const pc = peerConnectionsRef.current.get(remoteUser);
    const q = pendingCandidatesRef.current.get(remoteUser) ?? [];
    pendingCandidatesRef.current.set(remoteUser, []);
    for (const c of q) { try { await pc?.addIceCandidate(new RTCIceCandidate(c)); } catch {} }
  }, []);

  const playCallChime = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const g = ctx.createGain(); g.connect(ctx.destination);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.28, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
      const o1 = ctx.createOscillator(); o1.type='sine'; o1.frequency.setValueAtTime(880, ctx.currentTime);
      o1.connect(g); o1.start(ctx.currentTime); o1.stop(ctx.currentTime + 0.35);
      const o2 = ctx.createOscillator(); o2.type='sine'; o2.frequency.setValueAtTime(1320, ctx.currentTime + 0.18);
      o2.connect(g); o2.start(ctx.currentTime + 0.18); o2.stop(ctx.currentTime + 0.7);
    } catch {}
  }, []);
  useEffect(() => { playCallChimeRef.current = playCallChime; }, [playCallChime]);

  const cleanupCall = useCallback(() => {
    peerConnectionsRef.current.forEach((pc) => pc.close()); peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop()); localStreamRef.current = null;
    callGameIdRef.current = null;
    speakingStopFnsRef.current.forEach((s) => s()); speakingStopFnsRef.current.clear();
    setSpeakingUsers(new Set()); setMutedUsers(new Set());
    setCallRoomActive(false); setCallRoomInitiator(null); setCallMembers([]);
    setAmInCall(false); setIsMuted(false); setCallStartedAt(null); setCallTimerDisplay('0:00');
  }, []);

  const handleStartCall = useCallback(async () => {
    if (!socket || !gameId || callRoomActive) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream; callGameIdRef.current = gameId;
      startSpeakDetection(username, stream);
      socket.emit('call:start', { gameId }); socket.emit('call:join', { gameId });
      setCallRoomActive(true); setCallRoomInitiator(username); setCallMembers([username]);
      setAmInCall(true); setCallStartedAt(Date.now()); playCallChime();
    } catch { alert('Microphone access is required for calls.'); }
  }, [socket, gameId, callRoomActive, username, playCallChime, startSpeakDetection]);

  const handleJoinCall = useCallback(async () => {
    if (!socket || !gameId || amInCall) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream; callGameIdRef.current = gameId;
      startSpeakDetection(username, stream);
      peerConnectionsRef.current.forEach((pc) => {
        stream.getTracks().forEach((t) => { if (!pc.getSenders().some((s) => s.track?.id === t.id)) pc.addTrack(t, stream); });
      });
      socket.emit('call:join', { gameId }); setAmInCall(true);
    } catch { alert('Microphone access is required for calls.'); }
  }, [socket, gameId, amInCall, username, startSpeakDetection]);

  const handleLeaveCall = useCallback(() => {
    if (!socket || !callGameIdRef.current) return;
    socket.emit('call:leave', { gameId: callGameIdRef.current });
    peerConnectionsRef.current.forEach((pc) => pc.close()); peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop()); localStreamRef.current = null;
    callGameIdRef.current = null;
    speakingStopFnsRef.current.forEach((s) => s()); speakingStopFnsRef.current.clear();
    setSpeakingUsers(new Set()); setMutedUsers(new Set());
    setAmInCall(false); setIsMuted(false);
    setCallMembers((prev) => {
      const next = prev.filter((u) => u !== username);
      if (next.length === 0) { setCallRoomActive(false); setCallRoomInitiator(null); setCallStartedAt(null); setCallTimerDisplay('0:00'); }
      return next;
    });
  }, [socket, username]);

  const handleToggleMute = useCallback(() => {
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsMuted((m) => {
      const nowMuted = !m;
      if (socket && callGameIdRef.current) socket.emit('call:mute', { gameId: callGameIdRef.current, muted: nowMuted });
      setMutedUsers((prev) => { const n = new Set(prev); nowMuted ? n.add(username) : n.delete(username); return n; });
      return nowMuted;
    });
  }, [socket, username]);

  const handleSendChat = useCallback(() => {
    if (!chatInput.trim() || !socket || !gameId) return;
    socket.emit('chat:send', { gameId, username, message: chatInput });
    setChatInput('');
  }, [chatInput, socket, gameId, username]);

  // ── Menu: set username & play ───────────────────────────────────────────
  const triggerNameShake = useCallback(() => {
    setNameShake(true);
    setTimeout(() => setNameShake(false), 600);
  }, []);

  const handleSetUsername = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    sessionStorage.setItem('4inarow_username', trimmed);
    setUsername(trimmed);
    setNameLocked(true);
  }, []);

  // ── Solo mode helpers ────────────────────────────────────────────────────
  const fmtTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const startSoloTimer = useCallback(() => {
    setSoloElapsed(0);
    if (soloTimerRef.current) clearInterval(soloTimerRef.current);
    soloTimerRef.current = setInterval(() => setSoloElapsed((n) => n + 1), 1000);
  }, []);

  const stopSoloTimer = useCallback(() => {
    if (soloTimerRef.current) { clearInterval(soloTimerRef.current); soloTimerRef.current = null; }
  }, []);

  const handleStartSolo = useCallback(() => {
    if (!username) return;
    const sock = connectSocket(username);
    const wc = DIFFICULTIES.find((d) => d.id === soloDifficulty)?.wordCount ?? 14;
    setIsSolo(true);
    setSoloElapsed(0);
    sock.emit('wp:solo:start', { username, wordCount: wc });
  }, [username, connectSocket, soloDifficulty]);

  // Stop timer when game ends
  useEffect(() => {
    if (phase === 'ended') stopSoloTimer();
  }, [phase, stopSoloTimer]);

  // ── Matchmaking ─────────────────────────────────────────────────────────
  const handleFindPlayer = useCallback(() => {
    if (!username) return;
    const sock = connectSocket(username);
    setPhase('matchmaking');
    setMmStatus('Looking for players…');
    const wc = DIFFICULTIES.find((d) => d.id === menuDifficulty)?.wordCount ?? 14;
    sock.emit('wp:matchmaking:join', { username, wordCount: wc });
  }, [username, connectSocket, menuDifficulty]);

  const handleCancelMM = useCallback(() => {
    socket?.emit('wp:matchmaking:leave');
    setPhase('menu');
  }, [socket]);

  // ── Create / join room ──────────────────────────────────────────────────
  const handleCreateRoom = useCallback(() => {
    if (!username) return;
    sessionStorage.setItem('4inarow_username', username);
    router.push('/word-puzzle/room/new');
  }, [username, router]);

  const handleJoinRoom = useCallback(() => {
    if (!username || !friendRoomCode.trim()) return;
    sessionStorage.setItem('4inarow_username', username);
    router.push(`/word-puzzle/room/${friendRoomCode.trim().toUpperCase()}`);
  }, [username, friendRoomCode, router]);

  // ── Board interaction ───────────────────────────────────────────────────
  /** Build cell path between two cells if they are co-linear */
  function buildPath(start: WPCell, end: WPCell): WPCell[] | null {
    const dr = end.row - start.row;
    const dc = end.col - start.col;
    if (dr === 0 && dc === 0) return null;
    if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return null;
    const steps = Math.max(Math.abs(dr), Math.abs(dc));
    const sr = dr === 0 ? 0 : dr / Math.abs(dr);
    const sc = dc === 0 ? 0 : dc / Math.abs(dc);
    return Array.from({ length: steps + 1 }, (_, i) => ({
      row: start.row + sr * i,
      col: start.col + sc * i,
    }));
  }

  const selectionPath = selStart && selEnd ? buildPath(selStart, selEnd) : null;
  const selectionSet  = new Set(selectionPath?.map((c) => `${c.row},${c.col}`) ?? []);

  // Use a ref so pointer handlers always see current selStart without stale closure
  const selStartRef = useRef<WPCell | null>(null);
  // Mirror selEnd into a ref so onBoardPointerUp always reads the latest end cell
  const selEndRef   = useRef<WPCell | null>(null);

  /** Read the cell coordinates from the element under the pointer */
  function cellFromPoint(clientX: number, clientY: number): WPCell | null {
    const el = document.elementFromPoint(clientX, clientY);
    const cellEl = el instanceof Element ? el.closest('[data-row]') : null;
    if (!cellEl) return null;
    const row = parseInt(cellEl.getAttribute('data-row') ?? '-1', 10);
    const col = parseInt(cellEl.getAttribute('data-col') ?? '-1', 10);
    if (row < 0 || col < 0) return null;
    return { row, col };
  }

  /** Board-level pointer down — start a drag */
  function onBoardPointerDown(e: PointerEvent<HTMLDivElement>) {
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (!cell) return;
    // Capture on the board so pointermove keeps firing even when moving fast
    e.currentTarget.setPointerCapture(e.pointerId);
    selStartRef.current = cell;
    selEndRef.current   = cell;
    setSelStart(cell);
    setSelEnd(cell);
  }

  /** Board-level pointer move — update the end cell while dragging */
  function onBoardPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (e.buttons === 0 || !selStartRef.current) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (cell) {
      selEndRef.current = cell;
      setSelEnd(cell);
    }
  }

  /** Submit selection on pointer up */
  const onBoardPointerUp = useCallback((e?: PointerEvent<HTMLDivElement>) => {
    const start = selStartRef.current;
    const end   = selEndRef.current;
    selStartRef.current = null;
    selEndRef.current   = null;
    if (!start || !end || !gameId || !socket) { setSelStart(null); setSelEnd(null); return; }
    if (start.row === end.row && start.col === end.col) {
      setSelStart(null); setSelEnd(null); return;
    }
    socket.emit('wp:game:claim', {
      gameId,
      startRow: start.row, startCol: start.col,
      endRow: end.row,     endCol: end.col,
    });
    setSelStart(null);
    setSelEnd(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, socket]);

  // ── Cell visual state ───────────────────────────────────────────────────
  function getCellStyle(row: number, col: number): { className: string; style: CSSProperties } {
    const key = `${row},${col}`;

    // Claimed?
    const claimedWord = words.find((w) => w.claimedBy && w.cells.some((c) => c.row === row && c.col === col));
    if (claimedWord) {
      const owner = players.find((p) => p.username === claimedWord.claimedBy);
      const color = PLAYER_COLORS[owner?.colorIndex ?? 0]!;
      return {
        className: `${styles.cell} ${styles.cellClaimed}`,
        style: { '--claimed-color': color, '--claimed-bg': `${color}22` } as CSSProperties,
      };
    }

    // In current selection?
    if (selectionSet.has(key)) {
      return { className: `${styles.cell} ${styles.cellSelected}`, style: {} };
    }

    return { className: styles.cell ?? '', style: {} };
  }

  // ── Render ──────────────────────────────────────────────────────────────

  /* ─── MENU ─── */
  if (phase === 'menu') {
    return (
      <div className={styles.page}>
        <div className={styles.menuCard}>
          <div className={styles.menuEmoji}>📝</div>
          <h1 className={styles.menuTitle}>Word Search</h1>

          {/* Inline name field */}
          <div className={styles.nameRow}>
            <input
              type="text"
              placeholder="Your username"
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value);
                setNameLocked(false);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleSetUsername(nameInput)}
              className={`${styles.nameInput} ${nameShake ? styles.nameInputShake : ''}`}
              maxLength={20}
            />
          </div>

          <div className={styles.modeGrid}>
            <button className={styles.modeCard} onClick={() => {
              const u = nameInput.trim(); if (!u) { triggerNameShake(); return; }
              handleSetUsername(u);
              const sock = connectSocket(u);
              setPhase('matchmaking'); setMmStatus('Looking for players…');
              const wc = DIFFICULTIES.find((d) => d.id === menuDifficulty)?.wordCount ?? 14;
              sock.emit('wp:matchmaking:join', { username: u, wordCount: wc });
            }}>
              <Users size={22} className={styles.modeIcon} />
              <span className={styles.modeLabel}>Find Player</span>
              <span className={styles.modeHint}>Quick online match</span>
            </button>

            <button className={styles.modeCard} onClick={() => {
              const u = nameInput.trim(); if (!u) { triggerNameShake(); return; }
              handleSetUsername(u);
              sessionStorage.setItem('4inarow_username', u);
              router.push('/word-puzzle/room/new');
            }}>
              <HomeIcon size={22} className={styles.modeIcon} />
              <span className={styles.modeLabel}>Play with Friends</span>
              <span className={styles.modeHint}>Up to 8 friends</span>
            </button>
          </div>

          {/* Solo play card — full width, distinct colour */}
          <button className={styles.soloCard} onClick={() => {
            const u = nameInput.trim(); if (!u) { triggerNameShake(); return; }
            handleSetUsername(u); setPhase('solo-setup');
          }}>
            <span className={styles.soloCardEmoji}>🧩</span>
            <span className={styles.soloCardLabel}>Solo Play</span>
            <span className={styles.soloCardHint}>Beat the clock, no opponents</span>
          </button>

          {/* Difficulty selector (used for matchmaking; rooms set it in the lobby) */}
          <div className={styles.difficultySection}>
            <p className={styles.difficultyTitle}>🎯 Difficulty <span className={styles.difficultyNote}>(for Find Player)</span></p>
            <div className={styles.difficultyRow}>
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.id}
                  className={`${styles.diffChip} ${menuDifficulty === d.id ? styles.diffChipActive : ''}`}
                  onClick={() => setMenuDifficulty(d.id)}
                >
                  <span>{d.emoji}</span>
                  <span>{d.label}</span>
                  <span className={styles.diffChipGrid}>{d.gridLabel}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.joinRow}>
            <input
              type="text"
              placeholder="Room code"
              value={friendRoomCode}
              onChange={(e) => setFriendRoomCode(e.target.value.toUpperCase())}
              className={styles.codeInput}
              maxLength={6}
            />
            <button
              className={styles.secondaryBtn}
              onClick={() => {
                const u = nameInput.trim();
                if (!u) { triggerNameShake(); return; }
                if (!friendRoomCode.trim()) return;
                handleSetUsername(u);
                sessionStorage.setItem('4inarow_username', u);
                router.push(`/word-puzzle/room/${friendRoomCode.trim().toUpperCase()}`);
              }}
              disabled={!friendRoomCode.trim()}
            >
              <Rocket size={14} />Join Room
            </button>
          </div>

          {roomError && <p className={styles.errorMsg}>{roomError}</p>}

          {/* Vocab CTA */}
          <button
            className={styles.vocabCta}
            onClick={() => router.push('/word-puzzle/vocab')}
          >
            <BookOpen size={20} className={styles.vocabCtaIcon} />
            <span className={styles.vocabCtaText}>
              Want to learn something new?
              <span className={styles.vocabCtaHint}>Explore rare &amp; powerful words →</span>
            </span>
          </button>
        </div>
      </div>
    );
  }

  /* ─── MATCHMAKING ─── */
  if (phase === 'matchmaking') {
    return (
      <div className={styles.page}>
        <div className={styles.menuCard}>
          <div className={styles.mmSpinner} />
          <h2 className={styles.menuTitle} style={{ fontSize: '1.5rem' }}>Finding Opponent</h2>
          <p className={styles.menuDesc}>{mmStatus}</p>
          <button className={styles.ghostBtn} onClick={handleCancelMM}>Cancel</button>
        </div>
      </div>
    );
  }

  /* ─── SOLO SETUP ─── */
  if (phase === 'solo-setup') {
    return (
      <div className={styles.page}>
        <div className={styles.menuCard}>
          <div className={styles.menuEmoji}>🧩</div>
          <h2 className={styles.menuTitle}>Solo Play</h2>
          <p className={styles.menuDesc}>Find all words as fast as you can.<br />Time starts when the board loads.</p>

          <div className={styles.difficultySection} style={{ marginTop: 4 }}>
            <p className={styles.difficultyTitle}>🎯 Choose Difficulty</p>
            <div className={styles.difficultyRow}>
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.id}
                  className={`${styles.diffChip} ${soloDifficulty === d.id ? styles.diffChipActive : ''}`}
                  onClick={() => setSoloDifficulty(d.id)}
                >
                  <span>{d.emoji}</span>
                  <span>{d.label}</span>
                  <span className={styles.diffChipGrid}>{d.gridLabel} · {d.wordCount} words</span>
                </button>
              ))}
            </div>
          </div>

          <button className={styles.soloStartBtn} onClick={handleStartSolo}>
            🧩 Start Solo Game
          </button>
          <button className={styles.ghostBtn} onClick={() => setPhase('menu')}>← Back</button>
        </div>
      </div>
    );
  }

  /* ─── GAME BOARD ─── */
  if (phase === 'playing' || phase === 'ended') {
    const claimedCount = words.filter((w) => w.claimedBy !== null).length;
    const totalWords   = words.length;
    const myPlayer     = players.find((p) => p.username === username);

    return (
      <div className={styles.gamePage}>
        {showGuide && (
          <GameGuide
            gameKey="word-puzzle"
            onDone={() => {
              sessionStorage.setItem('guide_word-puzzle', '1');
              setShowGuide(false);
            }}
          />
        )}
        {showCelebration && phase === 'ended' && (
          <WinCelebration
            gameKey="word-puzzle"
            winnerName={endResult ? (endResult[0]?.username ?? '') : ''}
            currentUser={username}
            onClose={() => setShowCelebration(false)}
          />
        )}
        {/* Top bar */}
        <header className={styles.topBar}>
          <button className={styles.homeBtn} onClick={() => {
            stopSoloTimer(); setIsSolo(false);
            router.push('/word-puzzle');
          }} title="Menu">
            <HomeIcon size={16} />
          </button>
          {isSolo && (
            <span className={styles.soloBadge}>🧩 Solo</span>
          )}
          <div className={styles.progressWrap}>
            <div className={styles.progressBar} style={{ width: `${(claimedCount / totalWords) * 100}%` }} />
          </div>
          <span className={styles.progressLabel}>{claimedCount}/{totalWords} found</span>
          {isSolo && (
            <span className={styles.soloTimer}>⏱ {fmtTime(soloElapsed)}</span>
          )}
        </header>

        {/* Main layout */}
        <div className={styles.gameLayout}>

          {/* Left: word list */}
          <aside className={styles.wordList}>
            <p className={styles.wordListTitle}>Words to find</p>
            <div className={styles.wordItems}>
              {words.map((w) => {
                const owner = w.claimedBy ? players.find((p) => p.username === w.claimedBy) : null;
                const color = owner ? PLAYER_COLORS[owner.colorIndex]! : undefined;
                const isDefOpen = definitionPopup?.wordId === w.id;
                return (
                  <div key={w.id} className={styles.wordItemWrapper}>
                    <div
                      className={`${styles.wordItem} ${w.claimedBy ? styles.wordItemClaimed : ''}`}
                      style={color ? { '--word-color': color } as CSSProperties : {}}
                    >
                      <span className={styles.wordItemText}>{w.word}</span>
                      <div className={styles.wordItemActions}>
                        {/* Pronounce button */}
                        <button
                          className={styles.wordActionBtn}
                          onClick={() => handlePronounce(w.word)}
                          title={`Pronounce "${w.word}"`}
                          aria-label={`Pronounce ${w.word}`}
                        >
                          <Volume2 size={12} />
                        </button>
                        {/* Definition button */}
                        <button
                          className={`${styles.wordActionBtn} ${isDefOpen ? styles.wordActionBtnActive : ''}`}
                          onClick={() => handleShowDefinition(w.id, w.word)}
                          title={`Define "${w.word}"`}
                          aria-label={`Show definition of ${w.word}`}
                        >
                          <BookOpen size={12} />
                        </button>
                        {w.claimedBy && (
                          <span className={styles.wordOwner} style={{ color }}>
                            {w.claimedBy === username ? 'You' : w.claimedBy}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Definition popup */}
                    {isDefOpen && (
                      <div className={styles.wordDefPopup}>
                        {definitionPopup?.loading ? (
                          <span className={styles.wordDefLoading}>Loading…</span>
                        ) : (
                          <>
                            <span className={styles.wordDefText}>{definitionPopup?.meaning}</span>
                            <button
                              className={styles.wordDefClose}
                              onClick={() => setDefinitionPopup(null)}
                              aria-label="Close definition"
                            >
                              <X size={10} />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Center: board */}
          <main className={styles.boardWrap}>
            {/* Claim feedback toast */}
            {lastClaim && (
              <div className={`${styles.toast} ${lastClaim.correct ? styles.toastGood : styles.toastBad}`}>
                {lastClaim.correct ? `✓ ${lastClaim.word}!` : '✗ Not a word'}
              </div>
            )}

            <div
              ref={boardRef}
              className={styles.board}
              style={{ '--grid-size': gridSize } as CSSProperties}
              onPointerDown={onBoardPointerDown}
              onPointerMove={onBoardPointerMove}
              onPointerUp={onBoardPointerUp}
              onPointerCancel={() => { selStartRef.current = null; setSelStart(null); setSelEnd(null); }}
            >
              {board.map((row, ri) =>
                row.map((letter, ci) => {
                  const { className, style } = getCellStyle(ri, ci);
                  return (
                    <div
                      key={`${ri}-${ci}`}
                      className={className}
                      style={style}
                      data-row={ri}
                      data-col={ci}
                    >
                      {letter}
                    </div>
                  );
                })
              )}
            </div>
          </main>

          {/* Right: scoreboard */}
          <aside className={styles.scoreboard}>
            <p className={styles.scoreTitle}><Trophy size={13} /> Scores</p>
            {[...players]
              .sort((a, b) => b.score - a.score)
              .map((p, rank) => (
                <div
                  key={p.username}
                  className={`${styles.scoreRow} ${p.username === username ? styles.scoreRowMe : ''}`}
                  style={{ '--p-color': PLAYER_COLORS[p.colorIndex]! } as CSSProperties}
                >
                  <span className={styles.scoreRank}>#{rank + 1}</span>
                  <span className={styles.scoreDot} />
                  <span className={styles.scoreName}>{p.username === username ? 'You' : p.username}</span>
                  <span className={styles.scoreVal}>{p.score}</span>
                </div>
              ))
            }

            {myPlayer && (
              <div className={styles.myScore}>
                <span>Your score</span>
                <strong style={{ color: PLAYER_COLORS[myColorIndex]! }}>{myPlayer.score}</strong>
              </div>
            )}
          </aside>
        </div>

        {/* Game over overlay */}
        {phase === 'ended' && endResult && (
          <div className={styles.overlay}>
            <div className={styles.resultCard}>
              <div className={styles.resultEmoji}>🏆</div>
              <h2 className={styles.resultTitle}>{isSolo ? '🧩 Puzzle Complete!' : 'Game Over!'}</h2>
              {isSolo && (
                <p className={styles.soloFinishTime}>
                  Finished in <strong>{fmtTime(soloElapsed)}</strong>
                </p>
              )}
              <div className={styles.resultList}>
                {endResult.map((p, i) => (
                  <div
                    key={p.username}
                    className={styles.resultRow}
                    style={{ '--p-color': PLAYER_COLORS[p.colorIndex]! } as CSSProperties}
                  >
                    <span className={styles.resultRank}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                    </span>
                    <span className={styles.resultName}>{p.username}</span>
                    <span className={styles.resultScore}>{p.score} pts</span>
                  </div>
                ))}
              </div>
              <div className={styles.resultActions}>
                {isSolo ? (
                  <button className={styles.primaryBtn} onClick={() => {
                    stopSoloTimer();
                    setIsSolo(false);
                    setSoloElapsed(0);
                    setPhase('menu');
                    setBoard([]);
                    setWords([]);
                    setPlayers([]);
                    setGameId(null);
                  }}>
                    Play Again
                  </button>
                ) : rematchWaiting ? (
                  <button className={styles.primaryBtn} disabled>
                    Waiting… ({rematchVotes}/{rematchNeeded})
                  </button>
                ) : rematchError ? (
                  <button className={styles.primaryBtn} onClick={() => {
                    cleanupCall();
                    setPhase('menu');
                    setBoard([]);
                    setWords([]);
                    setPlayers([]);
                    setGameId(null);
                    setChatMessages([]);
                    setUnreadCount(0);
                    setRematchError(null);
                  }}>
                    Back to Menu
                  </button>
                ) : (
                  <button className={styles.primaryBtn} onClick={() => {
                    if (!socket || !gameId) return;
                    socket.emit('wp:rematch', { gameId });
                    setRematchWaiting(true);
                  }}>
                    Play Again
                  </button>
                )}
                {rematchError && <p className={styles.rematchErrorText}>{rematchError}</p>}
                <button className={styles.ghostBtn} onClick={() => { cleanupCall(); stopSoloTimer(); setIsSolo(false); router.push('/'); }}>
                  Game Hub
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Floating call bar ── */}
        {callRoomActive && phase === 'playing' && !isSolo && (
          <div className={`${styles.callFloatingBar} ${amInCall ? styles.callFloatingBarActive : ''}`}>
            <span className={styles.callFloatingIcon}>{amInCall ? <Mic size={18} /> : <Phone size={18} />}</span>
            <div className={styles.callFloatingInfo}>
              {amInCall ? (
                <span className={styles.callFloatingLabel}>
                  Live&nbsp;
                  {callMembers.map((m) => (
                    <span key={m} className={styles.callFloatingMember}>{m === username ? 'you' : m}</span>
                  ))}
                </span>
              ) : (
                <span className={styles.callFloatingLabel}>
                  <strong>{callRoomInitiator}</strong> started a call
                  {callMembers.length > 0 && <> &middot; {callMembers.map((m) => m === username ? 'you' : m).join(', ')} in</>}
                </span>
              )}
              <span className={styles.callFloatingTimer}>{callTimerDisplay}</span>
            </div>
            <div className={styles.callFloatingActions}>
              {!amInCall ? (
                <button className={`${styles.callFloatBtn} ${styles.callFloatBtnJoin}`} onClick={handleJoinCall}>
                  Join{callMembers.length > 0 && <span className={styles.callMemberCount}>{callMembers.length}</span>}
                </button>
              ) : (
                <>
                  <button
                    className={`${styles.callFloatBtn} ${isMuted ? styles.callFloatBtnMuted : ''}`}
                    onClick={handleToggleMute}
                    title={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                  </button>
                  <button className={`${styles.callFloatBtn} ${styles.callFloatBtnLeave}`} onClick={handleLeaveCall} title="Leave call">
                    Leave
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Chat + call panel — hidden in solo mode ── */}
        {!isSolo && (
        <div className={`${styles.wpChatPanel} ${chatOpen ? styles.wpChatOpen : ''}`}>
          {/* Call tab (sits above chat tab) */}
          {phase === 'playing' && (
            <button
              className={`${styles.wpCallTabBtn} ${callRoomActive ? styles.wpCallTabBtnActive : ''}`}
              onClick={callRoomActive ? undefined : handleStartCall}
              disabled={callRoomActive}
              title={callRoomActive ? 'Call in progress' : 'Start voice call'}
            >
              <Phone size={18} />
              {callRoomActive && <span className={styles.wpCallTabDot} />}
            </button>
          )}

          {/* Chat toggle tab */}
          <button className={styles.wpChatToggle} onClick={() => {
            if (!chatOpen) setUnreadCount(0);
            setChatOpen((o) => !o);
          }}>
            <MessageSquare size={20} />
            {!chatOpen && unreadCount > 0 && (
              <span className={styles.wpUnreadBadge}>{unreadCount > 9 ? '9+' : unreadCount}</span>
            )}
          </button>

          {chatOpen && (
            <>
              <div className={styles.wpChatHeader}>
                <span>Chat</span>
                {callMembers.length > 0 && (
                  <span className={styles.wpChatCallIndicator}>
                    <Volume2 size={11} /> {callMembers.length} in call
                  </span>
                )}
              </div>
              <div className={styles.wpChatMessages}>
                {chatMessages.map((msg, idx) => (
                  <div key={idx} className={`${styles.wpChatMessage} ${msg.username === username ? styles.wpChatMessageMine : ''}`}>
                    <strong>{msg.username === username ? 'You' : msg.username}:</strong> {msg.message}
                  </div>
                ))}
              </div>
              {phase === 'playing' && (
                <div className={styles.wpChatInput}>
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                    placeholder="Type a message…"
                  />
                  <button onClick={handleSendChat}>Send</button>
                </div>
              )}
            </>
          )}
        </div>
        )}
      </div>
    );
  }

  return null;
}
