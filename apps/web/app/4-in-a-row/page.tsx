'use client';

import { useEffect, useState, useRef, useMemo, useCallback, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import styles from './game.module.css';
import { BALL_COLORS } from '../room/[code]/page';
import GameGuide from '../../components/GameGuide';
import WinCelebration from '../../components/WinCelebration';
import {
  Volume2, VolumeX, Mic, MicOff, Phone, PhoneOff,
  Users, Trophy, Medal, Home as HomeIcon, Rocket, Hourglass,
  Bomb, ArrowRight, ArrowDown, ArrowUpRight,
  MessageSquare, Clock,
} from 'lucide-react';

const DEFAULT_ROWS = 6;
const DEFAULT_COLS = 7;
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

type Board = number[][];

function emptyBoard(rows: number, cols: number): Board {
  return Array(rows)
    .fill(null)
    .map(() => Array(cols).fill(0));
}

/** Fits cell size + gaps inside width/height so large boards stay on screen (especially phones). */
function computeBoardLayout(
  cols: number,
  rows: number,
  viewportWidth: number,
  viewportHeight: number,
  numPlayers: number = 2
): { cellSize: number; gap: number } {
  const c = Math.max(1, cols);
  const r = Math.max(1, rows);
  const narrow = viewportWidth < 720;
  const multiPlayer = numPlayers > 2;

  // On desktop the left sidebar is 180px; on mobile it collapses to a top bar
  const sidebarW = narrow ? 0 : 180;
  // Reserve space for fixed chat/call tabs on the right
  const chatStrip = narrow ? 58 : 78;
  const outerPad = narrow ? 2 : 10;
  const boardPadding = narrow ? (multiPlayer ? 3 : 4) : 14;

  const maxBoardWidth = Math.max(140, viewportWidth - sidebarW - chatStrip - outerPad * 2);
  const innerW = maxBoardWidth - boardPadding * 2;

  let gap = 4;
  let cellSize = Math.floor((innerW - (c - 1) * gap) / c);
  gap = Math.max(2, Math.min(10, Math.round(cellSize * 0.12)));
  cellSize = Math.floor((innerW - (c - 1) * gap) / c);
  cellSize = Math.max(12, Math.min(narrow ? (multiPlayer ? 116 : 108) : 92, cellSize));
  gap = Math.max(2, Math.min(10, Math.round(cellSize * 0.12)));

  // Reserve space for status banner + hover strip
  const statusReserve = narrow ? (multiPlayer ? 60 : 80) : 100;
  const hoverReserve = Math.min(72, Math.round(cellSize * 1.1) + 16);
  // Use much more of the vertical space on desktop
  const heightFraction = narrow ? (multiPlayer ? 0.86 : 0.78) : (multiPlayer ? 0.72 : 0.67);
  const maxBoardHeight = Math.max(
    160,
    Math.min(viewportHeight * heightFraction, viewportHeight - statusReserve - hoverReserve)
  );
  const innerH = maxBoardHeight - boardPadding * 2 - (r - 1) * gap;
  const byHeight = Math.floor(innerH / r);
  if (byHeight > 0 && byHeight < cellSize) {
    cellSize = Math.max(12, byHeight);
    gap = Math.max(2, Math.min(10, Math.round(cellSize * 0.12)));
  }

  return { cellSize, gap };
}

export default function Home() {
  const router = useRouter();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [username, setUsername] = useState('');
  const [gameId, setGameId] = useState<string | null>(null);
  const [board, setBoard] = useState<Board>(() => emptyBoard(DEFAULT_ROWS, DEFAULT_COLS));
  const [myPlayerNumber, setMyPlayerNumber] = useState<number | null>(null);
  const [currentTurn, setCurrentTurn] = useState(1);
  const [opponent, setOpponent] = useState('');
  const [playerUsernames, setPlayerUsernames] = useState<string[]>([]);
  const [gameStatus, setGameStatus] = useState<'menu' | 'waiting' | 'playing' | 'ended'>('menu');
  const [winner, setWinner] = useState<string | null>(null);
  const [winReason, setWinReason] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [gameMode, setGameMode] = useState<'pvp' | 'bot' | 'friend' | null>(null);
  const [moveCount, setMoveCount] = useState(0);
  /** How many in a row needed to win this game (4 for 2-player, 6 for 3+) */
  const [winStreak, setWinStreak] = useState(4);
  /** Multiplayer ranking: players ranked in order they achieved their streak */
  const [rankings, setRankings] = useState<{ username: string; rank: number }[]>([]);
  /** Brief flash shown when a player ranks out in multiplayer */
  const [rankFlash, setRankFlash] = useState<{ username: string; rank: number } | null>(null);
  
  // Chat states
  const [chatMessages, setChatMessages] = useState<Array<{username: string, message: string, timestamp: Date}>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Call states
  // callRoomActive: true when there's an ongoing call in this game room (we may or may not be in it)
  const [callRoomActive, setCallRoomActive] = useState(false);
  const [callRoomInitiator, setCallRoomInitiator] = useState<string | null>(null);
  const [callMembers, setCallMembers] = useState<string[]>([]); // everyone currently in the call
  const [amInCall, setAmInCall] = useState(false); // is the local player joined?
  const [isMuted, setIsMuted] = useState(false);
  const [mutedUsers, setMutedUsers] = useState<Set<string>>(new Set());
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null); // epoch ms
  const [callTimerDisplay, setCallTimerDisplay] = useState('0:00');
  const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set());
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const callGameIdRef = useRef<string | null>(null); // gameId active when call was started
  const speakingStopFnsRef = useRef<Map<string, () => void>>(new Map());
  
  // Audio states
  const [bgMusicEnabled, setBgMusicEnabled] = useState(false);
  const bgMusicRef = useRef<HTMLAudioElement | null>(null);
  const dropSoundRef = useRef<HTMLAudioElement | null>(null);
  const opponentDropSoundRef = useRef<HTMLAudioElement | null>(null);
  const gameEndSoundRef = useRef<HTMLAudioElement | null>(null);
  const lastMoveSentAt = useRef<number>(0);
  
  // Refs for tracking state in socket event handlers
  const chatOpenRef = useRef(chatOpen);
  const usernameRef = useRef(username);
  const playCallChimeRef = useRef<() => void>(() => {});
  const boardRef = useRef<HTMLDivElement>(null);
  const hoverStripRef = useRef<HTMLDivElement>(null);
  /** Preview disc position in the strip above the board (tracks pointer X, clamped to columns). */
  const [pointerPreview, setPointerPreview] = useState<{ x: number; y: number } | null>(null);
  
  // Keep refs in sync with state
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);
  useEffect(() => { usernameRef.current = username; }, [username]);
  // Modal states
  const [showSpectateModal, setShowSpectateModal] = useState(false);
  const [showFriendModal, setShowFriendModal] = useState(false);
  
  // Play with Friend states
  const [myRoomCode, setMyRoomCode] = useState<string | null>(null);
  const [friendRoomCode, setFriendRoomCode] = useState('');
  const [roomError, setRoomError] = useState<string | null>(null);
  const [isWaitingInRoom, setIsWaitingInRoom] = useState(false);
  const [friendJoinWaiting, setFriendJoinWaiting] = useState(false);
  const [roomMaxPlayers, setRoomMaxPlayers] = useState(2);
  const [friendMaxPlayers, setFriendMaxPlayers] = useState(2);
  const [lobbyPlayers, setLobbyPlayers] = useState<string[]>([]);
  const [codeCopied, setCodeCopied] = useState(false);

  /** Invite / friend games: rematch with same players without a new room code */
  const [invitePartyId, setInvitePartyId] = useState<string | null>(null);
  const [rematchVotes, setRematchVotes] = useState(0);
  const [rematchNeeded, setRematchNeeded] = useState(0);
  const [hasVotedRematch, setHasVotedRematch] = useState(false);
  const [rematchError, setRematchError] = useState('');
  /** username → colorId chosen in the lobby (invite games only); empty = use default slot colours */
  const [playerColorChoices, setPlayerColorChoices] = useState<Record<string, string>>({});
  
  // Character guide / celebration state
  const [showGuide, setShowGuide] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const celebrationShownRef = useRef(false);

  // UI feedback states
  const [usernameShake, setUsernameShake] = useState(false);
  
  // Winning cells state
  const [winningCells, setWinningCells] = useState<Array<{row: number, col: number}>>([]);

  const [viewport, setViewport] = useState({ width: 390, height: 740 });

  useEffect(() => {
    const read = () => {
      const vv = window.visualViewport;
      setViewport({
        width: vv?.width ?? window.innerWidth,
        height: vv?.height ?? window.innerHeight,
      });
    };
    read();
    window.addEventListener('resize', read);
    window.visualViewport?.addEventListener('resize', read);
    window.visualViewport?.addEventListener('scroll', read);
    return () => {
      window.removeEventListener('resize', read);
      window.visualViewport?.removeEventListener('resize', read);
      window.visualViewport?.removeEventListener('scroll', read);
    };
  }, []);

  // ── Call timer ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!callRoomActive || callStartedAt === null) return;
    const fmt = (ms: number) => {
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      return `${m}:${String(s % 60).padStart(2, '0')}`;
    };
    setCallTimerDisplay(fmt(Date.now() - callStartedAt));
    const id = setInterval(() => setCallTimerDisplay(fmt(Date.now() - callStartedAt!)), 1000);
    return () => clearInterval(id);
  }, [callRoomActive, callStartedAt]);

  const boardCols = board[0]?.length ?? DEFAULT_COLS;
  const boardRows = board.length;
  const boardLayout = useMemo(
    () => computeBoardLayout(boardCols, boardRows, viewport.width, viewport.height, playerUsernames.length),
    [boardCols, boardRows, viewport.width, viewport.height, playerUsernames.length]
  );

  const discClasses = useMemo(
    () => [
      styles.player1,
      styles.player2,
      styles.player3,
      styles.player4,
      styles.player5,
      styles.player6,
      styles.player7,
      styles.player8,
    ],
    []
  );

  const floatingClasses = useMemo(
    () => [
      styles.p1Floating,
      styles.p2Floating,
      styles.p3Floating,
      styles.p4Floating,
      styles.p5Floating,
      styles.p6Floating,
      styles.p7Floating,
      styles.p8Floating,
    ],
    []
  );

  useEffect(() => {
    const newSocket = io(API_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('✅ Connected to server');
      setIsConnected(true);
      // If we arrived here from a room lobby, rejoin the existing game socket room
      const reconnectRaw = sessionStorage.getItem('4inarow_reconnectGame');
      if (reconnectRaw) {
        sessionStorage.removeItem('4inarow_reconnectGame');
        try {
          const { gameId, username } = JSON.parse(reconnectRaw) as { gameId: string; username: string };
          newSocket.emit('player:join', { username });
          newSocket.emit('game:reconnect', { gameId, username });
        } catch { /* ignore */ }
      }
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Disconnected from server');
      setIsConnected(false);
    });

    newSocket.on('game:started', (data: {
      gameId: string;
      board?: Board;
      opponent?: string;
      players?: string[];
      playerUsernames?: string[];
      yourPlayerNumber: number;
      yourTurn: boolean;
      isBot: boolean;
      isInviteGame?: boolean;
      partyId?: string;
      winStreak?: number;
      rankings?: { username: string; rank: number }[];
    }) => {
      console.log('🎮 Game started:', data);
      setGameId(data.gameId);
      const names = data.playerUsernames ?? data.players ?? [];
      setPlayerUsernames(names);
      if (names.length === 2) {
        setOpponent(data.opponent ?? names.find((u) => u !== usernameRef.current) ?? '');
      } else {
        setOpponent('');
      }
      setGameStatus('playing');
      setMoveCount(0);
      setWinner(null);
      setWinReason(null);
      setWinningCells([]);
      setBoard(data.board?.length && data.board[0]?.length
        ? data.board
        : emptyBoard(DEFAULT_ROWS, DEFAULT_COLS));
      setShowFriendModal(false);
      setMyRoomCode(null);
      setIsWaitingInRoom(false);
      setFriendJoinWaiting(false);
      setFriendRoomCode('');
      setLobbyPlayers([]);
      setMyPlayerNumber(data.yourPlayerNumber);
      setCurrentTurn(1);
      setWinStreak(data.winStreak ?? 4);
      setRankings(data.rankings ?? []);
      setRankFlash(null);
      if (data.isBot) setGameMode('bot');
      else if (data.isInviteGame) setGameMode('friend');
      else setGameMode('pvp');
      if (data.partyId) setInvitePartyId(data.partyId);
      setHasVotedRematch(false);
      setRematchVotes(0);
      setRematchNeeded(0);
      celebrationShownRef.current = false;
      // Show guide once per session
      if (!sessionStorage.getItem('guide_4-in-a-row')) {
        setShowGuide(true);
      }
      console.log(`✅ Seat ${data.yourPlayerNumber}, isBot: ${data.isBot}`);
    });

    // Received when reconnecting to an existing game (e.g. after navigating from lobby)
    newSocket.on('game:state', (data: {
      gameId: string;
      board: Board;
      currentTurn: number;
      status: string;
      players?: string[];
      playerUsernames?: string[];
      yourPlayerNumber?: number;
      winStreak?: number;
      rankings?: { username: string; rank: number }[];
      partyId?: string;
      isInviteGame?: boolean;
    }) => {
      console.log('🔄 Game state received on reconnect:', data);
      if (data.board?.length) setBoard(data.board);
      setCurrentTurn(data.currentTurn ?? 1);
      const names = data.playerUsernames ?? data.players ?? [];
      if (names.length) {
        setPlayerUsernames(names);
        if (names.length === 2) {
          setOpponent(names.find((u) => u !== usernameRef.current) ?? '');
        }
      }
      if (data.yourPlayerNumber != null) setMyPlayerNumber(data.yourPlayerNumber);
      if (data.winStreak != null) setWinStreak(data.winStreak);
      if (data.rankings) setRankings(data.rankings);
      if (data.partyId) setInvitePartyId(data.partyId);
      if (data.isInviteGame != null) setGameMode(data.isInviteGame ? 'friend' : 'pvp');
    });

    newSocket.on(
      'game:update',
      (data: {
        board?: Board;
        currentTurn?: number;
        playerUsernames?: string[];
        playerLeft?: string;
        lastMove?: { player: string; column: number; row: number };
        rankEvent?: { username: string; rank: number; winningCells?: { row: number; col: number }[] };
        rankings?: { username: string; rank: number }[];
      }) => {
      console.log('📥 Game update:', data);
      if (data.board) {
        setBoard(data.board);
        if (data.lastMove) {
          setMoveCount((prev) => prev + 1);
          if (dropSoundRef.current) {
            dropSoundRef.current.currentTime = 0;
            dropSoundRef.current.play().catch((e: any) => console.log('Drop sound failed:', e));
          }
        }
      }
      if (data.playerUsernames && data.playerUsernames.length > 0) {
        setPlayerUsernames(data.playerUsernames);
        const u = usernameRef.current;
        if (u) {
          const idx = data.playerUsernames.indexOf(u);
          if (idx >= 0) setMyPlayerNumber(idx + 1);
        }
        if (data.playerUsernames.length === 2) {
          setOpponent(data.playerUsernames.find((x) => x !== usernameRef.current) ?? '');
        } else {
          setOpponent('');
        }
      }
      if (data.currentTurn !== undefined) {
        setCurrentTurn(data.currentTurn);
      }
      if (data.rankings) {
        setRankings(data.rankings);
      }
      if (data.rankEvent) {
        // Flash winning cells for ranked-out player, then clear after 2.5s
        if (data.rankEvent.winningCells) {
          setWinningCells(data.rankEvent.winningCells);
          setTimeout(() => setWinningCells([]), 2500);
        }
        setRankFlash(data.rankEvent);
        setTimeout(() => setRankFlash(null), 2500);
        // Play win sound on every rank-out (same sound as game over)
        if (gameEndSoundRef.current) {
          gameEndSoundRef.current.currentTime = 0;
          gameEndSoundRef.current.play().catch((e: any) => console.log('Sound play failed:', e));
        }
      }
    });

    newSocket.on(
      'game:ended',
      (data: {
        winner: string | null;
        reason: string;
        winningCells?: Array<{ row: number; col: number }>;
        partyId?: string;
        canRematch?: boolean;
        rematchPlayers?: string[];
      }) => {
        console.log('🏁 Game ended:', data);
        setGameStatus('ended');
        setWinner(data.winner);
        setWinReason(data.reason);

        if (data.winningCells) {
          setWinningCells(data.winningCells);
        }

        if (data.canRematch && data.partyId) {
          setInvitePartyId(data.partyId);
          setRematchNeeded(data.rematchPlayers?.length ?? 0);
          setRematchVotes(0);
          setHasVotedRematch(false);
        } else {
          setInvitePartyId(null);
          setRematchNeeded(0);
          setRematchVotes(0);
          setHasVotedRematch(false);
        }

        if (gameEndSoundRef.current) {
          gameEndSoundRef.current.currentTime = 0;
          gameEndSoundRef.current.play().catch((e: any) => console.log('Sound play failed:', e));
        }
        // Show celebration popup after a short delay
        if (!celebrationShownRef.current) {
          celebrationShownRef.current = true;
          setTimeout(() => setShowCelebration(true), 800);
        }
      }
    );

    newSocket.on(
      'rematch:progress',
      (data: { votes: number; needed: number; voted?: string[] }) => {
        setRematchVotes(data.votes);
        setRematchNeeded(data.needed);
        const me = usernameRef.current;
        if (me && data.voted?.includes(me)) {
          setHasVotedRematch(true);
        }
      }
    );

    newSocket.on('rematch:error', (data: { message?: string }) => {
      setHasVotedRematch(false);
      setRematchError(data.message ?? 'Rematch failed.');
      setTimeout(() => setRematchError(''), 4000);
    });
    
    // Chat event
    newSocket.on('chat:message', (data: {username: string, message: string}) => {
      setChatMessages(prev => [...prev, {...data, timestamp: new Date()}]);
      // Increment unread count only if chat is closed and message is from opponent
      if (!chatOpenRef.current && data.username !== usernameRef.current) {
        setUnreadCount(prev => prev + 1);
      }
    });

    // ── Call signaling events ─────────────────────────────────────────────
    // Someone started a call in the room — show the floating call bar + play chime
    newSocket.on('call:ringing', (data: { from: string; gameId: string }) => {
      setCallRoomActive(true);
      setCallRoomInitiator(data.from);
      setCallStartedAt(Date.now());
      playCallChimeRef.current();
    });

    // Server tells us who is already in the call (after we join)
    newSocket.on('call:members', (data: { members: string[]; gameId: string }) => {
      setCallMembers((prev) => [...new Set([...prev, ...data.members])]);
    });

    // Another peer joined — existing members must send them an offer
    newSocket.on('call:peer_joined', async (data: { username: string; gameId: string }) => {
      const gid = callGameIdRef.current ?? data.gameId;
      setCallMembers((prev) => [...new Set([...prev, data.username])]);
      const pc = getOrCreatePC(data.username, gid, newSocket);
      // Ensure our local mic tracks are attached before creating the offer
      const localStream = localStreamRef.current;
      if (localStream) {
        localStream.getTracks().forEach((t) => {
          const alreadyAdded = pc.getSenders().some((s) => s.track?.id === t.id);
          if (!alreadyAdded) pc.addTrack(t, localStream);
        });
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      newSocket.emit('call:offer', { to: data.username, offer, gameId: gid });
    });

    // Receive an offer — send back an answer
    newSocket.on('call:offer', async (data: { from: string; offer: RTCSessionDescriptionInit; gameId: string }) => {
      const gid = callGameIdRef.current ?? data.gameId;
      setCallMembers((prev) => [...new Set([...prev, data.from])]);
      const pc = getOrCreatePC(data.from, gid, newSocket);
      // Ensure our local mic tracks are attached before answering
      const localStream = localStreamRef.current;
      if (localStream) {
        localStream.getTracks().forEach((t) => {
          const alreadyAdded = pc.getSenders().some((s) => s.track?.id === t.id);
          if (!alreadyAdded) pc.addTrack(t, localStream);
        });
      }
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      await flushCandidates(data.from);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      newSocket.emit('call:answer', { to: data.from, answer, gameId: gid });
    });

    // Receive an answer — complete the connection
    newSocket.on('call:answer', async (data: { from: string; answer: RTCSessionDescriptionInit }) => {
      const pc = peerConnectionsRef.current.get(data.from);
      if (pc && pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        await flushCandidates(data.from);
      }
    });

    // Receive ICE candidate
    newSocket.on('call:ice', async (data: { from: string; candidate: RTCIceCandidateInit }) => {
      const pc = peerConnectionsRef.current.get(data.from);
      if (pc && pc.remoteDescription) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
      } else {
        const queue = pendingCandidatesRef.current.get(data.from) ?? [];
        queue.push(data.candidate);
        pendingCandidatesRef.current.set(data.from, queue);
      }
    });

    // A peer left the call
    newSocket.on('call:peer_left', (data: { username: string; gameId: string }) => {
      peerConnectionsRef.current.get(data.username)?.close();
      peerConnectionsRef.current.delete(data.username);
      pendingCandidatesRef.current.delete(data.username);
      // Clear their mute state when they leave
      setMutedUsers((prev) => { const n = new Set(prev); n.delete(data.username); return n; });
      setCallMembers((prev) => {
        const next = prev.filter((u) => u !== data.username);
        // If no one is left in the call, close the room
        if (next.length === 0) {
          setCallRoomActive(false);
          setCallRoomInitiator(null);
          setAmInCall(false);
        }
        return next;
      });
    });

    // A peer toggled their mute
    newSocket.on('call:mute', (data: { username: string; muted: boolean }) => {
      setMutedUsers((prev) => {
        const next = new Set(prev);
        data.muted ? next.add(data.username) : next.delete(data.username);
        return next;
      });
    });

    // Private room events
    newSocket.on('room:created', (data: { roomCode: string; maxPlayers?: number; players?: string[] }) => {
      console.log('🏠 Room created:', data.roomCode);
      setMyRoomCode(data.roomCode);
      setRoomMaxPlayers(data.maxPlayers ?? 2);
      setLobbyPlayers(data.players ?? []);
      setIsWaitingInRoom(true);
      setRoomError(null);
    });

    newSocket.on('room:lobbyUpdate', (data: { players: string[]; maxPlayers: number }) => {
      setLobbyPlayers(data.players);
      setRoomMaxPlayers(data.maxPlayers);
    });

    newSocket.on(
      'room:joinPending',
      (data: { roomCode: string; players: string[]; maxPlayers: number }) => {
        setFriendJoinWaiting(true);
        setLobbyPlayers(data.players);
        setRoomMaxPlayers(data.maxPlayers);
        setShowFriendModal(true);
        setIsWaitingInRoom(false);
        setFriendRoomCode(data.roomCode);
        setRoomError(null);
      }
    );

    newSocket.on('room:closed', (data: { reason?: string }) => {
      setRoomError(data.reason ?? 'Lobby closed');
      setIsWaitingInRoom(false);
      setFriendJoinWaiting(false);
      setMyRoomCode(null);
      setLobbyPlayers([]);
      setShowFriendModal(false);
    });

    newSocket.on('room:error', (data: { message: string }) => {
      console.error('❌ Room error:', data.message);
      setRoomError(data.message);
    });

    newSocket.on('game:error', (data) => {
      console.warn('⚠️ Game error:', data.message);
    });

    return () => {
      newSocket.close();
      cleanupCall();
    };
  }, []);
  
  // Initialize audio
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const bgMusic = new Audio('/best_outro.mp3');
      bgMusic.loop = true;
      bgMusic.volume = 0.1;
      bgMusicRef.current = bgMusic;
      
      // Updated drop sound (using reliable local files)
      const dropSound = new Audio('/drop.mp3');
      dropSound.volume = 0.5;
      dropSoundRef.current = dropSound;

      const opponentDropSound = new Audio('/opponent_drop.mp3'); 
      opponentDropSound.volume = 0.5;
      opponentDropSoundRef.current = opponentDropSound;
      
      const gameEndSound = new Audio('/game_end.mp3'); 
      gameEndSound.volume = 0.6;
      gameEndSoundRef.current = gameEndSound;
    }
  }, []);

  // Restore pending game started from the /room/[code] lobby page
  useEffect(() => {
    const raw = sessionStorage.getItem('4inarow_pendingGame');
    if (!raw) return;
    sessionStorage.removeItem('4inarow_pendingGame');
    try {
      const data = JSON.parse(raw) as {
        username: string;
        gameId: string;
        board?: Board;
        rows?: number;
        cols?: number;
        players?: string[];
        playerUsernames?: string[];
        yourPlayerNumber: number;
        isBot: boolean;
        isInviteGame?: boolean;
        partyId?: string;
        winStreak?: number;
        colorChoices?: Record<string, string>;
      };
      const u = data.username;
      if (!u) return;
      setUsername(u);
      sessionStorage.setItem('4inarow_username', u);
      setGameId(data.gameId);
      const names = data.playerUsernames ?? data.players ?? [];
      setPlayerUsernames(names);
      if (data.board?.length) setBoard(data.board);
      setMyPlayerNumber(data.yourPlayerNumber);
      setCurrentTurn(1);
      setWinStreak(data.winStreak ?? 4);
      if (names.length === 2) setOpponent(names.find((n) => n !== u) ?? '');
      setGameStatus('playing');
      setGameMode(data.isInviteGame ? 'friend' : 'pvp');
      if (data.partyId) setInvitePartyId(data.partyId);
      if (data.colorChoices && Object.keys(data.colorChoices).length > 0) {
        setPlayerColorChoices(data.colorChoices);
      }
      setMoveCount(0);
      // Store so the socket useEffect can pick it up once the socket is ready
      sessionStorage.setItem('4inarow_reconnectGame', JSON.stringify({ gameId: data.gameId, username: u }));
    } catch {
      // ignore malformed data
    }
  }, []);
  
  // Control background music
  useEffect(() => {
    if (bgMusicRef.current) {
      if (bgMusicEnabled) {
        bgMusicRef.current.play().catch((e: any) => console.log('Music play failed:', e));
      } else {
        bgMusicRef.current.pause();
      }
    }
  }, [bgMusicEnabled]);

  const handleJoinPvP = () => {
    if (!username.trim()) {
      setUsernameShake(true);
      setTimeout(() => setUsernameShake(false), 500);
      return;
    }
    if (!socket) return;
    
    setGameMode('pvp');
    setGameStatus('waiting');
    socket.emit('player:join', { username });
    socket.emit('matchmaking:join', { username });
  };

  const handleJoinBot = () => {
    if (!username.trim()) {
      setUsernameShake(true);
      setTimeout(() => setUsernameShake(false), 500);
      return;
    }
    if (!socket) return;
    
    setGameMode('bot');
    setGameStatus('waiting');
    socket.emit('player:join', { username });
    socket.emit('matchmaking:join-bot', { username });
  };

  // Play with Friend handlers
  const handlePlayWithFriend = () => {
    if (!username.trim()) {
      setUsernameShake(true);
      setTimeout(() => setUsernameShake(false), 500);
      return;
    }
    setShowFriendModal(true);
    setRoomError(null);
    setFriendRoomCode('');
    setFriendJoinWaiting(false);
    setLobbyPlayers([]);
  };

  const handleCreateRoom = () => {
    if (!username.trim()) return;
    sessionStorage.setItem('4inarow_username', username.trim());
    sessionStorage.setItem('4inarow_createRoom', '1');
    router.push('/room/new');
  };

  const handleJoinRoom = () => {
    if (!socket || !friendRoomCode.trim()) return;
    setRoomError(null);
    setGameMode('friend');
    sessionStorage.setItem('4inarow_username', username.trim());
    socket.emit('player:join', { username });
    router.push(`/room/${friendRoomCode.trim().toUpperCase()}`);
  };

  const handleCancelRoom = () => {
    if (!socket) return;
    socket.emit('room:leave');
    setMyRoomCode(null);
    setIsWaitingInRoom(false);
    setShowFriendModal(false);
    setFriendRoomCode('');
    setRoomError(null);
    setLobbyPlayers([]);
    setFriendJoinWaiting(false);
  };

  const handleCloseFriendModal = () => {
    if ((isWaitingInRoom || friendJoinWaiting) && socket) {
      socket.emit('room:leave');
    }
    setShowFriendModal(false);
    setMyRoomCode(null);
    setIsWaitingInRoom(false);
    setFriendRoomCode('');
    setRoomError(null);
    setLobbyPlayers([]);
    setFriendJoinWaiting(false);
  };

  const handleColumnClick = (col: number) => {
    if (!gameId || !socket || !myPlayerNumber) return;
    if (winner) return; // game is over — nobody moves after a win
    if (iAmRankedOut) return; // this player has already achieved their streak
    if (currentTurn !== myPlayerNumber) {
      console.log('⏳ Not your turn');
      return;
    }
    if (board[0]?.[col] !== 0) {
      console.log('❌ Column is full');
      return;
    }
    // Debounce: ignore duplicate clicks within 300 ms (hover strip + cell both fire)
    const now = Date.now();
    if (now - lastMoveSentAt.current < 300) return;
    lastMoveSentAt.current = now;

    console.log(`🎯 Making move: column ${col}`);
    socket.emit('game:move', { gameId, column: col });
  };

  const resetToMainMenu = () => {
    setGameStatus('menu');
    setBoard(emptyBoard(DEFAULT_ROWS, DEFAULT_COLS));
    setWinner(null);
    setWinReason(null);
    setGameId(null);
    setMyPlayerNumber(null);
    setCurrentTurn(1);
    setGameMode(null);
    setMoveCount(0);
    setChatMessages([]);
    setUnreadCount(0);
    setWinningCells([]);
    setPlayerUsernames([]);
    setOpponent('');
    setLobbyPlayers([]);
    setFriendJoinWaiting(false);
    setRoomMaxPlayers(2);
    setInvitePartyId(null);
    setRematchVotes(0);
    setRematchNeeded(0);
    setHasVotedRematch(false);
    setRematchError('');
    setWinStreak(4);
    setRankings([]);
    setRankFlash(null);
    cleanupCall();
  };

  const handlePlayAgain = () => {
    if (invitePartyId && socket && gameMode === 'friend') {
      // Rematch with same party (invite flow)
      socket.emit('party:rematch', { partyId: invitePartyId });
      setHasVotedRematch(true);
      return;
    }
    if (gameMode === 'friend') {
      // Room-started game: send host back to create a new room, others to join
      const savedUsername = username;
      resetToMainMenu();
      sessionStorage.setItem('4inarow_username', savedUsername);
      sessionStorage.setItem('4inarow_createRoom', '1');
      window.location.href = '/room/new';
      return;
    }
    resetToMainMenu();
  };

  const handleLeaveToMenu = () => {
    resetToMainMenu();
  };
  
  const handleSendChat = () => {
    if (!chatInput.trim() || !socket || !gameId) return;

    socket.emit('chat:send', { gameId, username, message: chatInput });
    setChatInput('');
  };

  // ── WebRTC call helpers ───────────────────────────────────────────────────
  const STUN_SERVERS: RTCConfiguration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  };

  /** Start polling an audio stream's volume to detect when a user is speaking.
   *  Returns a cleanup function that stops the polling. */
  const startSpeakDetection = useCallback((user: string, stream: MediaStream) => {
    // Stop any existing detector for this user
    speakingStopFnsRef.current.get(user)?.();

    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const THRESHOLD = 18; // 0-255 RMS threshold
      let speaking = false;

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const rms = data.reduce((s, v) => s + v, 0) / data.length;
        const nowSpeaking = rms > THRESHOLD;
        if (nowSpeaking !== speaking) {
          speaking = nowSpeaking;
          setSpeakingUsers((prev) => {
            const next = new Set(prev);
            nowSpeaking ? next.add(user) : next.delete(user);
            return next;
          });
        }
      };

      const interval = setInterval(tick, 80);
      const stop = () => {
        clearInterval(interval);
        ctx.close().catch(() => {});
        setSpeakingUsers((prev) => { const n = new Set(prev); n.delete(user); return n; });
      };
      speakingStopFnsRef.current.set(user, stop);
      return stop;
    } catch {
      return () => {};
    }
  }, []);

  /** Create or retrieve a peer connection for a given remote username. */
  const getOrCreatePC = useCallback(
    (remoteUser: string, gid: string, sock: Socket): RTCPeerConnection => {
      if (peerConnectionsRef.current.has(remoteUser)) {
        return peerConnectionsRef.current.get(remoteUser)!;
      }
      const pc = new RTCPeerConnection(STUN_SERVERS);

      // NOTE: local tracks are added separately after mic is acquired — NOT here,
      // because this function may be called before getUserMedia resolves.

      // Play remote audio when tracks arrive
      pc.ontrack = (ev) => {
        // Prefer the first full stream; fall back to a new one if missing
        const remoteStream = ev.streams[0] ?? new MediaStream([ev.track]);
        const audio = document.createElement('audio');
        audio.srcObject = remoteStream;
        audio.autoplay = true;
        // Mute-prevention: some browsers block autoplay without user gesture;
        // we try to play() explicitly and ignore errors.
        audio.play().catch(() => {});
        document.body.appendChild(audio);
        // Detect when this remote peer is speaking
        startSpeakDetection(remoteUser, remoteStream);
        pc.addEventListener('connectionstatechange', () => {
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
            audio.pause();
            audio.srcObject = null;
            audio.remove();
            speakingStopFnsRef.current.get(remoteUser)?.();
            speakingStopFnsRef.current.delete(remoteUser);
          }
        });
      };

      // Send ICE candidates
      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sock.emit('call:ice', { to: remoteUser, candidate: ev.candidate.toJSON(), gameId: gid });
        }
      };

      peerConnectionsRef.current.set(remoteUser, pc);
      pendingCandidatesRef.current.set(remoteUser, []);
      return pc;
    },
    []
  );

  /** Flush any ICE candidates that arrived before remote description was set. */
  const flushCandidates = useCallback(async (remoteUser: string) => {
    const pc = peerConnectionsRef.current.get(remoteUser);
    const queue = pendingCandidatesRef.current.get(remoteUser) ?? [];
    pendingCandidatesRef.current.set(remoteUser, []);
    for (const c of queue) {
      try { await pc?.addIceCandidate(new RTCIceCandidate(c)); } catch {}
    }
  }, []);

  /** Tear down all peer connections and release mic. */
  /** Two-tone chime played for everyone when a call starts. */
  const playCallChime = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);

      // First tone
      const o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.setValueAtTime(880, ctx.currentTime);
      o1.connect(gain);
      o1.start(ctx.currentTime);
      o1.stop(ctx.currentTime + 0.35);

      // Second tone (slightly higher, delayed)
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.setValueAtTime(1320, ctx.currentTime + 0.18);
      o2.connect(gain);
      o2.start(ctx.currentTime + 0.18);
      o2.stop(ctx.currentTime + 0.7);
    } catch {}
  }, []);
  // Keep ref in sync so socket event handlers (closed over at mount) can call it
  useEffect(() => { playCallChimeRef.current = playCallChime; }, [playCallChime]);

  const cleanupCall = useCallback(() => {
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    callGameIdRef.current = null;
    // Stop all speak detectors
    speakingStopFnsRef.current.forEach((stop) => stop());
    speakingStopFnsRef.current.clear();
    setSpeakingUsers(new Set());
    setMutedUsers(new Set());
    setCallRoomActive(false);
    setCallRoomInitiator(null);
    setCallMembers([]);
    setAmInCall(false);
    setIsMuted(false);
    setCallStartedAt(null);
    setCallTimerDisplay('0:00');
  }, []);

  /** Initiate a call — broadcast ring to room, then join yourself. */
  const handleStartCall = useCallback(async () => {
    if (!socket || !gameId || callRoomActive) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      callGameIdRef.current = gameId;
      startSpeakDetection(username, stream);
      socket.emit('call:start', { gameId });
      socket.emit('call:join', { gameId });
      const now = Date.now();
      setCallRoomActive(true);
      setCallRoomInitiator(username);
      setCallMembers([username]);
      setAmInCall(true);
      setCallStartedAt(now);
      playCallChime();
    } catch {
      alert('Microphone access is required for calls.');
    }
  }, [socket, gameId, callRoomActive, username, playCallChime, startSpeakDetection]);

  /** Join an ongoing call. */
  const handleJoinCall = useCallback(async () => {
    if (!socket || !gameId || amInCall) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      callGameIdRef.current = gameId;
      startSpeakDetection(username, stream);
      // Add local tracks to any peer connections that were created before the stream
      // was available (e.g. if we received an offer before mic was ready).
      peerConnectionsRef.current.forEach((pc) => {
        stream.getTracks().forEach((t) => {
          const alreadyAdded = pc.getSenders().some((s) => s.track?.id === t.id);
          if (!alreadyAdded) pc.addTrack(t, stream);
        });
      });
      socket.emit('call:join', { gameId });
      setAmInCall(true);
    } catch {
      alert('Microphone access is required for calls.');
    }
  }, [socket, gameId, amInCall, username, startSpeakDetection]);

  /** Leave the ongoing call (but the call room stays open for others). */
  const handleLeaveCall = useCallback(() => {
    if (!socket || !callGameIdRef.current) return;
    socket.emit('call:leave', { gameId: callGameIdRef.current });
    // Tear down local WebRTC connections
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    callGameIdRef.current = null;
    // Stop all speak detectors (local + any remaining remote)
    speakingStopFnsRef.current.forEach((stop) => stop());
    speakingStopFnsRef.current.clear();
    setSpeakingUsers(new Set());
    setMutedUsers(new Set());
    setAmInCall(false);
    setIsMuted(false);
    setCallMembers((prev) => {
      const next = prev.filter((u) => u !== username);
      // If no one else is left, close the whole call room
      if (next.length === 0) {
        setCallRoomActive(false);
        setCallRoomInitiator(null);
        setCallStartedAt(null);
        setCallTimerDisplay('0:00');
      }
      return next;
    });
  }, [socket, username]);

  /** Toggle mic mute. */
  const handleToggleMute = useCallback(() => {
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsMuted((m) => {
      const nowMuted = !m;
      // Broadcast mute state to other call participants
      if (socket && callGameIdRef.current) {
        socket.emit('call:mute', { gameId: callGameIdRef.current, muted: nowMuted });
      }
      // Update own entry in mutedUsers
      setMutedUsers((prev) => {
        const next = new Set(prev);
        nowMuted ? next.add(username) : next.delete(username);
        return next;
      });
      return nowMuted;
    });
  }, [socket, username]);

  const getCellClass = (value: number) => {
    if (value >= 1 && value <= 8) return discClasses[value - 1];
    return '';
  };

  /** Returns an inline style override when the player picked a custom color in the lobby. */
  const getDiscColorStyle = useCallback((playerNumber: number): CSSProperties | undefined => {
    if (!playerColorChoices || Object.keys(playerColorChoices).length === 0) return undefined;
    const playerName = playerUsernames[playerNumber - 1];
    if (!playerName) return undefined;
    const colorId = playerColorChoices[playerName];
    if (!colorId) return undefined;
    const ballColor = BALL_COLORS.find((c) => c.id === colorId);
    if (!ballColor) return undefined;
    return { background: ballColor.bg, borderColor: ballColor.border, borderWidth: 3, borderStyle: 'solid', boxSizing: 'border-box' };
  }, [playerColorChoices, playerUsernames]);

  const getFloatingClass = () => {
    if (myPlayerNumber !== null && myPlayerNumber >= 1 && myPlayerNumber <= 8) {
      return floatingClasses[myPlayerNumber - 1];
    }
    return styles.p1Floating;
  };

  const getFloatingColorStyle = useCallback((): CSSProperties | undefined => {
    if (myPlayerNumber === null) return undefined;
    return getDiscColorStyle(myPlayerNumber);
  }, [myPlayerNumber, getDiscColorStyle]);

  const turnPlayerName =
    playerUsernames.length > 0 && currentTurn >= 1 && currentTurn <= playerUsernames.length
      ? playerUsernames[currentTurn - 1]
      : '…';

  const iAmRankedOut = rankings.some((r) => r.username === username);
  const isMyTurn = myPlayerNumber !== null && myPlayerNumber === currentTurn && !iAmRankedOut;
  const iAmWinner = winner === username;
  const isDraw = winReason === 'draw';

  const columnFromClientX = useCallback((clientX: number): number | null => {
    const board = boardRef.current;
    if (!board) return null;
    const firstRow = board.querySelector('[data-board-row="0"]');
    if (!firstRow) return null;
    const cells = Array.from(firstRow.querySelectorAll<HTMLElement>('[data-col]'));
    if (!cells.length) return null;
    for (const cell of cells) {
      const r = cell.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) {
        return Number(cell.dataset.col);
      }
    }
    let best = 0;
    let bestD = Infinity;
    for (const cell of cells) {
      const r = cell.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const d = Math.abs(clientX - cx);
      if (d < bestD) {
        bestD = d;
        best = Number(cell.dataset.col);
      }
    }
    return best;
  }, []);

  const handleBoardPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (gameStatus !== 'playing' || !isMyTurn || winner) {
        setPointerPreview(null);
        return;
      }
      const board = boardRef.current;
      const strip = hoverStripRef.current;
      if (!board) return;
      const br = board.getBoundingClientRect();
      const sr = strip?.getBoundingClientRect();
      const left = sr ? Math.min(sr.left, br.left) : br.left;
      const right = sr ? Math.max(sr.right, br.right) : br.right;
      const top = sr ? sr.top : br.top;
      const bottom = br.bottom;
      if (
        e.clientX < left ||
        e.clientX > right ||
        e.clientY < top ||
        e.clientY > bottom
      ) {
        setPointerPreview(null);
        return;
      }
      if (!strip) return;
      const stripR = strip.getBoundingClientRect();
      const firstRow = board.querySelector('[data-board-row="0"]');
      if (!firstRow) return;
      const cells = Array.from(firstRow.querySelectorAll<HTMLElement>('[data-col]'));
      const firstEl = cells[0];
      const lastEl = cells[cells.length - 1];
      if (!firstEl || !lastEl) return;
      const first = firstEl.getBoundingClientRect();
      const last = lastEl.getBoundingClientRect();
      const discPx = Math.min(72, boardLayout.cellSize * 0.85);
      let x = e.clientX - stripR.left;
      x = Math.max(first.left - stripR.left, Math.min(last.right - stripR.left, x));
      const y = stripR.height / 2 - discPx / 2;
      setPointerPreview({ x, y });
    },
    [gameStatus, isMyTurn, winner, boardLayout.cellSize]
  );

  const handleBoardPointerLeave = useCallback(() => {
    setPointerPreview(null);
  }, []);

  useEffect(() => {
    if (gameStatus !== 'playing') {
      setPointerPreview(null);
    }
  }, [gameStatus]);

  const getWinReasonText = () => {
    if (isDraw) return 'Board Full - Draw!';
    switch (winReason) {
      case 'horizontal': return <><ArrowRight size={14} style={{verticalAlign:'middle',marginRight:4}}/>Horizontal Win!</>;
      case 'vertical': return <><ArrowDown size={14} style={{verticalAlign:'middle',marginRight:4}}/>Vertical Win!</>;
      case 'diagonal': return <><ArrowUpRight size={14} style={{verticalAlign:'middle',marginRight:4}}/>Diagonal Win!</>;
      case 'forfeit': return 'Opponent Forfeited';
      case 'opponent_disconnect': return 'Opponent Disconnected';
      default: return '';
    }
  };

  const endGameHeadline = () => {
    if (winner === username) return 'YOU WIN!';
    if (winner) return `${winner} WINS!`;
    return 'DRAW!';
  };

  return (
    <div className={styles.container}>
      {/* Sidebar */}
      <div
        className={`${styles.sidebar} ${playerUsernames.length > 2 ? styles.sidebarWide : ''}`}
      >
        {playerUsernames.length > 2 ? (
          <>
            <p className={styles.friendSectionTitle} style={{ marginBottom: 8 }}>
              Players
            </p>
            <div className={styles.playersRoster}>
              {playerUsernames.map((name, i) => {
                const playerRank = rankings.find((r) => r.username === name)?.rank;
                const rankEmoji = playerRank === 1 ? <Medal size={14} color="#ffd700" /> : playerRank === 2 ? <Medal size={14} color="#c0c0c0" /> : playerRank === 3 ? <Medal size={14} color="#cd7f32" /> : playerRank ? `#${playerRank}` : null;
                const isRankedOut = playerRank != null;
                return (
                  <div key={`${name}-${i}`} className={`${styles.rosterRow} ${isRankedOut ? styles.rosterRankedOut : ''} ${speakingUsers.has(name) ? styles.rosterRowSpeaking : mutedUsers.has(name) ? styles.rosterRowMuted : ''}`}>
                    <span className={`${styles.rosterSwatch} ${discClasses[i] ?? ''}`} style={getDiscColorStyle(i + 1)} />
                    <span
                      className={`${styles.playerName} ${
                        currentTurn === i + 1 && !isRankedOut ? styles.rosterCurrent : ''
                      }`}
                    >
                      {name}
                      {name === username ? ' (you)' : ''}
                    </span>
                    {rankEmoji && <span className={styles.rankBadge}>{rankEmoji}</span>}
                    {speakingUsers.has(name) && <span className={styles.speakingIcon}><Volume2 size={13} /></span>}
                    {mutedUsers.has(name) && !speakingUsers.has(name) && <span className={styles.mutedIcon}><MicOff size={13} /></span>}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className={styles.playersRoster}>
            <div className={`${styles.rosterRow} ${speakingUsers.has(opponent ?? '') ? styles.rosterRowSpeaking : mutedUsers.has(opponent ?? '') ? styles.rosterRowMuted : ''}`}>
              <span className={`${styles.rosterSwatch} ${styles.p2DiscPreview}`} style={getDiscColorStyle(2)} />
              <span className={`${styles.playerName} ${currentTurn === 2 ? styles.rosterCurrent : ''}`}>
                {opponent || 'Waiting...'}
              </span>
              {speakingUsers.has(opponent ?? '') && <span className={styles.speakingIcon}><Volume2 size={13} /></span>}
              {mutedUsers.has(opponent ?? '') && !speakingUsers.has(opponent ?? '') && <span className={styles.mutedIcon}><MicOff size={13} /></span>}
            </div>
            <div className={`${styles.rosterRow} ${speakingUsers.has(username) ? styles.rosterRowSpeaking : mutedUsers.has(username) ? styles.rosterRowMuted : ''}`}>
              <span className={`${styles.rosterSwatch} ${styles.p1DiscPreview}`} style={getDiscColorStyle(1)} />
              <span className={`${styles.playerName} ${currentTurn === 1 ? styles.rosterCurrent : ''}`}>
                {username || 'Player'} (You)
              </span>
              {speakingUsers.has(username) && <span className={styles.speakingIcon}><Volume2 size={13} /></span>}
              {mutedUsers.has(username) && !speakingUsers.has(username) && <span className={styles.mutedIcon}><MicOff size={13} /></span>}
            </div>
          </div>
        )}

        <div className={styles.sidebarFooter}>
          <button 
            className={styles.spectateButton} 
            onClick={() => setBgMusicEnabled(!bgMusicEnabled)}
            title={bgMusicEnabled ? 'Mute Music' : 'Play Music'}
          >
             {bgMusicEnabled ? <><Volume2 size={14} style={{verticalAlign:'middle',marginRight:5}}/>Sound On</> : <><VolumeX size={14} style={{verticalAlign:'middle',marginRight:5}}/>Sound Off</>}
          </button>
        </div>
      </div>

      {/* Main Game Area */}
      <div className={styles.mainArea}>
        {gameStatus === 'menu' ? (
           <div className={styles.menuOverlay}>
            <h1 className={styles.title}>4 in a Row</h1>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter Username"
              className={`${styles.input} ${usernameShake ? styles.inputShake : ''}`}
            />
             <div className={styles.buttonGroup}>
              <button onClick={handleJoinPvP} className={styles.button}>Find Player</button>
              <button onClick={handleJoinBot} className={`${styles.button} ${styles.buttonSecondary}`}>Play Bot</button>
            </div>
            <button onClick={handlePlayWithFriend} className={`${styles.button} ${styles.buttonFriend}`}><Users size={15} style={{verticalAlign:'middle',marginRight:6}}/>Play with Friend</button>
           </div>
        ) : (
          <>
            {/* Status / Move Info */}
            
            {/* Joining Overlay */}
            {gameStatus === 'waiting' && (
               <div className={styles.modalOverlay}>
                 <div className={styles.modalContent}>
                    <div className={styles.modalIcon}><Clock size={40} /></div>
                    <h2 className={styles.modalTitle}>Joining...</h2>
                    <p className={styles.modalSubtitle}>Looking for {gameMode === 'bot' ? 'a bot opponent' : 'another player'}</p>
                 </div>
               </div>
            )}

            {/* Game Board Wrapper */}
            <div
              className={`${styles.boardWrapper} ${gameStatus === 'playing' || gameStatus === 'ended' ? styles.boardScale : ''}`}
              style={
                {
                  ['--cell-size']: `${boardLayout.cellSize}px`,
                  ['--board-gap']: `${boardLayout.gap}px`,
                } as CSSProperties
              }
            >
               {gameStatus === 'playing' && (
                 <div className={styles.turnLineSimple}>
                   <span className={styles.turnLineText}>
                     {iAmRankedOut
                       ? `You are rank #${rankings.find((r) => r.username === username)?.rank ?? '?'}`
                       : turnPlayerName === '…' ? '…' : isMyTurn ? 'Your turn' : `${turnPlayerName}'s turn`}
                   </span>
                   {!iAmRankedOut && (
                     <div
                       className={`${styles.turnIndicatorDisc} ${
                         currentTurn >= 1 && currentTurn <= 8
                           ? discClasses[currentTurn - 1]
                           : styles.p1DiscPreview
                       }`}
                       style={getDiscColorStyle(currentTurn)}
                       aria-hidden
                     />
                   )}
                 </div>
               )}

               {/* Rank flash — briefly shown when a player achieves their streak in multiplayer */}
               {rankFlash && (
                 <div className={styles.rankFlashBanner}>
                   <span className={styles.rankFlashEmoji}>
                     {rankFlash.rank === 1 ? <Medal size={18} color="#ffd700" /> : rankFlash.rank === 2 ? <Medal size={18} color="#c0c0c0" /> : rankFlash.rank === 3 ? <Medal size={18} color="#cd7f32" /> : `#${rankFlash.rank}`}
                   </span>
                   <span className={styles.rankFlashText}>
                     {rankFlash.username === username ? 'You' : rankFlash.username} ranked #{rankFlash.rank}!
                   </span>
                 </div>
               )}

               {gameStatus === 'ended' && (
                 <div className={styles.statusBanner}>
                   <div className={styles.statusTop}>
                     <span className={styles.statusIcon}><Trophy size={22} /></span>
                     <span className={styles.statusText}>{endGameHeadline()}</span>
                     <span className={styles.statusSubtext}>{getWinReasonText()}</span>
                   </div>
                   <div className={styles.statusActions}>
                     {gameMode === 'friend' ? (
                       <>
                         <button
                           type="button"
                           onClick={handlePlayAgain}
                           className={styles.playAgainBtn}
                           disabled={hasVotedRematch}
                         >
                           {hasVotedRematch
                             ? `${rematchVotes}/${rematchNeeded} ready… (auto-starts in 30s)`
                             : 'Play Again'}
                         </button>
                         <button
                           type="button"
                           onClick={handleLeaveToMenu}
                           className={`${styles.playAgainBtn} ${styles.leaveBtn}`}
                         >
                           Leave
                         </button>
                         {rematchError && (
                           <span className={styles.statusSubtext} style={{ color: '#f87171', width: '100%', textAlign: 'center' }}>
                             {rematchError}
                           </span>
                         )}
                       </>
                     ) : (
                       <button type="button" onClick={handlePlayAgain} className={styles.playAgainBtn}>
                         Play Again
                       </button>
                     )}
                   </div>
                 </div>
               )}

               {/* Preview strip sits above the wood frame; disc is not inside .board */}
               <div
                 className={styles.boardPlayArea}
                 onPointerMove={handleBoardPointerMove}
                 onPointerLeave={handleBoardPointerLeave}
               >
                 {gameStatus === 'playing' && (
                   <div
                     ref={hoverStripRef}
                     className={styles.hoverStripOutside}
                     onPointerDown={(e) => {
                       e.preventDefault();
                       if (gameStatus !== 'playing' || !isMyTurn || winner) return;
                       const col = columnFromClientX(e.clientX);
                       if (col !== null) handleColumnClick(col);
                     }}
                     aria-hidden
                   >
                     {pointerPreview && isMyTurn && !winner && (
                       <div
                         className={`${styles.floatingDisc} ${styles.floatingDiscFollow} ${getFloatingClass()}`}
                         style={{
                           left: pointerPreview.x,
                           top: pointerPreview.y,
                           ...getFloatingColorStyle(),
                         }}
                       />
                     )}
                   </div>
                 )}
                 <div ref={boardRef} className={styles.board}>
                   {board.map((row, rowIndex) => (
                     <div key={rowIndex} className={styles.row} data-board-row={rowIndex}>
                       {row.map((cell, colIndex) => {
                         const isWinningCell = winningCells.some(
                           (wc) => wc.row === rowIndex && wc.col === colIndex
                         );
                         return (
                           <div
                             key={colIndex}
                             className={styles.cell}
                             data-col={colIndex}
                             onClick={() => {
                              if (gameStatus !== 'playing' || !isMyTurn || winner) return;
                              handleColumnClick(colIndex);
                            }}
                           >
                             <div className={styles.hole}>
                               {cell !== 0 && (
                                 <div
                                   className={`${styles.disc} ${getCellClass(cell)} ${isWinningCell ? styles.winningDisc : ''}`}
                                   style={getDiscColorStyle(cell)}
                                 />
                               )}
                             </div>
                           </div>
                         );
                       })}
                     </div>
                   ))}
                 </div>
               </div>
            </div>
          </>
        )}
      </div>

      {/* ── Floating Call Bar — visible above game whenever a call is active ─── */}
      {callRoomActive && gameStatus === 'playing' && (
        <div className={`${styles.callFloatingBar} ${amInCall ? styles.callFloatingBarActive : ''}`}>
          <span className={styles.callFloatingIcon}>{amInCall ? <Mic size={18} /> : <Phone size={18} />}</span>
          <div className={styles.callFloatingInfo}>
            {amInCall ? (
              <span className={styles.callFloatingLabel}>
                Live&nbsp;
                {callMembers.map((m) => (
                  <span key={m} className={styles.callFloatingMember}>
                    {m === username ? 'you' : m}
                  </span>
                ))}
              </span>
            ) : (
              <span className={styles.callFloatingLabel}>
                <strong>{callRoomInitiator}</strong> started a call
                {callMembers.length > 0 && (
                  <> &middot; {callMembers.map((m) => m === username ? 'you' : m).join(', ')} in</>
                )}
              </span>
            )}
            <span className={styles.callFloatingTimer}>{callTimerDisplay}</span>
          </div>
          <div className={styles.callFloatingActions}>
            {!amInCall ? (
              <button className={`${styles.callFloatBtn} ${styles.callFloatBtnJoin}`} onClick={handleJoinCall}>
                Join{callMembers.length > 0 && (
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
                  {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
                <button
                  className={`${styles.callFloatBtn} ${styles.callFloatBtnLeave}`}
                  onClick={handleLeaveCall}
                  title="Leave call"
                >
                  Leave
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Chat Panel — only for real-player games (not bot, not idle) */}
      {(gameMode === 'friend' || gameMode === 'pvp') && (
      <div className={`${styles.chatPanel} ${chatOpen ? styles.chatOpen : ''}`}>
        {/* Standalone call tab — sits above the chat tab on the right side */}
        {gameStatus === 'playing' && (
          <button
            className={`${styles.callTabBtn} ${callRoomActive ? styles.callTabBtnDisabled : ''}`}
            onClick={callRoomActive ? undefined : handleStartCall}
            disabled={callRoomActive}
            title={callRoomActive ? 'Call already in progress' : 'Start voice call'}
          >
            <span className={styles.callTabBtnInner}>
              {<Phone size={18} />}
              {callRoomActive && <span className={styles.callTabBtnCross}>✕</span>}
            </span>
          </button>
        )}

        <button className={styles.chatToggle} onClick={() => {
          if (!chatOpen) {
            setUnreadCount(0); // Reset unread count when opening chat
          }
          setChatOpen(!chatOpen);
        }}>
          <MessageSquare size={20} />
          {!chatOpen && unreadCount > 0 && (
            <span className={styles.unreadBadge}>{unreadCount > 9 ? '9+' : unreadCount}</span>
          )}
        </button>
        
        {chatOpen && (
          <>
            <div className={styles.chatHeader}>
              <span>Chat</span>
            </div>
            <div className={styles.chatMessages}>
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={styles.chatMessage}>
                  <strong>{msg.username}:</strong> {msg.message}
                </div>
              ))}
            </div>
            {gameStatus === 'playing' && (
              <div className={styles.chatInput}>
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendChat()}
                  placeholder="Type a message..."
                />
                <button onClick={handleSendChat}>Send</button>
              </div>
            )}
          </>
        )}
      </div>
      )}

      {/* Spectate Confirmation Modal */}
      {showSpectateModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
             <button className={styles.closeButton} onClick={() => setShowSpectateModal(false)}>×</button>
             <div className={styles.modalIcon}><Bomb size={40} /></div>
             <p className={styles.modalText}>Do you wish to leave the game and become a spectator?</p>
             <div className={styles.modalActions}>
                <button className={`${styles.modalButton} ${styles.confirmBtn}`} onClick={() => {
                   // Implement spectate logic (essentially verify strict spectator mode or just close modal for now as placeholder unless strictly required logic)
                   // For now, simple close as specific logic wasn't fully detailed beyond UI
                   setShowSpectateModal(false);
                   alert('Spectator mode coming soon!');
                }}>Spectate</button>
                <button className={`${styles.modalButton} ${styles.cancelBtn}`} onClick={() => setShowSpectateModal(false)}>Cancel</button>
             </div>
          </div>
        </div>
      )}

      {/* Play with Friend Modal */}
      {showFriendModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <button className={styles.closeButton} onClick={handleCloseFriendModal}>×</button>
            <div className={styles.modalIcon}><Users size={40} /></div>
            <h2 className={styles.modalTitle}>Play with Friends</h2>
            
            <div className={styles.friendSection}>
                <p className={styles.friendSectionTitle}>Create a Room</p>
                <p style={{ color: '#a0a0cc', fontSize: '0.82rem', margin: 0, textAlign: 'center' }}>
                  You&apos;ll be taken to a lobby. Share the link with friends — no player limit to set.
                </p>
                <button className={`${styles.button} ${styles.buttonFriend}`} onClick={handleCreateRoom}>
                  <HomeIcon size={15} style={{verticalAlign:'middle',marginRight:6}}/>Create Room
                </button>
              </div>

              <div className={styles.friendDivider}>
                <span>OR</span>
              </div>

              <div className={`${styles.friendSection} ${styles.friendSectionJoin}`}>
                <p className={styles.friendSectionTitle}>Join a Room</p>
                <input
                  type="text"
                  value={friendRoomCode}
                  onChange={(e) => setFriendRoomCode(e.target.value.toUpperCase())}
                  placeholder="Code"
                  className={styles.roomCodeInput}
                  maxLength={6}
                />
                <button
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={handleJoinRoom}
                  disabled={!friendRoomCode.trim()}
                >
                  <Rocket size={15} style={{verticalAlign:'middle',marginRight:6}}/>Join Room
                </button>
              </div>

              {roomError && (
                <p className={styles.roomError}>{roomError}</p>
              )}
          </div>
        </div>
      )}

      {/* Character game guide — shown once per session */}
      {showGuide && (
        <GameGuide
          gameKey="4-in-a-row"
          onDone={() => {
            sessionStorage.setItem('guide_4-in-a-row', '1');
            setShowGuide(false);
          }}
        />
      )}

      {/* Win / end celebration popup */}
      {showCelebration && gameStatus === 'ended' && (
        <WinCelebration
          gameKey="4-in-a-row"
          winnerName={winner ?? ''}
          currentUser={username}
          onClose={() => setShowCelebration(false)}
        />
      )}

    </div>
  );
}
