import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  GRID_SIZE, 
  TILE_SIZE, 
  VIEWPORT_SIZE, 
  PLAYER_SPEED, 
  SEEKER_SPEED_PATROL, 
  SEEKER_SPEED_CHASE, 
  DETECTION_RADIUS, 
  DETECTION_RATE, 
  COOLDOWN_RATE,
  Point,
  Seeker,
  GameStatus,
  LeaderboardEntry,
  Powerup,
  PowerupType,
  Collectible,
  Trap,
  MinimapMarker,
  GameMode,
  Customization,
  Lobby
} from './types';
import { aStar, hasLineOfSight, getVisibilityPolygon } from './utils';
import { MAPS, GameMap, CHANGING_MAZE_MAP, HARD_MODE_MAP, generateDynamicGrid } from './maps';
import { Shield, AlertTriangle, Play, RefreshCcw, Trophy, Volume2, VolumeX, HelpCircle, X, Zap, Users, Target, Settings, LogIn, LogOut, Mail, Plus } from 'lucide-react';

import { 
  db, 
  auth,
  googleProvider,
  handleFirestoreError, 
  OperationType 
} from '../firebase';
import { signInWithPopup, onAuthStateChanged } from 'firebase/auth';
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot,
  getDocs,
  where,
  setDoc,
  doc,
  addDoc,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';

const ErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hasError, setHasError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      setHasError(true);
      setErrorInfo(event.error?.message || 'An unexpected error occurred');
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center z-[9999] p-6 text-center">
        <div className="max-w-md w-full bg-red-900/20 border border-red-500/50 rounded-xl p-8 backdrop-blur-xl">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">System Failure</h2>
          <p className="text-red-200/70 mb-6">{errorInfo}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-red-500 text-white rounded-lg font-bold hover:bg-red-400 transition-colors"
          >
            Reboot System
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

const MapPreview: React.FC<{ grid: number[][] }> = ({ grid }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const size = canvas.width;
    const tileSize = size / GRID_SIZE;
    
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#06b6d4'; // Cyan for walls
    ctx.shadowBlur = 4;
    ctx.shadowColor = '#06b6d4';
    
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if (grid[y][x] === 1) {
          ctx.fillRect(x * tileSize + 1, y * tileSize + 1, tileSize - 2, tileSize - 2);
        }
      }
    }
    ctx.shadowBlur = 0;
  }, [grid]);
  
  return <canvas ref={canvasRef} width={120} height={120} className="bg-black/40 rounded border border-white/10" />;
};

const GameEngine: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);
  
  // Game State Refs (for high performance loop)
  const playerPosRef = useRef<Point>({ x: 1.5, y: 1.5 });
  const seekersRef = useRef<Seeker[]>([
    { 
      id: '1', 
      pos: { x: GRID_SIZE - 0.5, y: 0.5 }, 
      target: null, 
      path: [], 
      state: 'PATROL', 
      lastKnownPlayerPos: null,
      patrolWaypoint: { x: GRID_SIZE - 0.5, y: 0.5 }
    },
    { 
      id: '2', 
      pos: { x: 0.5, y: GRID_SIZE - 0.5 }, 
      target: null, 
      path: [], 
      state: 'PATROL', 
      lastKnownPlayerPos: null,
      patrolWaypoint: { x: 0.5, y: GRID_SIZE - 0.5 }
    }
  ]);
  const gridRef = useRef<number[][]>(MAPS[0].grid);
  const keysPressed = useRef<Set<string>>(new Set());
  const detectionMeterRef = useRef<number>(0);
  const survivalTimeRef = useRef<number>(0);
  const statusRef = useRef<GameStatus>('HIDING');
  const spawnTimerRef = useRef<number>(0);
  const powerupsRef = useRef<Powerup[]>([]);
  const collectiblesRef = useRef<Collectible[]>([]);
  const trapsRef = useRef<Trap[]>([]);
  const minimapMarkersRef = useRef<MinimapMarker[]>([]);
  const activePowerupRef = useRef<{ type: PowerupType; endTime: number } | null>(null);
  const clonePosRef = useRef<Point | null>(null);
  const powerupQueueRef = useRef<PowerupType[]>([]);
  const mazeChangeTimerRef = useRef<number>(0);

  // Audio Refs
  const bgMusicRef = useRef<HTMLAudioElement | null>(null);
  const menuMusicRef = useRef<HTMLAudioElement | null>(null);
  const sfxRef = useRef<{ [key: string]: HTMLAudioElement }>({});

  // React State (for UI)
  const [uiStatus, setUiStatus] = useState<GameStatus>('HIDING');
  const [uiSurvivalTime, setUiSurvivalTime] = useState(0);
  const [dotsCollected, setDotsCollected] = useState(0);
  const dotsCollectedRef = useRef(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [bestRecords, setBestRecords] = useState<{ [key: number]: number }>({});
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [isMapSelecting, setIsMapSelecting] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedMapIndex, setSelectedMapIndex] = useState(0);
  const [gameMode, setGameMode] = useState<GameMode>('NORMAL');
  const [isModeSelecting, setIsModeSelecting] = useState(false);
  const [modeInfoOpen, setModeInfoOpen] = useState<GameMode | null>(null);
  const [customization, setCustomization] = useState<Customization>({
    packetColor: '#ffffff',
    wallColor: '#1e1b4b',
    seekerColor: '#ef4444',
    backgroundColor: '#000000'
  });
  const [leaderboards, setLeaderboards] = useState<{ [key: string]: LeaderboardEntry[] }>({});
  const [leaderboardEmails, setLeaderboardEmails] = useState<{ [key: string]: string }>({});
  const [isScoreSaved, setIsScoreSaved] = useState(false);
  const [mazeVersion, setMazeVersion] = useState(0);
  const [isGlitching, setIsGlitching] = useState(false);
  const [showLeaderboardOnGameOver, setShowLeaderboardOnGameOver] = useState(false);
  const [activePowerupUI, setActivePowerupUI] = useState<{ type: PowerupType; timeLeft: number } | null>(null);
  const [powerupQueueUI, setPowerupQueueUI] = useState<PowerupType[]>([]);
  const [hoveredMapIndex, setHoveredMapIndex] = useState<number | null>(null);
  const [volume, setVolume] = useState(0.5);
  const [scoreReduction, setScoreReduction] = useState<{ id: string; x: number; y: number }[]>([]);

  // Multiplayer State
  const [isMultiplayer, setIsMultiplayer] = useState(false);
  const [currentLobby, setCurrentLobby] = useState<Lobby | null>(null);
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [isLobbySelecting, setIsLobbySelecting] = useState(false);
  const [isCreatingLobby, setIsCreatingLobby] = useState(false);
  const [isWaitingRoom, setIsWaitingRoom] = useState(false);
  const [playerRole, setPlayerRole] = useState<'HOST' | 'GUEST' | null>(null);
  
  // New states for the requested features
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newLobbyName, setNewLobbyName] = useState('');
  const [newLobbyPassword, setNewLobbyPassword] = useState('');
  const [isJoinPasswordModalOpen, setIsJoinPasswordModalOpen] = useState(false);
  const [joinPassword, setJoinPassword] = useState('');
  const [lobbyToJoin, setLobbyToJoin] = useState<Lobby | null>(null);
  const player2PosRef = useRef<Point>({ x: 1.5, y: 1.5 });
  const player2DotsRef = useRef(0);
  const player2StatusRef = useRef<'ALIVE' | 'CAUGHT'>('ALIVE');
  const [player2Dots, setPlayer2Dots] = useState(0);
  const [player2Status, setPlayer2Status] = useState<'ALIVE' | 'CAUGHT'>('ALIVE');
  const [isSinglePlayerMenu, setIsSinglePlayerMenu] = useState(false);

  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  const isAdmin = auth.currentUser?.email === 'abdullamather0712@gmail.com';

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthReady(!!user);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Listen for leaderboard updates from Firestore
    const q = query(
      collection(db, 'leaderboards'),
      orderBy('dots', 'desc'),
      limit(100)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allEntries = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          uid: data.uid || 'legacy'
        } as LeaderboardEntry;
      });
      
      // Sort in client to avoid composite index requirement
      allEntries.sort((a, b) => {
        if (b.dots !== a.dots) return b.dots - a.dots;
        return b.time - a.time;
      });

      const newLeaderboards: { [key: string]: LeaderboardEntry[] } = {};
      
      allEntries.forEach(entry => {
        const mIdx = entry.mapIndex ?? 0;
        const mode = entry.mode || 'NORMAL';
        const key = `${mode}_${mIdx}`;
        if (!newLeaderboards[key]) newLeaderboards[key] = [];
        if (newLeaderboards[key].length < 10) {
          newLeaderboards[key].push(entry);
        }
      });
      
      setLeaderboards(newLeaderboards);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'leaderboards');
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAdmin || !auth.currentUser) {
      setLeaderboardEmails({});
      return;
    }

    // Admin: Listen for email updates
    const q = query(collection(db, 'leaderboard_emails'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const emailsMap: { [key: string]: string } = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        emailsMap[doc.id] = data.email;
      });
      setLeaderboardEmails(emailsMap);
    }, (error) => {
      // Silently handle or log for admin
      console.warn("Failed to fetch leaderboard emails:", error);
    });

    return () => unsubscribe();
  }, [isAdmin, auth.currentUser]);

  useEffect(() => {
    const savedBests = localStorage.getItem('neon_shadows_bests');
    if (savedBests) setBestRecords(JSON.parse(savedBests));

    // Initialize Audio
    bgMusicRef.current = new Audio('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3');
    bgMusicRef.current.loop = true;
    bgMusicRef.current.volume = volume * 0.3;

    menuMusicRef.current = new Audio('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3');
    menuMusicRef.current.loop = true;
    menuMusicRef.current.volume = volume * 0.4;

    sfxRef.current = {
      collect: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-arcade-game-jump-coin-272.mp3'),
      clone: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-sci-fi-interface-robot-click-2544.mp3'),
      teleport: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-sci-fi-teleport-948.mp3'),
      slowmo: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-slow-motion-wind-2244.mp3'),
      caught: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-game-over-dark-orchestra-633.mp3'),
      click: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-modern-technology-select-3124.mp3'),
    };

    return () => {
      if (bgMusicRef.current) {
        bgMusicRef.current.pause();
        bgMusicRef.current = null;
      }
      if (menuMusicRef.current) {
        menuMusicRef.current.pause();
        menuMusicRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (bgMusicRef.current) bgMusicRef.current.volume = volume * 0.3;
    if (menuMusicRef.current) menuMusicRef.current.volume = volume * 0.4;
  }, [volume]);

  const playSFX = (key: string) => {
    const audio = sfxRef.current[key];
    if (audio) {
      audio.currentTime = 0;
      audio.volume = volume;
      audio.play().catch(() => {});
    }
  };

  const handleGoogleSignIn = async () => {
    if (isAuthLoading) return;
    setIsAuthLoading(true);
    try {
      console.log("Starting Google Sign-In...");
      await signInWithPopup(auth, googleProvider);
      console.log("Sign-In successful:", auth.currentUser?.email);
      playSFX('click');
    } catch (error: any) {
      console.error("Google Sign-In error:", error);
      if (error.code === 'auth/popup-blocked') {
        alert("Sign-in popup blocked! Please allow popups for this site and try again.");
      } else if (error.code === 'auth/cancelled-popup-request') {
        // User closed the popup
      } else if (error.code === 'auth/unauthorized-domain') {
        alert("This domain is not authorized for Firebase Auth. Please add it to your Firebase Console authorized domains list.");
      } else {
        alert(`Sign-in failed: ${error.message} (Code: ${error.code})`);
      }
      throw error; // Re-throw so caller knows it failed
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await auth.signOut();
      playSFX('click');
    } catch (error) {
      console.error("Sign-Out failed:", error);
    }
  };

  const saveToLeaderboard = async () => {
    if (isScoreSaved) return;
    
    if (!auth.currentUser) {
      await handleGoogleSignIn();
      if (!auth.currentUser) return;
    }

    const user = auth.currentUser;
    const scoreId = `${user.uid}_${selectedMapIndex}_${gameMode}`;
    
    setIsScoreSaved(true); 
    const newEntry: LeaderboardEntry = {
      name: user.displayName || 'Anonymous_Agent',
      dots: dotsCollectedRef.current,
      time: survivalTimeRef.current,
      date: new Date().toISOString(),
      mapIndex: selectedMapIndex,
      mode: gameMode,
      uid: user.uid
    };

    try {
      // Check if there's an existing score for this user on this map and mode
      const leaderboardKey = `${gameMode}_${selectedMapIndex}`;
      const existingScores = leaderboards[leaderboardKey] || [];
      const myExistingScore = existingScores.find(s => s.uid === user.uid);
      
      // Only save if it's a new entry or better than existing
      if (!myExistingScore || newEntry.dots > myExistingScore.dots || (newEntry.dots === myExistingScore.dots && newEntry.time > myExistingScore.time)) {
        await setDoc(doc(db, 'leaderboards', scoreId), newEntry);
        
        // Also save the email to a separate collection for the admin
        if (user.email) {
          await setDoc(doc(db, 'leaderboard_emails', scoreId), {
            email: user.email,
            uid: user.uid,
            mapIndex: selectedMapIndex,
            mode: gameMode,
            date: new Date().toISOString()
          });
        }
      }
    } catch (error) {
      setIsScoreSaved(false); // Allow retry on error
      handleFirestoreError(error, OperationType.WRITE, 'leaderboards');
    }
  };

  const spawnPowerup = useCallback(() => {
    const types: PowerupType[] = ['SLOWMO', 'CLONE', 'TELEPORT', 'INVINCIBILITY'];
    const type = types[Math.floor(Math.random() * types.length)];
    
    let x, y;
    let attempts = 0;
    do {
      x = Math.floor(Math.random() * (GRID_SIZE - 2)) + 1;
      y = Math.floor(Math.random() * (GRID_SIZE - 2)) + 1;
      attempts++;
    } while (
      (gridRef.current[y][x] === 1 || 
      Math.sqrt(Math.pow(x - playerPosRef.current.x, 2) + Math.pow(y - playerPosRef.current.y, 2)) < 5) &&
      attempts < 100
    );

    if (attempts < 100) {
      powerupsRef.current.push({ 
        id: `powerup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 
        type, 
        pos: { x: x + 0.5, y: y + 0.5 } 
      });
    }
  }, []);

  const spawnCollectible = useCallback(() => {
    let x, y;
    let attempts = 0;
    do {
      x = Math.floor(Math.random() * GRID_SIZE);
      y = Math.floor(Math.random() * GRID_SIZE);
      attempts++;
    } while (
      (gridRef.current[y][x] === 1 || 
      Math.sqrt(Math.pow(x + 0.5 - playerPosRef.current.x, 2) + Math.pow(y + 0.5 - playerPosRef.current.y, 2)) < 10) &&
      attempts < 100
    );
    if (attempts < 100) {
      collectiblesRef.current.push({ 
        id: `collectible-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 
        pos: { x: x + 0.5, y: y + 0.5 } 
      });
    }
  }, []);

  const resetGame = useCallback(() => {
    // Stop menu music
    if (menuMusicRef.current) menuMusicRef.current.pause();

    playerPosRef.current = { x: 1.5, y: 1.5 };
    
    if (gameMode === 'CHANGING_MAZE') {
      gridRef.current = CHANGING_MAZE_MAP.grid.map(row => [...row]);
    } else if (gameMode === 'HARD') {
      gridRef.current = HARD_MODE_MAP.grid.map(row => [...row]);
    } else {
      gridRef.current = MAPS[selectedMapIndex].grid.map(row => [...row]);
    }
    
    setMazeVersion(v => v + 1);

    const corners = [
      { x: 0.5, y: 0.5 },
      { x: GRID_SIZE - 0.5, y: 0.5 },
      { x: GRID_SIZE - 0.5, y: GRID_SIZE - 0.5 },
      { x: 0.5, y: GRID_SIZE - 0.5 }
    ];
    
    // Pick two different corners far from the player (who starts at 1.5, 1.5)
    const validCorners = corners.filter(corner => {
      const dist = Math.sqrt(
        Math.pow(corner.x - 1.5, 2) + 
        Math.pow(corner.y - 1.5, 2)
      );
      return dist > 10;
    });
    
    const shuffled = [...validCorners].sort(() => Math.random() - 0.5);
    const startCorners = shuffled.slice(0, 2);

    seekersRef.current = startCorners.map((corner, i) => ({
      id: `initial-seeker-${i}-${Math.random().toString(36).substr(2, 5)}`,
      pos: { ...corner },
      target: null,
      path: [],
      state: 'PATROL',
      lastKnownPlayerPos: null,
      patrolWaypoint: { ...corner },
      canSeePlayer: false,
      loSTimer: 0
    }));

    setIsScoreSaved(false);
    detectionMeterRef.current = 0;
    survivalTimeRef.current = 0;
    dotsCollectedRef.current = 0;
    setDotsCollected(0);
    spawnTimerRef.current = 0;
    powerupsRef.current = [];
    collectiblesRef.current = [];
    trapsRef.current = [];
    minimapMarkersRef.current = [];
    
    // Spawn 40 white dots
    for (let i = 0; i < 40; i++) {
      let x, y;
      do {
        x = Math.floor(Math.random() * GRID_SIZE);
        y = Math.floor(Math.random() * GRID_SIZE);
      } while (gridRef.current[y][x] === 1 || (x < 5 && y < 5));
      collectiblesRef.current.push({ 
        id: `collectible-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 
        pos: { x: x + 0.5, y: y + 0.5 } 
      });
    }

    activePowerupRef.current = null;
    clonePosRef.current = null;
    powerupQueueRef.current = [];
    setPowerupQueueUI([]);
    statusRef.current = 'HIDING';
    setUiStatus('HIDING');
    setUiSurvivalTime(0);
    setIsGameStarted(true);
    setIsMapSelecting(false);
    setIsScoreSaved(false);
    setShowLeaderboardOnGameOver(false);
    setActivePowerupUI(null);
    setIsPaused(false);
    lastTimeRef.current = 0;
    spawnPowerup();

    if (bgMusicRef.current) {
      bgMusicRef.current.currentTime = 0;
    }
  }, [selectedMapIndex, spawnPowerup]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    keysPressed.current.add(key);

    if (key === ' ' && isGameStarted && statusRef.current !== 'CAUGHT' && powerupQueueRef.current.length > 0 && !activePowerupRef.current) {
      const nextPowerup = powerupQueueRef.current[0];
      
      if (nextPowerup === 'CLONE') {
        clonePosRef.current = { ...playerPosRef.current };
        playSFX('clone');
        activePowerupRef.current = { type: 'CLONE', endTime: Date.now() + 5000 };
      } else if (nextPowerup === 'INVINCIBILITY') {
        playSFX('slowmo'); // Use slowmo sound for invincibility start
        activePowerupRef.current = { type: 'INVINCIBILITY', endTime: Date.now() + 8000 };
      } else if (nextPowerup === 'SLOWMO') {
        playSFX('slowmo');
        activePowerupRef.current = { type: 'SLOWMO', endTime: Date.now() + 5000 };
      } else if (nextPowerup === 'TELEPORT') {
        playSFX('click');
        activePowerupRef.current = { type: 'TELEPORT', endTime: Date.now() + 5000 }; // 5 seconds to click and teleport
      }

      powerupQueueRef.current.shift();
      setPowerupQueueUI([...powerupQueueRef.current]);
    }

    if (key === 'escape' && isGameStarted && statusRef.current !== 'CAUGHT') {
      setIsPaused(prev => !prev);
      playSFX('click');
    }
  }, [isGameStarted]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => keysPressed.current.delete(e.key.toLowerCase()), []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [handleKeyDown, handleKeyUp]);

  // Music Controller Effect
  useEffect(() => {
    const bgMusic = bgMusicRef.current;
    const menuMusic = menuMusicRef.current;
    if (!bgMusic || !menuMusic) return;

    if (!isGameStarted) {
      bgMusic.pause();
      if (menuMusic.paused) menuMusic.play().catch(() => {});
    } else {
      menuMusic.pause();
      if (isPaused || uiStatus === 'CAUGHT') {
        bgMusic.pause();
        if (uiStatus === 'CAUGHT') {
          playSFX('caught');
        }
      } else {
        bgMusic.play().catch(() => {});
      }
    }
  }, [isGameStarted, isPaused, uiStatus]);

  const backToMenu = async () => {
    if (isMultiplayer && currentLobby && playerRole === 'HOST') {
      try {
        await deleteDoc(doc(db, 'lobbies', currentLobby.id));
      } catch (error) {
        console.error("Error deleting lobby:", error);
      }
    }
    setIsGameStarted(false);
    setIsMultiplayer(false);
    setCurrentLobby(null);
    setPlayerRole(null);
    setIsLobbySelecting(false);
    setIsSinglePlayerMenu(false);
    setIsMapSelecting(false);
    setIsModeSelecting(false);
    setIsMapSelecting(false);
    setIsWaitingRoom(false);
    setUiStatus('HIDING');
    statusRef.current = 'HIDING';
    setShowLeaderboardOnGameOver(false);
    setIsScoreSaved(false);
    if (menuMusicRef.current) {
      menuMusicRef.current.currentTime = 0;
      menuMusicRef.current.play().catch(() => {});
    }
  };

  const changeMaze = useCallback(() => {
    // Collect all points that MUST be empty
    const protectedPoints = [
      playerPosRef.current,
      ...seekersRef.current.map(s => s.pos),
      ...collectiblesRef.current.map(c => c.pos),
      ...powerupsRef.current.map(p => p.pos),
      ...trapsRef.current.map(t => t.pos)
    ];

    // Generate a completely new grid with these points protected
    const newGrid = generateDynamicGrid(Date.now(), protectedPoints);

    gridRef.current = newGrid;
    setMazeVersion(v => v + 1);
    setIsGlitching(true);
    setTimeout(() => setIsGlitching(false), 200);
    playSFX('teleport');
    
    // Force seekers to recalculate their paths since the entire map changed
    seekersRef.current.forEach(seeker => {
      seeker.path = [];
    });
  }, []);

  // Multiplayer logic
  useEffect(() => {
    if (!currentLobby) return;

    const unsubscribe = onSnapshot(doc(db, 'lobbies', currentLobby.id), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as Lobby;
        console.log("Lobby update received:", data);
        setCurrentLobby({ ...data, id: snapshot.id });
        
        // Update player 2 position and status
        if (playerRole === 'HOST') {
          if (data.player2Pos) player2PosRef.current = data.player2Pos;
          player2DotsRef.current = data.player2Dots || 0;
          player2StatusRef.current = data.player2Status || 'ALIVE';
          setPlayer2Dots(data.player2Dots || 0);
          setPlayer2Status(data.player2Status || 'ALIVE');
        } else {
          if (data.player1Pos) player2PosRef.current = data.player1Pos;
          player2DotsRef.current = data.player1Dots || 0;
          player2StatusRef.current = data.player1Status || 'ALIVE';
          setPlayer2Dots(data.player1Dots || 0);
          setPlayer2Status(data.player1Status || 'ALIVE');
        }

        if (data.status === 'PLAYING' && !isGameStarted) {
          setIsWaitingRoom(false);
          setIsGameStarted(true);
          resetGame();
        }

        if (data.status === 'FINISHED' && isGameStarted) {
          // Handle game end
          if (data.winner === auth.currentUser?.uid) {
            // We won!
          } else {
            // We lost!
            statusRef.current = 'CAUGHT';
            setUiStatus('CAUGHT');
          }
        }
      }
    });

    return () => unsubscribe();
  }, [currentLobby?.id, playerRole, isGameStarted]);

  // Sync player position to Firestore
  useEffect(() => {
    if (!isGameStarted || !isMultiplayer || !currentLobby) return;

    const interval = setInterval(async () => {
      const lobbyRef = doc(db, 'lobbies', currentLobby.id);
      const updateData: any = {
        lastUpdate: Date.now()
      };

      if (playerRole === 'HOST') {
        updateData.player1Pos = playerPosRef.current;
        updateData.player1Dots = dotsCollectedRef.current;
        updateData.player1Status = statusRef.current === 'CAUGHT' ? 'CAUGHT' : 'ALIVE';
      } else {
        updateData.player2Pos = playerPosRef.current;
        updateData.player2Dots = dotsCollectedRef.current;
        updateData.player2Status = statusRef.current === 'CAUGHT' ? 'CAUGHT' : 'ALIVE';
      }

      // Check if game should end
      if (statusRef.current === 'CAUGHT' || player2StatusRef.current === 'CAUGHT') {
        updateData.status = 'FINISHED';
        if (statusRef.current === 'CAUGHT') {
          updateData.winner = playerRole === 'HOST' ? currentLobby.guestUid : currentLobby.hostUid;
        } else {
          updateData.winner = playerRole === 'HOST' ? currentLobby.hostUid : currentLobby.guestUid;
        }
      }

      try {
        await updateDoc(lobbyRef, updateData);
      } catch (error) {
        console.error("Error syncing multiplayer state:", error);
      }
    }, 100); // 10Hz sync

    return () => clearInterval(interval);
  }, [isGameStarted, isMultiplayer, currentLobby?.id, playerRole]);

  useEffect(() => {
    if (isLobbySelecting && auth.currentUser) {
      const q = query(collection(db, 'lobbies'), where('status', '==', 'WAITING'), limit(10));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const lobbyList = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Lobby));
        setLobbies(lobbyList);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'lobbies');
      });
      return () => unsubscribe();
    }
  }, [isLobbySelecting, auth.currentUser]);

  const createLobby = async () => {
    if (!auth.currentUser) {
      try {
        await handleGoogleSignIn();
      } catch (error) {
        console.error("Sign in failed:", error);
        alert("Authentication failed. Please check your connection.");
        return;
      }
      if (!auth.currentUser) return;
    }

    if (!newLobbyName.trim()) {
      alert("Please enter a lobby name.");
      return;
    }

    setIsCreatingLobby(true);
    try {
      const lobbyData: Omit<Lobby, 'id'> = {
        serverName: newLobbyName.trim(),
        hostUid: auth.currentUser.uid,
        hostName: auth.currentUser.displayName || 'Player 1',
        status: 'WAITING',
        password: newLobbyPassword || undefined,
        mapIndex: selectedMapIndex,
        player1Pos: { x: 1.5, y: 1.5 },
        player2Pos: { x: GRID_SIZE - 1.5, y: GRID_SIZE - 1.5 },
        player1Dots: 0,
        player2Dots: 0,
        player1Status: 'ALIVE',
        player2Status: 'ALIVE',
        lastUpdate: Date.now()
      };
      const docRef = await addDoc(collection(db, 'lobbies'), lobbyData);
      setCurrentLobby({ ...lobbyData, id: docRef.id });
      setPlayerRole('HOST');
      setIsMultiplayer(true);
      setIsLobbySelecting(false);
      setIsCreateModalOpen(false);
      setIsWaitingRoom(true);
      setNewLobbyName('');
      setNewLobbyPassword('');
    } catch (error: any) {
      console.error("Error creating lobby:", error);
      alert("Failed to create lobby. Please try again.");
    } finally {
      setIsCreatingLobby(false);
    }
  };

  const joinLobby = async (lobby: Lobby) => {
    console.log("Attempting to join lobby:", lobby.id);
    if (!auth.currentUser) {
      try {
        await handleGoogleSignIn();
      } catch (error) {
        console.error("Sign in failed during join:", error);
        return;
      }
      if (!auth.currentUser) {
        alert("You must be signed in to join a multiplayer game.");
        return;
      }
    }

    if (lobby.guestUid === auth.currentUser.uid) {
      console.log("User is already the guest of this lobby, proceeding...");
      setCurrentLobby(lobby);
      setPlayerRole('GUEST');
      setIsMultiplayer(true);
      setIsLobbySelecting(false);
      setIsJoinPasswordModalOpen(false);
      setIsWaitingRoom(true);
      setJoinPassword('');
      setLobbyToJoin(null);
      return;
    }

    if (lobby.guestUid && lobby.guestUid !== auth.currentUser.uid) {
      alert("This lobby is already full.");
      return;
    }

    if (lobby.password && !joinPassword) {
      setLobbyToJoin(lobby);
      setIsJoinPasswordModalOpen(true);
      return;
    }

    if (lobby.password && joinPassword !== lobby.password) {
      alert("Incorrect Password!");
      setJoinPassword('');
      return;
    }

    try {
      const lobbyRef = doc(db, 'lobbies', lobby.id);
      console.log("Updating lobby document for guest join...");
      await updateDoc(lobbyRef, {
        guestUid: auth.currentUser.uid,
        guestName: auth.currentUser.displayName || 'Player 2',
        status: 'READY',
        lastUpdate: Date.now()
      });
      console.log("Lobby update successful.");
      
      setCurrentLobby({ ...lobby, id: lobby.id, guestUid: auth.currentUser.uid, status: 'READY' });
      setPlayerRole('GUEST');
      setIsMultiplayer(true);
      setIsLobbySelecting(false);
      setIsJoinPasswordModalOpen(false);
      setIsWaitingRoom(true);
      setJoinPassword('');
      setLobbyToJoin(null);
    } catch (error: any) {
      console.error("Error joining lobby:", error);
      let errorMsg = error.message;
      if (error.code === 'permission-denied') {
        errorMsg = "Access denied. This lobby might be full or no longer available. Please try refreshing the list.";
      }
      alert(`Failed to join lobby: ${errorMsg}`);
    }
  };

  const startMultiplayerGame = async () => {
    if (!currentLobby || playerRole !== 'HOST') return;
    try {
      const lobbyRef = doc(db, 'lobbies', currentLobby.id);
      await updateDoc(lobbyRef, {
        status: 'PLAYING',
        lastUpdate: Date.now()
      });
      setIsWaitingRoom(false);
      setIsGameStarted(true);
      resetGame();
    } catch (error) {
      console.error("Error starting game:", error);
    }
  };

  const update = (delta: number) => {
    if (statusRef.current === 'CAUGHT' || isPaused) {
      return;
    }

    // Handle Teleportation Freeze
    if (activePowerupRef.current?.type === 'TELEPORT') {
      const timeLeft = (activePowerupRef.current.endTime - Date.now()) / 1000;
      if (timeLeft <= 0) {
        activePowerupRef.current = null;
        setActivePowerupUI(null);
      } else {
        setActivePowerupUI({ type: 'TELEPORT', timeLeft });
        return; // Freeze game logic
      }
    }

    // Handle Powerup Expiration
    if (activePowerupRef.current) {
      const timeLeft = (activePowerupRef.current.endTime - Date.now()) / 1000;
      if (timeLeft <= 0) {
        if (activePowerupRef.current.type === 'CLONE') clonePosRef.current = null;
        activePowerupRef.current = null;
        setActivePowerupUI(null);
      } else {
        setActivePowerupUI({ type: activePowerupRef.current.type, timeLeft });
      }
    }

    const isSlowMo = activePowerupRef.current?.type === 'SLOWMO';
    const gameDelta = delta; // We will apply Slowmo per-seeker in multiplayer

    // Changing Maze Logic
    if (gameMode === 'CHANGING_MAZE') {
      mazeChangeTimerRef.current += delta;
      if (mazeChangeTimerRef.current >= 5000) {
        mazeChangeTimerRef.current = 0;
        changeMaze();
      }
    }

    // 1. Player Movement
    let dx = 0;
    let dy = 0;
    if (keysPressed.current.has('w') || keysPressed.current.has('arrowup')) dy -= 1;
    if (keysPressed.current.has('s') || keysPressed.current.has('arrowdown')) dy += 1;
    if (keysPressed.current.has('a') || keysPressed.current.has('arrowleft')) dx -= 1;
    if (keysPressed.current.has('d') || keysPressed.current.has('arrowright')) dx += 1;

    if (dx !== 0 || dy !== 0) {
      const length = Math.sqrt(dx * dx + dy * dy);
      const moveX = (dx / length) * PLAYER_SPEED * (delta / 16.67);
      const moveY = (dy / length) * PLAYER_SPEED * (delta / 16.67);

      const nextX = playerPosRef.current.x + moveX / TILE_SIZE;
      const nextY = playerPosRef.current.y + moveY / TILE_SIZE;

      // Improved collision with padding to prevent clipping into corners
      const padding = 0.15;
      
      // Check X movement
      const checkX = moveX > 0 ? nextX + padding : nextX - padding;
      const gridX = Math.floor(checkX);
      const curY = playerPosRef.current.y;
      
      if (gridX >= 0 && gridX < GRID_SIZE) {
        const topY = Math.floor(curY - padding);
        const bottomY = Math.floor(curY + padding);
        if (gridRef.current[topY][gridX] === 0 && gridRef.current[bottomY][gridX] === 0) {
          playerPosRef.current.x = nextX;
        }
      }

      // Check Y movement
      const checkY = moveY > 0 ? nextY + padding : nextY - padding;
      const gridY = Math.floor(checkY);
      const curX = playerPosRef.current.x;
      
      if (gridY >= 0 && gridY < GRID_SIZE) {
        const leftX = Math.floor(curX - padding);
        const rightX = Math.floor(curX + padding);
        if (gridRef.current[gridY][leftX] === 0 && gridRef.current[gridY][rightX] === 0) {
          playerPosRef.current.y = nextY;
        }
      }
    }

    // Powerup Collection
    powerupsRef.current.forEach((p, index) => {
      const dist = Math.sqrt(Math.pow(p.pos.x - playerPosRef.current.x, 2) + Math.pow(p.pos.y - playerPosRef.current.y, 2));
      if (dist < 0.8) {
        playSFX('collect');
        powerupQueueRef.current.push(p.type);
        setPowerupQueueUI([...powerupQueueRef.current]);
        powerupsRef.current.splice(index, 1);
      }
    });

    // Collectible Collection (White Dots)
    collectiblesRef.current.forEach((c, index) => {
      const dist = Math.sqrt(Math.pow(c.pos.x - playerPosRef.current.x, 2) + Math.pow(c.pos.y - playerPosRef.current.y, 2));
      if (dist < 0.8) {
        playSFX('collect');
        dotsCollectedRef.current++;
        setDotsCollected(dotsCollectedRef.current);
        collectiblesRef.current.splice(index, 1);
        spawnCollectible();
      }
    });

    // Trap Collision
    seekersRef.current.forEach((seeker, sIndex) => {
      trapsRef.current.forEach((trap, tIndex) => {
        const dist = Math.sqrt(Math.pow(seeker.pos.x - trap.pos.x, 2) + Math.pow(seeker.pos.y - trap.pos.y, 2));
        if (dist < 0.6) {
          // AI dies
          minimapMarkersRef.current.push({
            id: `marker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            pos: { ...seeker.pos },
            type: 'DEATH',
            startTime: Date.now(),
            duration: 2000
          });
          seekersRef.current.splice(sIndex, 1);
          trapsRef.current.splice(tIndex, 1);
          playSFX('teleport');
        }
      });
    });

    // 2. Seeker Logic
    let anySpotted = false;
    const actualPlayerPos = playerPosRef.current;
    const distractionPos = clonePosRef.current;

    seekersRef.current.forEach(seeker => {
      // Seeker chases the clone if it exists, otherwise the player
      const currentTarget = distractionPos || actualPlayerPos;
      
      // If player is invincible, seekers can't see them
      const isInvincible = activePowerupRef.current?.type === 'INVINCIBILITY';
      
      const canSeeTarget = isInvincible && !distractionPos ? false : hasLineOfSight(seeker.pos, currentTarget, gridRef.current, DETECTION_RADIUS);
      
      // Detection meter only increases if the seeker sees the ACTUAL player and player is NOT invincible
      const canSeePlayer = !isInvincible && hasLineOfSight(seeker.pos, actualPlayerPos, gridRef.current, DETECTION_RADIUS);

      // Hard Mode Adjustments
      const currentDetectionRate = gameMode === 'HARD' ? DETECTION_RATE * 1.25 : DETECTION_RATE;
      let currentSeekerSpeedChase = gameMode === 'HARD' ? SEEKER_SPEED_CHASE * 1.15 : SEEKER_SPEED_CHASE;
      let currentSeekerSpeedPatrol = gameMode === 'HARD' ? SEEKER_SPEED_PATROL * 1.15 : SEEKER_SPEED_PATROL;
      let seekerDetectionRate = currentDetectionRate;

      // Slowmo Powerup logic
      if (isSlowMo) {
        if (isMultiplayer) {
          const dist = Math.sqrt(Math.pow(seeker.pos.x - actualPlayerPos.x, 2) + Math.pow(seeker.pos.y - actualPlayerPos.y, 2));
          if (dist <= DETECTION_RADIUS) {
            currentSeekerSpeedChase *= 0.25;
            currentSeekerSpeedPatrol *= 0.25;
            seekerDetectionRate *= 0.25;
          }
        } else {
          currentSeekerSpeedChase *= 0.25;
          currentSeekerSpeedPatrol *= 0.25;
          seekerDetectionRate *= 0.25;
        }
      }

      // If player is invincible and no distraction, drop the chase immediately
      if (isInvincible && !distractionPos && seeker.state === 'CHASE') {
        seeker.state = 'PATROL';
        seeker.path = [];
        seeker.loSTimer = 0;
      }
      
      // LoS Stability: increment timer if seen, reset if not
      if (canSeeTarget) {
        seeker.loSTimer = (seeker.loSTimer || 0) + gameDelta;
      } else {
        seeker.loSTimer = 0;
      }

      const speed = seeker.state === 'CHASE' ? currentSeekerSpeedChase : currentSeekerSpeedPatrol;
      const moveStep = (speed * (gameDelta / 16.67)) / TILE_SIZE;

      // Only enter CHASE if LoS is stable (e.g., > 150ms)
      if (canSeeTarget && seeker.loSTimer > 150) {
        seeker.state = 'CHASE';
        seeker.lastKnownPlayerPos = { ...currentTarget };
        
        // When in LoS, move directly towards the target for smoothness
        const sdx = currentTarget.x - seeker.pos.x;
        const sdy = currentTarget.y - seeker.pos.y;
        const dist = Math.sqrt(sdx * sdx + sdy * sdy);
        
        if (dist > 0.1) {
          const nextX = seeker.pos.x + (sdx / dist) * moveStep;
          const nextY = seeker.pos.y + (sdy / dist) * moveStep;
          
          // Basic wall collision for seekers to prevent getting stuck on corners
          const gridX = Math.floor(nextX);
          const gridY = Math.floor(nextY);
          
          if (gridX >= 0 && gridX < GRID_SIZE && gridY >= 0 && gridY < GRID_SIZE) {
            if (gridRef.current[Math.floor(seeker.pos.y)][gridX] === 0) {
              seeker.pos.x = nextX;
            }
            if (gridRef.current[gridY][Math.floor(seeker.pos.x)] === 0) {
              seeker.pos.y = nextY;
            }
          }
        }
        // Clear path as we are moving directly
        seeker.path = [];
      } else if (seeker.state === 'CHASE') {
        // LoS lost, move to last known position using A*
        if (seeker.path.length === 0 && seeker.lastKnownPlayerPos) {
          const start = { x: Math.floor(seeker.pos.x), y: Math.floor(seeker.pos.y) };
          const end = { x: Math.floor(seeker.lastKnownPlayerPos.x), y: Math.floor(seeker.lastKnownPlayerPos.y) };
          seeker.path = aStar(start, end, gridRef.current);
          seeker.lastKnownPlayerPos = null; // Target reached or path calculated
        }

        if (seeker.path.length > 0) {
          const nextNode = seeker.path[0];
          const targetX = nextNode.x + 0.5;
          const targetY = nextNode.y + 0.5;
          
          const sdx = targetX - seeker.pos.x;
          const sdy = targetY - seeker.pos.y;
          const dist = Math.sqrt(sdx * sdx + sdy * sdy);
          
          if (dist < moveStep) {
            seeker.pos.x = targetX;
            seeker.pos.y = targetY;
            seeker.path.shift();
          } else {
            const nextX = seeker.pos.x + (sdx / dist) * moveStep;
            const nextY = seeker.pos.y + (sdy / dist) * moveStep;
            
            // Basic wall collision for seekers
            const gridX = Math.floor(nextX);
            const gridY = Math.floor(nextY);
            
            if (gridX >= 0 && gridX < GRID_SIZE && gridY >= 0 && gridY < GRID_SIZE) {
              if (gridRef.current[Math.floor(seeker.pos.y)][gridX] === 0) {
                seeker.pos.x = nextX;
              }
              if (gridRef.current[gridY][Math.floor(seeker.pos.x)] === 0) {
                seeker.pos.y = nextY;
              }
            }
          }
        } else {
          // Reached last known position, go back to patrol
          seeker.state = 'PATROL';
        }
      } else {
        // Patrol logic: Pick waypoints that are further away to explore more of the map
        if (seeker.path.length === 0) {
          let randomX, randomY;
          let attempts = 0;
          do {
            randomX = Math.floor(Math.random() * GRID_SIZE);
            randomY = Math.floor(Math.random() * GRID_SIZE);
            attempts++;
            
            // Try to pick a waypoint that is far from the current position
            const dist = Math.sqrt(Math.pow(randomX - seeker.pos.x, 2) + Math.pow(randomY - seeker.pos.y, 2));
            if (dist > 10 && gridRef.current[randomY][randomX] === 0) break;
          } while (attempts < 50);

          if (gridRef.current[randomY][randomX] === 0) {
            seeker.patrolWaypoint = { x: randomX, y: randomY };
            seeker.path = aStar(
              { x: Math.floor(seeker.pos.x), y: Math.floor(seeker.pos.y) },
              seeker.patrolWaypoint,
              gridRef.current
            );
          }
        }

        if (seeker.path.length > 0) {
          const nextNode = seeker.path[0];
          const targetX = nextNode.x + 0.5;
          const targetY = nextNode.y + 0.5;
          
          const sdx = targetX - seeker.pos.x;
          const sdy = targetY - seeker.pos.y;
          const dist = Math.sqrt(sdx * sdx + sdy * sdy);
          
          if (dist < moveStep) {
            seeker.pos.x = targetX;
            seeker.pos.y = targetY;
            seeker.path.shift();
          } else {
            const nextX = seeker.pos.x + (sdx / dist) * moveStep;
            const nextY = seeker.pos.y + (sdy / dist) * moveStep;
            
            // Basic wall collision for seekers
            const gridX = Math.floor(nextX);
            const gridY = Math.floor(nextY);
            
            if (gridX >= 0 && gridX < GRID_SIZE && gridY >= 0 && gridY < GRID_SIZE) {
              if (gridRef.current[Math.floor(seeker.pos.y)][gridX] === 0) {
                seeker.pos.x = nextX;
              }
              if (gridRef.current[gridY][Math.floor(seeker.pos.x)] === 0) {
                seeker.pos.y = nextY;
              }
            }
          }
        }
      }

      if (canSeePlayer) {
        anySpotted = true;
        seeker.canSeePlayer = true;
      } else {
        seeker.canSeePlayer = false;
      }

      // Nudge out of walls if stuck
      const curGX = Math.floor(seeker.pos.x);
      const curGY = Math.floor(seeker.pos.y);
      if (curGX >= 0 && curGX < GRID_SIZE && curGY >= 0 && curGY < GRID_SIZE && gridRef.current[curGY][curGX] === 1) {
        const neighbors = [
          { x: curGX + 1, y: curGY },
          { x: curGX - 1, y: curGY },
          { x: curGX, y: curGY + 1 },
          { x: curGX, y: curGY - 1 },
        ];
        for (const n of neighbors) {
          if (n.x >= 0 && n.x < GRID_SIZE && n.y >= 0 && n.y < GRID_SIZE && gridRef.current[n.y][n.x] === 0) {
            seeker.pos.x = n.x + 0.5;
            seeker.pos.y = n.y + 0.5;
            seeker.path = []; // Recalculate path
            break;
          }
        }
      }

      // Check for catch (collision)
      const distToPlayer = Math.sqrt(
        Math.pow(seeker.pos.x - playerPosRef.current.x, 2) + 
        Math.pow(seeker.pos.y - playerPosRef.current.y, 2)
      );
      
      if (distToPlayer < 0.6 && !isInvincible) {
        statusRef.current = 'CAUGHT';
        setUiStatus('CAUGHT');
        playSFX('caught');
        if (bgMusicRef.current) bgMusicRef.current.pause();
        const currentBest = bestRecords[selectedMapIndex] || 0;
        if (survivalTimeRef.current > currentBest) {
          const newBests = { ...bestRecords, [selectedMapIndex]: survivalTimeRef.current };
          setBestRecords(newBests);
          localStorage.setItem('neon_shadows_bests', JSON.stringify(newBests));
        }
      }
    });

      // 3. Detection Meter Logic
      const isInvincible = activePowerupRef.current?.type === 'INVINCIBILITY';
      if (anySpotted && !isInvincible) {
        const currentDetectionRate = gameMode === 'HARD' ? DETECTION_RATE * 1.25 : DETECTION_RATE;
        let detectionMultiplier = 1;
        
        if (isSlowMo) {
          if (isMultiplayer) {
            // Check if any seeker seeing the player is within radius
            const seekersSeeingPlayer = seekersRef.current.filter(s => s.canSeePlayer);
            const anyInRadius = seekersSeeingPlayer.some(s => {
              const dist = Math.sqrt(Math.pow(s.pos.x - actualPlayerPos.x, 2) + Math.pow(s.pos.y - actualPlayerPos.y, 2));
              return dist <= DETECTION_RADIUS;
            });
            if (anyInRadius) detectionMultiplier = 0.25;
          } else {
            detectionMultiplier = 0.25;
          }
        }
        
        detectionMeterRef.current = Math.min(1, detectionMeterRef.current + currentDetectionRate * detectionMultiplier);
        statusRef.current = 'SPOTTED';
      } else {
        detectionMeterRef.current = Math.max(0, detectionMeterRef.current - COOLDOWN_RATE * (isSlowMo ? 0.25 : 1));
        if (detectionMeterRef.current === 0) statusRef.current = 'HIDING';
      }

    if (detectionMeterRef.current >= 1 && statusRef.current !== 'CAUGHT') {
      statusRef.current = 'CAUGHT';
      setUiStatus('CAUGHT');
      playSFX('caught');
      if (bgMusicRef.current) bgMusicRef.current.pause();
      const currentBest = bestRecords[selectedMapIndex] || 0;
      if (survivalTimeRef.current > currentBest) {
        const newBests = { ...bestRecords, [selectedMapIndex]: survivalTimeRef.current };
        setBestRecords(newBests);
        localStorage.setItem('neon_shadows_bests', JSON.stringify(newBests));
      }
    }

    // 4. Spawning Logic
    spawnTimerRef.current += delta / 1000;
    const currentPowerupSpawnRate = gameMode === 'HARD' ? 20 : 15;
    if (spawnTimerRef.current >= currentPowerupSpawnRate) {
      spawnTimerRef.current = 0;
      spawnPowerup();
    }

    // Seeker Spawning Logic
    const currentSpawnRateDivisor = gameMode === 'HARD' ? 7 : 10;
    const expectedSeekerCount = 2 + Math.floor(survivalTimeRef.current / currentSpawnRateDivisor);
    if (seekersRef.current.length < expectedSeekerCount) {
      // Check if we already have a spawn marker for this "missing" seeker
      const spawnMarkers = minimapMarkersRef.current.filter(m => m.type === 'SPAWN');
      if (spawnMarkers.length < (expectedSeekerCount - seekersRef.current.length)) {
        const corners = [
          { x: 0.5, y: 0.5 },
          { x: GRID_SIZE - 0.5, y: 0.5 },
          { x: GRID_SIZE - 0.5, y: GRID_SIZE - 0.5 },
          { x: 0.5, y: GRID_SIZE - 0.5 }
        ];
        const validCorners = corners.filter(corner => {
          const dist = Math.sqrt(Math.pow(corner.x - playerPosRef.current.x, 2) + Math.pow(corner.y - playerPosRef.current.y, 2));
          return dist > 10;
        });
        const corner = validCorners.length > 0 ? validCorners[Math.floor(Math.random() * validCorners.length)] : corners[Math.floor(Math.random() * corners.length)];
        
        minimapMarkersRef.current.push({
          id: `marker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          pos: { ...corner },
          type: 'SPAWN',
          startTime: Date.now(),
          duration: 2000
        });
      }
    }

    // Process Spawn Markers
    minimapMarkersRef.current.forEach((marker, index) => {
      if (Date.now() - marker.startTime > marker.duration) {
        if (marker.type === 'SPAWN') {
          const newSeeker: Seeker = {
            id: `seeker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            pos: { ...marker.pos },
            target: null,
            path: [],
            state: 'PATROL',
            lastKnownPlayerPos: null,
            patrolWaypoint: { ...marker.pos },
            canSeePlayer: false
          };
          seekersRef.current.push(newSeeker);
        }
        minimapMarkersRef.current.splice(index, 1);
      }
    });

    survivalTimeRef.current += delta / 1000;
    setUiSurvivalTime(survivalTimeRef.current);
    
    setUiStatus(prev => {
      if (prev !== statusRef.current) {
        return statusRef.current;
      }
      return prev;
    });
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Background
    ctx.fillStyle = customization.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw Grid
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if (gridRef.current[y][x] === 1) {
          ctx.fillStyle = customization.wallColor;
          ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = '#a855f7'; // Neon purple
          ctx.lineWidth = 1;
          ctx.strokeRect(x * TILE_SIZE + 2, y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        } else {
          // Grid dots
          ctx.fillStyle = 'rgba(168, 85, 247, 0.1)';
          ctx.beginPath();
          ctx.arc(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Draw Seekers
    seekersRef.current.forEach(seeker => {
      // Seeker Detection Area (Visibility Polygon)
      const isAggressive = seeker.state === 'CHASE' || seeker.canSeePlayer;
      const poly = getVisibilityPolygon(seeker.pos, gridRef.current, DETECTION_RADIUS);
      
      if (poly.length > 0) {
        // Fill color: Red for aggressive/spotted, Yellow for patrolling
        ctx.fillStyle = isAggressive ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.15)';
        ctx.beginPath();
        poly.forEach((p, index) => {
          if (index === 0) ctx.moveTo(p.x * TILE_SIZE, p.y * TILE_SIZE);
          else ctx.lineTo(p.x * TILE_SIZE, p.y * TILE_SIZE);
        });
        ctx.closePath();
        ctx.fill();
        
        // Outline
        ctx.strokeStyle = isAggressive ? 'rgba(239, 68, 68, 0.8)' : 'rgba(245, 158, 11, 0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.shadowBlur = 15;
      ctx.shadowColor = seeker.state === 'CHASE' ? '#ef4444' : '#f59e0b';
      ctx.fillStyle = customization.seekerColor;
      ctx.beginPath();
      ctx.arc(seeker.pos.x * TILE_SIZE, seeker.pos.y * TILE_SIZE, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Eye icon
      ctx.fillStyle = 'white';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('👁', seeker.pos.x * TILE_SIZE, seeker.pos.y * TILE_SIZE + 4);
    });

    // Draw Powerups
    powerupsRef.current.forEach(p => {
      ctx.shadowBlur = 20;
      ctx.shadowColor = p.type === 'CLONE' ? '#06b6d4' : '#22c55e'; // Cyan for clone, Green for others
      ctx.fillStyle = p.type === 'CLONE' ? '#06b6d4' : '#22c55e';
      ctx.beginPath();
      ctx.arc(p.pos.x * TILE_SIZE, p.pos.y * TILE_SIZE, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      
      ctx.fillStyle = 'white';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(p.type[0], p.pos.x * TILE_SIZE, p.pos.y * TILE_SIZE + 4);
    });

    // Draw Collectibles (White Dots)
    collectiblesRef.current.forEach(c => {
      ctx.fillStyle = customization.packetColor;
      ctx.shadowBlur = 5;
      ctx.shadowColor = customization.packetColor;
      ctx.beginPath();
      ctx.arc(c.pos.x * TILE_SIZE, c.pos.y * TILE_SIZE, TILE_SIZE * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    // Draw Traps (Grey Dots)
    trapsRef.current.forEach(t => {
      ctx.fillStyle = '#6b7280'; // Grey
      ctx.beginPath();
      ctx.arc(t.pos.x * TILE_SIZE, t.pos.y * TILE_SIZE, TILE_SIZE * 0.25, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw Clone
    if (clonePosRef.current) {
      ctx.shadowBlur = 15;
      ctx.shadowColor = 'rgba(6, 182, 212, 0.8)';
      ctx.fillStyle = 'rgba(6, 182, 212, 0.6)';
      ctx.beginPath();
      ctx.arc(clonePosRef.current.x * TILE_SIZE, clonePosRef.current.y * TILE_SIZE, 14, 0, Math.PI * 2);
      ctx.fill();
      
      // Add a border to the clone
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Draw Player
    if (isMultiplayer) {
      // Only draw local player
      const localPos = playerPosRef.current;
      const localStatus = statusRef.current;
      const color = playerRole === 'HOST' ? '#ffff00' : '#00ff00';
      const label = playerRole === 'HOST' ? 'P1' : 'P2';
      
      if (localStatus !== 'CAUGHT') {
        ctx.shadowBlur = 20;
        ctx.shadowColor = color;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(localPos.x * TILE_SIZE, localPos.y * TILE_SIZE, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        ctx.fillStyle = 'black';
        ctx.font = 'bold 8px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(label, localPos.x * TILE_SIZE, localPos.y * TILE_SIZE + 3);
      }
    } else {
      const isInvincible = activePowerupRef.current?.type === 'INVINCIBILITY';
      ctx.shadowBlur = isInvincible ? 30 : 20;
      ctx.shadowColor = isInvincible ? '#a855f7' : '#06b6d4';
      ctx.fillStyle = isInvincible ? '#a855f7' : '#06b6d4';
      ctx.beginPath();
      ctx.arc(playerPosRef.current.x * TILE_SIZE, playerPosRef.current.y * TILE_SIZE, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Fog of War (Radial Gradient Mask)
    ctx.save();
    if (isMultiplayer) {
      ctx.fillStyle = 'black';
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.globalCompositeOperation = 'destination-out';
      // Only show local player's vision
      const pos = playerPosRef.current;
      const gradient = ctx.createRadialGradient(
        pos.x * TILE_SIZE,
        pos.y * TILE_SIZE,
        TILE_SIZE * 2,
        pos.x * TILE_SIZE,
        pos.y * TILE_SIZE,
        TILE_SIZE * 8
      );
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(pos.x * TILE_SIZE, pos.y * TILE_SIZE, TILE_SIZE * 8, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const gradient = ctx.createRadialGradient(
        playerPosRef.current.x * TILE_SIZE,
        playerPosRef.current.y * TILE_SIZE,
        TILE_SIZE * 2,
        playerPosRef.current.x * TILE_SIZE,
        playerPosRef.current.y * TILE_SIZE,
        TILE_SIZE * 8
      );
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
      
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.restore();
  };

  const lastTimeRef = useRef<number>(0);
  const animate = (time: number) => {
    if (lastTimeRef.current === 0) {
      lastTimeRef.current = time;
      requestRef.current = requestAnimationFrame(animate);
      return;
    }
    const delta = Math.min(100, time - lastTimeRef.current);
    lastTimeRef.current = time;

    update(delta);
    draw();

    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    if (isGameStarted) {
      requestRef.current = requestAnimationFrame(animate);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isGameStarted]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${ms.toString().padStart(2, '0')}`;
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activePowerupRef.current?.type === 'TELEPORT') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      
      const clickX = (e.clientX - rect.left) * scaleX;
      const clickY = (e.clientY - rect.top) * scaleY;
      
      const gridX = Math.floor(clickX / TILE_SIZE);
      const gridY = Math.floor(clickY / TILE_SIZE);
      
      if (gridX >= 0 && gridX < GRID_SIZE && gridY >= 0 && gridY < GRID_SIZE && gridRef.current[gridY][gridX] === 0) {
        playerPosRef.current = { x: gridX + 0.5, y: gridY + 0.5 };
        activePowerupRef.current = null;
        setActivePowerupUI(null);
        playSFX('teleport');
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isGameStarted && statusRef.current !== 'CAUGHT' && dotsCollectedRef.current >= 3) {
      dotsCollectedRef.current -= 3;
      setDotsCollected(dotsCollectedRef.current);
      
      // Add visual feedback
      const id = `${Date.now()}-${Math.random()}`;
      setScoreReduction(prev => [...prev, { id, x: 0, y: 0 }]);
      setTimeout(() => {
        setScoreReduction(prev => prev.filter(anim => anim.id !== id));
      }, 1000);

      trapsRef.current.push({ 
        id: `trap-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 
        pos: { ...playerPosRef.current } 
      });
      playSFX('click');
    }
  };

  // Memoized Minimap Grid
  const minimapGrid = React.useMemo(() => {
    return (
      <div 
        className="absolute inset-0 grid opacity-10"
        style={{ 
          gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
          gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)`
        }}
      >
        {gridRef.current.flat().map((cell, i) => (
          <div key={i} className={cell === 1 ? 'bg-white/20' : ''} />
        ))}
      </div>
    );
  }, [mazeVersion]);

  return (
    <div 
      className="relative w-full h-screen bg-black text-white font-mono overflow-hidden flex items-center justify-center cursor-crosshair"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Glitch Overlay */}
      <AnimatePresence>
        {isGlitching && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.3 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] bg-cyan-500/20 pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* Pause Menu */}
      <AnimatePresence>
        {isPaused && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center"
          >
            <div className="text-center space-y-8">
              <div className="space-y-2">
                <h2 className="text-6xl font-black text-cyan-500 tracking-tighter italic">PAUSED</h2>
                <p className="text-cyan-200/40 text-xs uppercase tracking-widest">System_Suspended // Waiting_For_Input</p>
              </div>
              
              <div className="flex flex-col gap-4 w-64 mx-auto">
                <button 
                  onClick={() => setIsPaused(false)}
                  className="w-full py-4 bg-cyan-500 text-black font-black text-sm uppercase tracking-[0.2em] hover:bg-cyan-400 transition-colors flex items-center justify-center gap-3"
                >
                  <Play size={18} fill="currentColor" />
                  Resume_Node
                </button>
                <button 
                  onClick={() => {
                    playSFX('click');
                    setIsGuideOpen(true);
                  }}
                  className="w-full py-4 bg-white/5 border border-white/10 text-white font-bold text-sm uppercase tracking-[0.2em] hover:bg-white/10 transition-colors flex items-center justify-center gap-3"
                >
                  <HelpCircle size={18} />
                  Operation_Guide
                </button>
                <button 
                  onClick={backToMenu}
                  className="w-full py-4 bg-white/5 border border-white/10 text-white font-bold text-sm uppercase tracking-[0.2em] hover:bg-white/10 transition-colors flex items-center justify-center gap-3"
                >
                  <RefreshCcw size={18} />
                  Quit_Mission
                </button>
              </div>
              
              <div className="text-[10px] text-white/20 uppercase tracking-widest">
                Press [Esc] to resume
              </div>
            </div>
          </motion.div>
        )}

        {isGuideOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[60] bg-black/95 backdrop-blur-2xl flex items-center justify-center p-4"
          >
            <div className="max-w-4xl w-full bg-black/90 border border-cyan-500/30 rounded-2xl p-8 md:p-12 relative overflow-y-auto max-h-[90vh] shadow-[0_0_50px_rgba(6,182,212,0.15)] neon-scrollbar">
              <button 
                onClick={() => setIsGuideOpen(false)}
                className="absolute top-6 right-6 text-white/40 hover:text-white transition-colors"
              >
                <X size={24} />
              </button>

              <div className="space-y-12">
                <div className="text-center space-y-2">
                  <h2 className="text-4xl font-black tracking-tighter italic text-cyan-500 uppercase">Operation_Guide</h2>
                  <p className="text-white/40 text-[10px] uppercase tracking-[0.3em]">Sector_7 // Field_Manual_V2.0</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                  {/* Objectives & Controls */}
                  <div className="space-y-8">
                    <section className="space-y-4">
                      <h3 className="text-xs font-bold text-white uppercase tracking-widest border-l-2 border-cyan-500 pl-3">Primary_Objective</h3>
                      <p className="text-[11px] text-white/60 leading-relaxed uppercase tracking-wider">
                        Infiltrate the neon grid. Collect as many <span className="text-white font-bold">Data Nodes</span> (white dots) as possible while evading the <span className="text-red-400 font-bold">Seeker Drones</span>. Survival time is your secondary metric.
                      </p>
                    </section>

                    <section className="space-y-4">
                      <h3 className="text-xs font-bold text-white uppercase tracking-widest border-l-2 border-cyan-500 pl-3">Movement_Protocol</h3>
                      <div className="flex items-center gap-4">
                        <div className="grid grid-cols-3 gap-1">
                          <div />
                          <div className="w-8 h-8 border border-white/20 rounded flex items-center justify-center text-[10px]">W</div>
                          <div />
                          <div className="w-8 h-8 border border-white/20 rounded flex items-center justify-center text-[10px]">A</div>
                          <div className="w-8 h-8 border border-white/20 rounded flex items-center justify-center text-[10px]">S</div>
                          <div className="w-8 h-8 border border-white/20 rounded flex items-center justify-center text-[10px]">D</div>
                        </div>
                        <p className="text-[10px] text-white/40 uppercase tracking-widest">Standard WASD controls for omni-directional navigation.</p>
                      </div>
                    </section>

                    <section className="space-y-4">
                      <h3 className="text-xs font-bold text-white uppercase tracking-widest border-l-2 border-red-500 pl-3">Tactical_Traps</h3>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="px-3 py-1 border border-white/20 rounded text-[10px] font-bold">RIGHT CLICK</div>
                          <span className="text-[10px] text-white/60 uppercase tracking-widest">Deploy Stun Trap</span>
                        </div>
                        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg space-y-2">
                          <p className="text-[10px] text-red-400 font-bold uppercase tracking-widest">Drawback: System_Cost</p>
                          <p className="text-[9px] text-white/40 leading-relaxed uppercase tracking-wider">
                            Setting a trap consumes <span className="text-white font-bold">3 Data Nodes</span>. Use sparingly. Traps will temporarily disable any Seeker that passes over them.
                          </p>
                        </div>
                      </div>
                    </section>
                  </div>

                  {/* Powerups */}
                  <div className="space-y-8">
                    <h3 className="text-xs font-bold text-white uppercase tracking-widest border-l-2 border-cyan-500 pl-3">Powerup_Modules</h3>
                    <div className="space-y-6">
                      <div className="flex gap-4">
                        <div className="w-10 h-10 rounded-lg bg-yellow-500/20 border border-yellow-500/40 flex items-center justify-center text-yellow-400 shrink-0">
                          <Zap size={20} />
                        </div>
                        <div className="space-y-1">
                          <h4 className="text-[10px] font-bold text-yellow-400 uppercase tracking-widest">SlowMo_Engine</h4>
                          <p className="text-[9px] text-white/40 uppercase tracking-wider leading-relaxed">Dilates time, allowing for precise maneuvers around Seekers.</p>
                        </div>
                      </div>

                      <div className="flex gap-4">
                        <div className="w-10 h-10 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
                          <Users size={20} />
                        </div>
                        <div className="space-y-1">
                          <h4 className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">Decoy_Clone</h4>
                          <p className="text-[9px] text-white/40 uppercase tracking-wider leading-relaxed">Leaves a holographic decoy that Seekers will prioritize over you.</p>
                        </div>
                      </div>

                      <div className="flex gap-4">
                        <div className="w-10 h-10 rounded-lg bg-green-500/20 border border-green-500/40 flex items-center justify-center text-green-400 shrink-0">
                          <Target size={20} />
                        </div>
                        <div className="space-y-1">
                          <h4 className="text-[10px] font-bold text-green-400 uppercase tracking-widest">Quantum_Jump</h4>
                          <p className="text-[9px] text-white/40 uppercase tracking-wider leading-relaxed">Freezes time. Click anywhere on the map to instantly teleport.</p>
                        </div>
                      </div>

                      <div className="flex gap-4">
                        <div className="w-10 h-10 rounded-lg bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400 shrink-0">
                          <Shield size={20} />
                        </div>
                        <div className="space-y-1">
                          <h4 className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">Shadow_Cloak</h4>
                          <p className="text-[9px] text-white/40 uppercase tracking-wider leading-relaxed">Become invisible to Seekers. Detection meter will not increase.</p>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-white/10">
                        <div className="flex items-center gap-3">
                          <div className="px-3 py-1 border border-white/20 rounded text-[10px] font-bold">SPACE</div>
                          <span className="text-[10px] text-white/60 uppercase tracking-widest">Activate Next Module</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-center pt-8">
                  <button 
                    onClick={() => setIsGuideOpen(false)}
                    className="px-12 py-3 bg-cyan-500 text-black font-bold text-xs uppercase tracking-[0.2em] hover:bg-cyan-400 transition-colors"
                  >
                    Acknowledge_Protocol
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Powerup UI */}
      {activePowerupUI && (
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 z-30 text-center pointer-events-none">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`text-2xl font-bold uppercase tracking-[0.2em] px-6 py-2 rounded-full border backdrop-blur-md ${
              activePowerupUI.type === 'SLOWMO' ? 'text-yellow-400 border-yellow-500/50 bg-yellow-500/10' :
              activePowerupUI.type === 'CLONE' ? 'text-cyan-400 border-cyan-500/50 bg-cyan-500/10' :
              activePowerupUI.type === 'INVINCIBILITY' ? 'text-purple-400 border-purple-500/50 bg-purple-500/10' :
              'text-amber-400 border-amber-500/50 bg-amber-500/10'
            }`}
          >
            {activePowerupUI.type === 'SLOWMO' ? 'SlowMo' : 
             activePowerupUI.type === 'CLONE' ? 'Cloned' : 
             activePowerupUI.type === 'INVINCIBILITY' ? 'Invincible' :
             `Teleport in ${Math.ceil(activePowerupUI.timeLeft)} seconds`}
          </motion.div>
          {activePowerupUI.type === 'TELEPORT' && (
            <div className="mt-4 text-xs text-white/40 uppercase tracking-widest animate-pulse">
              Click anywhere on the map to jump
            </div>
          )}
        </div>
      )}

      {/* HUD Top Left */}
      <div className="absolute top-8 left-8 z-40 flex flex-col gap-4">
        <div className="flex items-center gap-6">
          <div className="relative">
            <div className="text-white/40 text-[10px] uppercase tracking-widest mb-1">
              {isMultiplayer ? (playerRole === 'HOST' ? 'P1_Packets (You)' : 'P2_Packets (You)') : 'Data_Packets'}
            </div>
            <div className="text-4xl font-black text-white tracking-tighter italic flex items-center gap-3">
              <Target className={isMultiplayer ? (playerRole === 'HOST' ? 'text-yellow-400' : 'text-green-400') : 'text-cyan-400'} size={24} />
              {dotsCollected}
              <AnimatePresence>
                {scoreReduction.map(anim => (
                  <motion.span
                    key={anim.id}
                    initial={{ opacity: 1, y: 0 }}
                    animate={{ opacity: 0, y: -40 }}
                    exit={{ opacity: 0 }}
                    className="absolute left-full ml-2 text-red-500 text-xl font-bold"
                  >
                    -3
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {isMultiplayer && (
            <>
              <div className="w-px h-12 bg-white/10" />
              <div className="relative">
                <div className="text-white/40 text-[10px] uppercase tracking-widest mb-1">
                  {playerRole === 'HOST' ? 'P2_Packets' : 'P1_Packets'}
                </div>
                <div className="text-4xl font-black text-white tracking-tighter italic flex items-center gap-3">
                  <Target className={playerRole === 'HOST' ? 'text-green-400' : 'text-yellow-400'} size={24} />
                  {player2Dots}
                </div>
              </div>
            </>
          )}

          <div className="w-px h-12 bg-white/10" />
          <div>
            <div className="text-white/40 text-[10px] uppercase tracking-widest mb-1">Survival_Time</div>
            <div className="text-4xl font-black text-cyan-400 tracking-tighter italic">
              {formatTime(uiSurvivalTime)}
            </div>
          </div>
          <div className="w-px h-12 bg-white/10" />
          <div>
            <div className="text-white/40 text-[10px] uppercase tracking-widest mb-1">Best_Record</div>
            <div className="text-2xl font-bold text-white/80 tabular-nums tracking-tighter italic">
              {formatTime(bestRecords[selectedMapIndex] || 0)}
            </div>
          </div>
        </div>
        
        <div className="flex flex-col gap-2">
          {powerupQueueUI.map((type, idx) => {
            let color = 'cyan';
            let label = 'Clone';
            if (type === 'INVINCIBILITY') { color = 'purple'; label = 'Invincibility'; }
            else if (type === 'SLOWMO') { color = 'yellow'; label = 'Slowmo'; }
            else if (type === 'TELEPORT') { color = 'green'; label = 'Teleport'; }
            
            return (
              <motion.div 
                key={`${type}-${idx}`}
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                className={`bg-${color}-500/10 border border-${color}-500/50 px-3 py-1.5 rounded-lg flex items-center gap-3 w-fit`}
              >
                <div className={`w-2 h-2 bg-${color}-400 rounded-full animate-pulse shadow-[0_0_5px_${color}]`} />
                <div className={`text-[10px] uppercase tracking-widest text-${color}-400 font-bold`}>
                  {label} Ready {idx === 0 && <span className="text-white/40 ml-2">[SPACE]</span>}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* HUD Top Right */}
      <div className="absolute top-6 right-6 z-20">
        <div className="w-40 h-40 bg-black/80 border border-white/10 rounded-lg overflow-hidden relative flex flex-col shadow-2xl">
          <div className="absolute inset-0 opacity-20 pointer-events-none">
            <div className="w-full h-full bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]"></div>
          </div>
          <div className="p-2 text-[8px] text-white/40 uppercase tracking-tighter border-b border-white/5">Locator_V4.2 // Node_77</div>
          <div className="flex-1 relative">
             {/* Mini Map */}
             <div className="absolute inset-0 p-1">
                <div className="relative w-full h-full">
                  {/* Grid background for minimap */}
                  {minimapGrid}
                  <div 
                    className="absolute w-1 h-1 bg-cyan-400 rounded-full shadow-[0_0_5px_cyan]"
                    style={{ 
                      left: `${(playerPosRef.current.x / GRID_SIZE) * 100}%`, 
                      top: `${(playerPosRef.current.y / GRID_SIZE) * 100}%` 
                    }}
                  />
                  {seekersRef.current.map(s => (
                    <div 
                      key={s.id}
                      className={`absolute w-1 h-1 rounded-full ${s.state === 'CHASE' ? 'bg-red-500 shadow-[0_0_5px_red]' : 'bg-amber-500'}`}
                      style={{ 
                        left: `${(s.pos.x / GRID_SIZE) * 100}%`, 
                        top: `${(s.pos.y / GRID_SIZE) * 100}%` 
                      }}
                    />
                  ))}
                  {powerupsRef.current.map(p => {
                    let color = 'white';
                    if (p.type === 'SLOWMO') color = '#f59e0b'; // Amber
                    if (p.type === 'CLONE') color = '#06b6d4'; // Cyan
                    if (p.type === 'TELEPORT') color = '#22c55e'; // Green
                    if (p.type === 'INVINCIBILITY') color = '#a855f7'; // Purple
                    
                    return (
                      <div 
                        key={p.id}
                        className="absolute w-1 h-1 rounded-full animate-pulse"
                        style={{ 
                          left: `${(p.pos.x / GRID_SIZE) * 100}%`, 
                          top: `${(p.pos.y / GRID_SIZE) * 100}%`,
                          backgroundColor: color,
                          boxShadow: `0 0 5px ${color}`
                        }}
                      />
                    );
                  })}
                  {collectiblesRef.current.map(c => (
                    <div 
                      key={c.id}
                      className="absolute w-0.5 h-0.5 rounded-full bg-white/50"
                      style={{ 
                        left: `${(c.pos.x / GRID_SIZE) * 100}%`, 
                        top: `${(c.pos.y / GRID_SIZE) * 100}%` 
                      }}
                    />
                  ))}
                  {trapsRef.current.map(t => (
                    <div 
                      key={t.id}
                      className="absolute w-1 h-1 rounded-full bg-gray-500"
                      style={{ 
                        left: `${(t.pos.x / GRID_SIZE) * 100}%`, 
                        top: `${(t.pos.y / GRID_SIZE) * 100}%` 
                      }}
                    />
                  ))}
                  {minimapMarkersRef.current.map(m => (
                    <div 
                      key={m.id}
                      className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center`}
                      style={{ 
                        left: `${(m.pos.x / GRID_SIZE) * 100}%`, 
                        top: `${(m.pos.y / GRID_SIZE) * 100}%` 
                      }}
                    >
                      <div className={`w-3 h-3 rounded-full border-2 ${m.type === 'SPAWN' ? 'border-red-500 animate-ping' : 'border-green-500 animate-ping'}`} />
                      <div className={`absolute w-1.5 h-1.5 rounded-full border ${m.type === 'SPAWN' ? 'border-red-500' : 'border-green-500'}`} />
                    </div>
                  ))}
                </div>
             </div>
          </div>
        </div>
      </div>

      {/* Detection Meter Bottom Right */}
      <div className="absolute bottom-6 right-6 z-20 w-64">
        <div className="bg-black/60 backdrop-blur-md border border-white/10 p-3 rounded-lg shadow-2xl">
          <div className="flex justify-between items-center mb-1.5">
            <div className="text-[9px] text-white/60 uppercase tracking-widest flex items-center gap-2">
              Detection Risk
              {uiStatus === 'SPOTTED' && <AlertTriangle size={10} className="text-red-500 animate-pulse" />}
            </div>
            <div className={`text-[9px] font-bold ${uiStatus === 'SPOTTED' ? 'text-red-500' : 'text-cyan-500'}`}>
              {Math.round(detectionMeterRef.current * 100)}%
            </div>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <motion.div 
              className={`h-full ${uiStatus === 'SPOTTED' ? 'bg-red-500' : 'bg-cyan-500'}`}
              animate={{ width: `${detectionMeterRef.current * 100}%` }}
              transition={{ type: 'spring', bounce: 0, duration: 0.2 }}
            />
          </div>
        </div>
      </div>

      {/* Main Game Canvas */}
      <div className="relative border border-white/10 shadow-[0_0_50px_rgba(168,85,247,0.05)] max-h-[85vh] aspect-square">
        <canvas 
          ref={canvasRef}
          width={VIEWPORT_SIZE}
          height={VIEWPORT_SIZE}
          onClick={handleCanvasClick}
          onContextMenu={handleContextMenu}
          className={`bg-black w-full h-full object-contain ${activePowerupRef.current?.type === 'TELEPORT' ? 'cursor-crosshair' : ''}`}
        />
        
        {/* Scanline Effect */}
        <div className="absolute inset-0 pointer-events-none opacity-10 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />
      </div>

      {/* Overlays */}
      <AnimatePresence>
        {isSettingsOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-6"
          >
            <div className="bg-black/80 border border-white/10 p-8 rounded-2xl max-w-md w-full space-y-8 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-cyan-500" />
              
              <div className="flex justify-between items-center">
                <div className="space-y-1">
                  <h2 className="text-2xl font-black italic tracking-tighter text-white">SETTINGS</h2>
                  <div className="text-[8px] text-cyan-500 uppercase tracking-[0.3em]">System_Configuration</div>
                </div>
                <button 
                  onClick={() => {
                    playSFX('click');
                    setIsSettingsOpen(false);
                  }} 
                  className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/40 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="space-y-8 max-h-[60vh] overflow-y-auto pr-2 neon-scrollbar">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Volume2 size={14} className="text-cyan-400" />
                      <span className="text-[10px] uppercase tracking-widest text-white/60">Master Volume</span>
                    </div>
                    <span className="text-[10px] font-mono text-cyan-400">{Math.round(volume * 100)}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="1" 
                    step="0.01" 
                    value={volume} 
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500"
                  />
                </div>

                <div className="space-y-6 pt-4 border-t border-white/5">
                  <div className="text-[10px] text-cyan-500 uppercase tracking-[0.2em] mb-4">Visual_Customization</div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[9px] text-white/40 uppercase tracking-widest">Wall Color</label>
                      <input 
                        type="color" 
                        value={customization.wallColor}
                        onChange={(e) => setCustomization(prev => ({ ...prev, wallColor: e.target.value }))}
                        className="w-full h-8 bg-transparent border border-white/10 rounded cursor-pointer"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] text-white/40 uppercase tracking-widest">Packet Color</label>
                      <input 
                        type="color" 
                        value={customization.packetColor}
                        onChange={(e) => setCustomization(prev => ({ ...prev, packetColor: e.target.value }))}
                        className="w-full h-8 bg-transparent border border-white/10 rounded cursor-pointer"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] text-white/40 uppercase tracking-widest">Seeker Color</label>
                      <input 
                        type="color" 
                        value={customization.seekerColor}
                        onChange={(e) => setCustomization(prev => ({ ...prev, seekerColor: e.target.value }))}
                        className="w-full h-8 bg-transparent border border-white/10 rounded cursor-pointer"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] text-white/40 uppercase tracking-widest">Background</label>
                      <input 
                        type="color" 
                        value={customization.backgroundColor}
                        onChange={(e) => setCustomization(prev => ({ ...prev, backgroundColor: e.target.value }))}
                        className="w-full h-8 bg-transparent border border-white/10 rounded cursor-pointer"
                      />
                    </div>
                  </div>

                  <button 
                    onClick={() => setCustomization({
                      packetColor: '#ffffff',
                      wallColor: '#1e1b4b',
                      seekerColor: '#ef4444',
                      backgroundColor: '#000000'
                    })}
                    className="w-full py-2 bg-white/5 border border-white/10 text-[9px] text-white/40 uppercase tracking-widest hover:text-white transition-colors"
                  >
                    Reset_To_Defaults
                  </button>
                </div>
              </div>
              
              <button 
                onClick={() => {
                  playSFX('click');
                  setIsSettingsOpen(false);
                }}
                className="w-full py-4 bg-white text-black font-bold uppercase tracking-widest hover:bg-cyan-400 transition-all active:scale-[0.98]"
              >
                Return_To_Interface
              </button>
            </div>
          </motion.div>
        )}

        {!isGameStarted && !isMapSelecting && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center"
            onClick={() => {
              // Play menu music on first interaction
              if (menuMusicRef.current && menuMusicRef.current.paused) {
                menuMusicRef.current.play().catch(() => {});
              }
              // Unlock background music as well
              if (bgMusicRef.current && bgMusicRef.current.paused) {
                bgMusicRef.current.play().then(() => bgMusicRef.current?.pause()).catch(() => {});
              }
            }}
          >
            <div className="flex flex-col md:flex-row gap-12 items-center max-w-6xl px-8">
              <div className="text-center md:text-left space-y-8 max-w-md">
                <motion.h1 
                  initial={{ y: 20 }}
                  animate={{ y: 0 }}
                  className="text-6xl font-black tracking-tighter italic text-transparent bg-clip-text bg-gradient-to-br from-white to-white/20"
                >
                  NEON SHADOWS
                </motion.h1>
                <div className="space-y-8">
                  <div className="space-y-4">
                    <h3 className="text-cyan-400 text-sm font-bold uppercase tracking-[0.2em] flex items-center gap-3">
                      <div className="w-2 h-2 bg-cyan-400 animate-pulse shadow-[0_0_10px_cyan]" /> MISSION OBJECTIVE
                    </h3>
                    <p className="text-white/80 text-lg leading-relaxed uppercase tracking-wider font-light">
                      Extract maximum data packets (white nodes) while evading detection. Survive the network sweep for as long as possible.
                    </p>
                  </div>
                </div>

                      {!isSinglePlayerMenu && !isLobbySelecting && (
                        <div className="flex flex-col gap-4 w-full">
                          <button 
                            onClick={() => {
                              playSFX('click');
                              setIsSinglePlayerMenu(true);
                            }}
                            className="group relative px-12 py-5 bg-white text-black font-bold uppercase tracking-[0.3em] overflow-hidden transition-transform active:scale-95 w-full"
                          >
                            <div className="absolute inset-0 bg-cyan-400 translate-x-full group-hover:translate-x-0 transition-transform duration-300" />
                            <span className="relative z-10 flex items-center justify-center gap-3 text-lg">
                              SINGLE PLAYER <Play size={20} fill="currentColor" />
                            </span>
                          </button>

                          <button 
                            onClick={async () => {
                              playSFX('click');
                              if (!auth.currentUser) {
                                try {
                                  await handleGoogleSignIn();
                                } catch (error) {
                                  console.error("Sign in failed:", error);
                                  return;
                                }
                                if (!auth.currentUser) return;
                              }
                              setIsLobbySelecting(true);
                            }}
                            className="group relative px-12 py-5 bg-white/10 border border-white/20 text-white font-bold uppercase tracking-[0.3em] overflow-hidden transition-transform active:scale-95 w-full"
                          >
                            <div className="absolute inset-0 bg-cyan-400 translate-x-full group-hover:translate-x-0 transition-transform duration-300" />
                            <span className="relative z-10 flex items-center justify-center gap-3 text-lg group-hover:text-black transition-colors">
                              MULTIPLAYER <Users size={20} />
                            </span>
                          </button>
                        </div>
                      )}

                      {isSinglePlayerMenu && (
                        <div className="flex flex-col gap-4 w-full">
                          <button 
                            onClick={() => {
                              playSFX('click');
                              setIsModeSelecting(true);
                              setIsSinglePlayerMenu(false);
                            }}
                            className="group relative px-12 py-5 bg-white text-black font-bold uppercase tracking-[0.3em] overflow-hidden transition-transform active:scale-95 w-full"
                          >
                            <div className="absolute inset-0 bg-cyan-400 translate-x-full group-hover:translate-x-0 transition-transform duration-300" />
                            <span className="relative z-10 flex items-center justify-center gap-3 text-lg">
                              SELECT MODE <Play size={20} fill="currentColor" />
                            </span>
                          </button>
                          <button 
                            onClick={() => setIsSinglePlayerMenu(false)}
                            className="text-xs text-white/40 hover:text-white uppercase tracking-widest text-center"
                          >
                            [Back]
                          </button>
                        </div>
                      )}
                      
                      <div className="flex flex-wrap gap-4">
                        {!auth.currentUser ? (
                          <button 
                            onClick={handleGoogleSignIn}
                            className="px-8 py-4 bg-white/10 border border-white/20 text-white font-bold uppercase tracking-widest hover:bg-white/20 transition-colors active:scale-95 flex-1 flex items-center justify-center gap-2"
                          >
                            Sign_In <LogIn size={18} />
                          </button>
                        ) : (
                          <button 
                            onClick={handleSignOut}
                            className="px-8 py-4 bg-white/10 border border-white/20 text-white font-bold uppercase tracking-widest hover:bg-white/20 transition-colors active:scale-95 flex-1 flex items-center justify-center gap-2"
                          >
                            Sign_Out <LogOut size={18} />
                          </button>
                        )}

                        <button 
                          onClick={() => {
                            playSFX('click');
                            setIsSettingsOpen(true);
                          }}
                          className="px-8 py-4 bg-white/10 border border-white/20 text-white font-bold uppercase tracking-widest hover:bg-white/20 transition-colors active:scale-95 flex items-center justify-center gap-2"
                        >
                          Settings <Settings size={18} />
                        </button>
                        <button 
                          onClick={() => {
                            playSFX('click');
                            setIsGuideOpen(true);
                          }}
                          className="px-8 py-4 bg-white/5 border border-white/10 text-white font-bold uppercase tracking-widest hover:bg-white/10 transition-colors flex-1 flex items-center justify-center gap-2"
                        >
                          Guide <HelpCircle size={16} />
                        </button>
                      </div>
                    </div>
              </div>
          </motion.div>
        )}

        {isWaitingRoom && currentLobby && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-[110] bg-black/90 backdrop-blur-2xl flex items-center justify-center p-6"
          >
            <div className="bg-black/80 border border-white/10 p-12 rounded-3xl max-w-2xl w-full space-y-12 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-cyan-500" />
              
              <div className="text-center space-y-4">
                <h2 className="text-4xl font-black italic tracking-tighter text-white uppercase">Waiting Room</h2>
                <div className="text-[10px] text-cyan-500 uppercase tracking-[0.4em]">Secure_Network_Lobby</div>
              </div>

              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-4 p-6 bg-white/5 border border-white/10 rounded-2xl">
                  <div className="text-[10px] text-white/40 uppercase tracking-widest">Host</div>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-yellow-500/20 border border-yellow-500/50 rounded-full flex items-center justify-center text-yellow-500 font-bold">P1</div>
                    <div className="text-xl font-bold text-white">{currentLobby.hostName}</div>
                  </div>
                  <div className="text-[10px] text-green-500 uppercase font-bold">Connected</div>
                </div>

                <div className="space-y-4 p-6 bg-white/5 border border-white/10 rounded-2xl">
                  <div className="text-[10px] text-white/40 uppercase tracking-widest">Guest</div>
                  {currentLobby.guestUid ? (
                    <>
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-green-500/20 border border-green-500/50 rounded-full flex items-center justify-center text-green-500 font-bold">P2</div>
                        <div className="text-xl font-bold text-white">{currentLobby.guestName}</div>
                      </div>
                      <div className="text-[10px] text-green-500 uppercase font-bold">Connected</div>
                    </>
                  ) : (
                    <div className="h-full flex flex-col justify-center items-center space-y-2 opacity-40">
                      <div className="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
                      <div className="text-[10px] uppercase tracking-widest">Searching...</div>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex justify-between text-xs uppercase tracking-widest border-b border-white/5 pb-4">
                  <span className="text-white/40">Lobby Name</span>
                  <span className="text-cyan-400 font-bold">{currentLobby.serverName}</span>
                </div>
                <div className="flex justify-between text-xs uppercase tracking-widest border-b border-white/5 pb-4">
                  <span className="text-white/40">Map Configuration</span>
                  <span className="text-cyan-400 font-bold">{MAPS[currentLobby.mapIndex].name}</span>
                </div>
                {currentLobby.password && (
                  <div className="flex justify-between text-xs uppercase tracking-widest border-b border-white/5 pb-4">
                    <span className="text-white/40">Security Protocol</span>
                    <span className="text-purple-400 font-bold">Encrypted (Password Active)</span>
                  </div>
                )}
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={() => {
                    playSFX('click');
                    backToMenu();
                  }}
                  className="flex-1 py-4 bg-white/5 border border-white/10 text-white font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
                >
                  Abort_Mission
                </button>
                {playerRole === 'HOST' && (
                  <button 
                    disabled={!currentLobby.guestUid}
                    onClick={() => {
                      playSFX('click');
                      startMultiplayerGame();
                    }}
                    className={`flex-1 py-4 font-bold uppercase tracking-widest transition-all ${currentLobby.guestUid ? 'bg-white text-black hover:bg-cyan-400' : 'bg-white/10 text-white/20 cursor-not-allowed'}`}
                  >
                    {currentLobby.guestUid ? 'Initiate_Infiltration' : 'Waiting_For_Guest...'}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
        {isLobbySelecting && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center p-8"
          >
            <div className="max-w-2xl w-full space-y-8">
              <div className="text-center space-y-2">
                <h2 className="text-4xl font-black tracking-tighter italic text-white uppercase">Multiplayer_Lobby</h2>
                <div className="text-[10px] text-cyan-500 uppercase tracking-[0.4em]">Protocol_Sync // Node_99</div>
              </div>

              <div className="space-y-4">
                <button 
                  onClick={() => setIsCreateModalOpen(true)}
                  className="w-full py-6 bg-cyan-500 text-black font-black uppercase tracking-[0.3em] hover:bg-cyan-400 transition-all rounded-xl shadow-xl shadow-cyan-500/20 flex items-center justify-center gap-4 group"
                >
                  CREATE_NEW_LOBBY <Plus size={24} className="group-hover:rotate-90 transition-transform" />
                </button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
                  <div className="relative flex justify-center text-[10px] uppercase tracking-widest"><span className="bg-black px-4 text-white/20">or_join_active_lobby</span></div>
                </div>

                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {lobbies.length === 0 ? (
                    <div className="text-center py-8 text-white/20 text-xs uppercase tracking-widest border border-dashed border-white/10 rounded-lg">
                      No_Active_Lobbies_Found
                    </div>
                  ) : (
                    lobbies.map((lobby) => (
                      <button 
                        key={lobby.id}
                        onClick={() => joinLobby(lobby)}
                        className="w-full p-4 bg-white/5 border border-white/10 hover:border-cyan-500/50 transition-all flex justify-between items-center group"
                      >
                        <div className="text-left">
                          <div className="text-sm font-bold text-white group-hover:text-cyan-400 transition-colors uppercase tracking-wider">{lobby.serverName}</div>
                          <div className="text-[10px] text-white/40 uppercase tracking-widest">Host: {lobby.hostName} // Map: {MAPS[lobby.mapIndex].name}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          {lobby.password && <Shield size={14} className="text-purple-500" />}
                          <div className="text-[10px] text-cyan-500 font-bold uppercase tracking-widest">JOIN_NODE</div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="flex justify-center">
                <button 
                  onClick={() => setIsLobbySelecting(false)}
                  className="px-8 py-3 bg-white/5 border border-white/10 text-white/40 font-bold text-xs uppercase tracking-widest hover:text-white transition-colors"
                >
                  Back_To_Menu
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {isCreateModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-[120] bg-black/90 backdrop-blur-2xl flex items-center justify-center p-6"
          >
            <div className="bg-black/80 border border-white/10 p-12 rounded-3xl max-w-md w-full space-y-8 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 to-purple-500" />
              <div className="text-center space-y-2">
                <h3 className="text-2xl font-black italic text-white uppercase">Initialize_Lobby</h3>
                <p className="text-[10px] text-white/40 uppercase tracking-widest">Configure_Network_Parameters</p>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] text-white/40 uppercase tracking-widest">Lobby Name</label>
                  <input 
                    type="text"
                    value={newLobbyName}
                    onChange={(e) => setNewLobbyName(e.target.value)}
                    placeholder="Enter lobby name..."
                    className="w-full bg-white/5 border border-white/10 p-4 text-white font-mono text-sm focus:border-cyan-500 outline-none transition-colors rounded-lg"
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] text-white/40 uppercase tracking-widest">Access Password (Optional)</label>
                  <input 
                    type="password"
                    value={newLobbyPassword}
                    onChange={(e) => setNewLobbyPassword(e.target.value)}
                    placeholder="Leave empty for public..."
                    className="w-full bg-white/5 border border-white/10 p-4 text-white font-mono text-sm focus:border-cyan-500 outline-none transition-colors rounded-lg"
                  />
                </div>
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={() => setIsCreateModalOpen(false)}
                  className="flex-1 py-4 bg-white/5 border border-white/10 text-white font-bold uppercase tracking-widest hover:bg-white/10 transition-colors rounded-lg"
                >
                  Cancel
                </button>
                <button 
                  onClick={createLobby}
                  disabled={isCreatingLobby || !newLobbyName.trim()}
                  className="flex-1 py-4 bg-cyan-500 text-black font-bold uppercase tracking-widest hover:bg-cyan-400 transition-all disabled:opacity-50 rounded-lg"
                >
                  {isCreatingLobby ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {isJoinPasswordModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-[120] bg-black/90 backdrop-blur-2xl flex items-center justify-center p-6"
          >
            <div className="bg-black/80 border border-white/10 p-12 rounded-3xl max-w-md w-full space-y-8 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-cyan-500" />
              <div className="text-center space-y-2">
                <h3 className="text-2xl font-black italic text-white uppercase">Security_Check</h3>
                <p className="text-[10px] text-white/40 uppercase tracking-widest">Enter_Lobby_Password</p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] text-white/40 uppercase tracking-widest">Password</label>
                <input 
                  type="password"
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                  placeholder="Enter password..."
                  className="w-full bg-white/5 border border-white/10 p-4 text-white font-mono text-sm focus:border-cyan-500 outline-none transition-colors rounded-lg"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && lobbyToJoin) joinLobby(lobbyToJoin);
                  }}
                />
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={() => {
                    setIsJoinPasswordModalOpen(false);
                    setJoinPassword('');
                    setLobbyToJoin(null);
                  }}
                  className="flex-1 py-4 bg-white/5 border border-white/10 text-white font-bold uppercase tracking-widest hover:bg-white/10 transition-colors rounded-lg"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => lobbyToJoin && joinLobby(lobbyToJoin)}
                  disabled={!joinPassword}
                  className="flex-1 py-4 bg-cyan-500 text-black font-bold uppercase tracking-widest hover:bg-cyan-400 transition-all disabled:opacity-50 rounded-lg"
                >
                  Join
                </button>
              </div>
            </div>
          </motion.div>
        )}
        {isModeSelecting && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/90 backdrop-blur-2xl flex flex-col items-center justify-center p-8"
          >
            <div className="max-w-4xl w-full space-y-12">
              <div className="text-center space-y-2">
                <h2 className="text-5xl font-black tracking-tighter italic text-white uppercase">Select_Game_Mode</h2>
                <div className="text-[10px] text-cyan-500 uppercase tracking-[0.4em]">Protocol_Selection // Node_77</div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                  { id: 'NORMAL', name: 'Normal Mode', desc: 'Standard network infiltration protocol. Standard seeker parameters.' },
                  { id: 'CHANGING_MAZE', name: 'Changing Maze', desc: 'Dynamic network architecture. Walls shift every 15 seconds. Adapt or be purged.' },
                  { id: 'HARD', name: 'Hard Mode', desc: 'Pro Seekers. Increased speed, faster detection, and rapid deployment.' }
                ].map((mode) => (
                  <div key={mode.id} className="relative group">
                    <button 
                      onClick={() => {
                        playSFX('click');
                        setGameMode(mode.id as GameMode);
                        setIsModeSelecting(false);
                        if (mode.id === 'NORMAL') {
                          setIsMapSelecting(true);
                        } else {
                          // For other modes, we use their specific maps and start directly
                          setSelectedMapIndex(0); // Reset map index just in case
                          resetGame();
                        }
                      }}
                      className="w-full p-8 bg-white/5 border border-white/10 hover:border-cyan-500/50 transition-all text-left space-y-4 group-hover:bg-white/10"
                    >
                      <div className="text-2xl font-black italic tracking-tighter text-white group-hover:text-cyan-400 transition-colors">
                        {mode.name}
                      </div>
                      <div className="text-[10px] text-white/40 uppercase tracking-widest line-clamp-2">
                        {mode.desc}
                      </div>
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        playSFX('click');
                        setModeInfoOpen(mode.id as GameMode);
                      }}
                      className="absolute top-4 right-4 w-6 h-6 rounded-full border border-white/20 flex items-center justify-center text-[10px] hover:bg-white hover:text-black transition-colors"
                    >
                      i
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-center">
                <button 
                  onClick={() => setIsModeSelecting(false)}
                  className="px-8 py-3 bg-white/5 border border-white/10 text-white/40 font-bold text-xs uppercase tracking-widest hover:text-white transition-colors"
                >
                  Back_To_Menu
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {modeInfoOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6"
          >
            <div className="bg-black/90 border border-cyan-500/30 p-10 rounded-2xl max-w-lg w-full space-y-8 relative shadow-[0_0_50px_rgba(6,182,212,0.1)]">
              <div className="space-y-2">
                <h3 className="text-3xl font-black italic tracking-tighter text-cyan-400 uppercase">
                  {modeInfoOpen === 'NORMAL' ? 'Normal Mode' : 
                   modeInfoOpen === 'CHANGING_MAZE' ? 'The Changing Maze' : 
                   'Hard Mode'}
                </h3>
                <div className="text-[10px] text-white/40 uppercase tracking-widest">Protocol_Details // Sector_9</div>
              </div>

              <div className="space-y-6 text-white/80 text-sm leading-relaxed">
                {modeInfoOpen === 'NORMAL' && (
                  <ul className="space-y-4 list-disc pl-4 marker:text-cyan-500">
                    <li>Standard seeker detection speed: 1.0x.</li>
                    <li>Seeker movement speed: Standard.</li>
                    <li>Seeker spawn rate: 10 seconds.</li>
                    <li>Power-up spawn rate: 15 seconds.</li>
                    <li>Static network architecture (walls do not move).</li>
                    <li>Ideal for initial system infiltration.</li>
                  </ul>
                )}
                {modeInfoOpen === 'CHANGING_MAZE' && (
                  <ul className="space-y-4 list-disc pl-4 marker:text-cyan-500">
                    <li>Dynamic network architecture: Walls shift every 5 seconds.</li>
                    <li>Safety Protocol: The system ensures you are never trapped within a wall segment.</li>
                    <li>Seeker detection speed: 1.0x.</li>
                    <li>Seeker spawn rate: 10 seconds.</li>
                    <li>Power-up spawn rate: 15 seconds.</li>
                    <li>Adaptability is key: Memorized paths will become obsolete quickly.</li>
                    <li>Exclusive Dynamic Sector map.</li>
                  </ul>
                )}
                {modeInfoOpen === 'HARD' && (
                  <ul className="space-y-4 list-disc pl-4 marker:text-cyan-500">
                    <li>Pro Seekers: Detection speed increased by 25%.</li>
                    <li>Enhanced Mobility: Seeker movement speed increased by 15%.</li>
                    <li>Rapid Deployment: Seeker spawn rate reduced to 7 seconds.</li>
                    <li>Power-up spawn rate: 20 seconds.</li>
                    <li>Maximum security protocol active. Extreme caution advised.</li>
                    <li>Exclusive Black Ops Sector map.</li>
                  </ul>
                )}
              </div>

              <button 
                onClick={() => setModeInfoOpen(null)}
                className="w-full py-4 bg-cyan-500 text-black font-black text-sm uppercase tracking-[0.2em] hover:bg-cyan-400 transition-colors"
              >
                Acknowledge_Protocol
              </button>
            </div>
          </motion.div>
        )}

        {isMapSelecting && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/90 backdrop-blur-2xl flex flex-col items-center justify-center p-8"
          >
            <div className="max-w-6xl w-full">
              <div className="flex justify-between items-end mb-12">
                <div>
                  <h2 className="text-4xl font-black tracking-tighter italic text-white mb-2">SELECT_ARENA</h2>
                  <p className="text-white/40 text-xs uppercase tracking-widest">Available_Nodes // Sector_7</p>
                </div>
                <button 
                  onClick={() => {
                    playSFX('click');
                    setIsMapSelecting(false);
                  }}
                  className="text-xs text-white/40 hover:text-white uppercase tracking-widest"
                >
                  [Back_To_Menu]
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {MAPS.map((map, index) => (
                  <motion.div 
                    key={index}
                    onMouseEnter={() => setHoveredMapIndex(index)}
                    onMouseLeave={() => setHoveredMapIndex(null)}
                    whileHover={{ scale: 1.02 }}
                    className={`relative group bg-white/5 border ${selectedMapIndex === index ? 'border-cyan-500' : 'border-white/10'} rounded-xl p-6 transition-all overflow-hidden`}
                  >
                    <div className="flex justify-center mb-6">
                      <MapPreview grid={map.grid} />
                    </div>
                    <h3 className="text-xl font-bold mb-2 text-white">{map.name}</h3>
                    <p className="text-[10px] text-white/40 mb-6 leading-relaxed uppercase tracking-wider">{map.description}</p>
                    
                    {/* Hover Overlay */}
                    <AnimatePresence>
                      {hoveredMapIndex === index && (
                        <motion.div 
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 20 }}
                          className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 gap-3 z-10"
                        >
                          <button 
                            onClick={() => {
                              playSFX('click');
                              setSelectedMapIndex(index);
                              resetGame();
                            }}
                            className="w-full py-3 bg-cyan-500 text-black font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-cyan-400 transition-colors"
                          >
                            Play_Node <Play size={14} fill="currentColor" />
                          </button>
                          <button 
                            onClick={() => {
                              playSFX('click');
                              setSelectedMapIndex(index);
                              setShowLeaderboardOnGameOver(true);
                              setUiStatus('CAUGHT');
                            }}
                            className="w-full py-3 bg-white/10 border border-white/20 text-white font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-white/20 transition-colors"
                          >
                            Leaderboard <Trophy size={14} />
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {uiStatus === 'CAUGHT' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={`absolute inset-0 z-50 ${isMultiplayer ? (currentLobby?.winner === auth.currentUser?.uid ? 'bg-cyan-950/90' : 'bg-red-950/90') : (showLeaderboardOnGameOver ? 'bg-cyan-950/90' : 'bg-red-950/90')} backdrop-blur-xl flex items-center justify-center transition-colors duration-500 overflow-y-auto p-4`}
          >
            <div className="text-center space-y-6 max-w-xl px-4 w-full my-auto">
              <div className="space-y-2">
                <h2 className={`text-5xl md:text-7xl lg:text-8xl font-black ${isMultiplayer ? (currentLobby?.winner === auth.currentUser?.uid ? 'text-cyan-500' : 'text-red-500') : (showLeaderboardOnGameOver ? 'text-cyan-500' : 'text-red-500')} tracking-tighter italic transition-colors duration-500`}>
                  {isMultiplayer ? (currentLobby?.winner === auth.currentUser?.uid ? 'VICTORY' : 'DEFEATED') : (showLeaderboardOnGameOver ? 'LEADERBOARD' : 'TERMINATED')}
                </h2>
                <p className={`${isMultiplayer ? (currentLobby?.winner === auth.currentUser?.uid ? 'text-cyan-200/40' : 'text-red-200/40') : (showLeaderboardOnGameOver ? 'text-cyan-200/40' : 'text-red-200/40')} text-[10px] md:text-xs uppercase tracking-widest transition-colors duration-500`}>
                  {isMultiplayer ? (currentLobby?.winner === auth.currentUser?.uid ? 'System_Infiltrated // You_Survived' : 'System_Purged // Connection_Lost') : (showLeaderboardOnGameOver ? 'Global_Data_Logs // High_Scores' : 'Subject_Compromised // Connection_Lost')}
                </p>
              </div>
              
              <div className={`bg-black/40 p-4 md:p-8 rounded-2xl border ${isMultiplayer ? (currentLobby?.winner === auth.currentUser?.uid ? 'border-cyan-500/20' : 'border-red-500/20') : (showLeaderboardOnGameOver ? 'border-cyan-500/20' : 'border-red-500/20')} w-full transition-colors duration-500`}>
                {isMultiplayer ? (
                  <div className="space-y-8">
                    <div className="grid grid-cols-2 gap-8">
                      <div className="p-6 bg-white/5 border border-white/10 rounded-xl space-y-2">
                        <div className="text-[10px] text-white/40 uppercase tracking-widest">Your_Packets</div>
                        <div className="text-4xl font-black text-white italic">{dotsCollected}</div>
                        <div className="text-[8px] text-yellow-400 uppercase tracking-widest">P{playerRole === 'HOST' ? '1' : '2'} // {auth.currentUser?.displayName}</div>
                      </div>
                      <div className="p-6 bg-white/5 border border-white/10 rounded-xl space-y-2">
                        <div className="text-[10px] text-white/40 uppercase tracking-widest">Opponent_Packets</div>
                        <div className="text-4xl font-black text-white italic">{player2Dots}</div>
                        <div className="text-[8px] text-green-400 uppercase tracking-widest">P{playerRole === 'HOST' ? '2' : '1'} // {playerRole === 'HOST' ? currentLobby?.guestName : currentLobby?.hostName}</div>
                      </div>
                    </div>
                    
                    <div className="flex flex-col gap-4">
                      <button 
                        onClick={backToMenu}
                        className="w-full py-4 bg-white text-black font-black uppercase tracking-widest hover:bg-cyan-400 transition-all"
                      >
                        Return_To_Interface
                      </button>
                    </div>
                  </div>
                ) : showLeaderboardOnGameOver ? (
                  <div className="space-y-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                      <div className="flex items-center gap-2 text-cyan-400">
                        <Trophy size={18} />
                        <span className="text-xs font-bold uppercase tracking-widest">{MAPS[selectedMapIndex].name}_Logs</span>
                      </div>
                      
                      <div className="flex gap-2">
                        {['NORMAL', 'CHANGING_MAZE', 'HARD'].map((m) => (
                          <button
                            key={m}
                            onClick={() => {
                              playSFX('click');
                              setGameMode(m as GameMode);
                            }}
                            className={`px-3 py-1 text-[8px] uppercase tracking-widest border transition-all ${
                              gameMode === m 
                                ? 'bg-cyan-500 border-cyan-500 text-black font-bold' 
                                : 'bg-white/5 border-white/10 text-white/40 hover:text-white'
                            }`}
                          >
                            {m.replace('_', ' ')}
                          </button>
                        ))}
                      </div>

                      <button 
                        onClick={() => {
                          playSFX('click');
                          setShowLeaderboardOnGameOver(false);
                          if (!isGameStarted) setUiStatus('HIDING'); // Reset the trick
                        }}
                        className="text-[10px] text-white/40 hover:text-white uppercase"
                      >
                        [Back_To_Stats]
                      </button>
                    </div>
                      <div className="space-y-3">
                        {(leaderboards[`${gameMode}_${selectedMapIndex}`] || []).length > 0 ? (
                          (leaderboards[`${gameMode}_${selectedMapIndex}`] || []).map((entry, i) => (
                            <div key={entry.id || `entry-${entry.uid}-${i}`} className="flex flex-col border-b border-white/5 pb-2">
                              <div className="flex justify-between items-center text-[10px]">
                                <div className="flex gap-3 items-center">
                                  <span className="text-white/20">0{i + 1}</span>
                                  <span className="text-white/80 font-bold">{entry.name}</span>
                                  {isAdmin && (leaderboardEmails[`${entry.uid}_${selectedMapIndex}_${gameMode}`] || entry.email) && (
                                    <span className="text-[8px] text-cyan-400/60 font-mono ml-2 px-2 py-0.5 bg-cyan-400/5 rounded border border-cyan-400/10">
                                      {leaderboardEmails[`${entry.uid}_${selectedMapIndex}_${gameMode}`] || entry.email}
                                    </span>
                                  )}
                                </div>
                                <div className="flex gap-4">
                                  <span className="text-white font-bold">{entry.dots}</span>
                                  <span className="text-cyan-400">{formatTime(entry.time)}</span>
                                </div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-[10px] text-white/20 text-center py-8 italic">No data logs found for {gameMode.replace('_', ' ')} mode...</div>
                        )}
                      </div>
                  </div>
                ) : (
                  <>
                    <div className="text-red-400 text-[10px] uppercase mb-6">Final_Data_Log</div>
                    <div className="flex justify-center gap-12 mb-8">
                      <div>
                        <div className="text-white/40 text-[10px] mb-1 uppercase">Data_Nodes</div>
                        <div className="text-4xl font-bold text-white">{dotsCollected}</div>
                      </div>
                      <div>
                        <div className="text-white/40 text-[10px] mb-1 uppercase">Survival</div>
                        <div className="text-4xl font-bold">{formatTime(uiSurvivalTime)}</div>
                      </div>
                    </div>

                    {!isScoreSaved ? (
                      <div className="space-y-4">
                        {!auth.currentUser ? (
                          <div className="space-y-4">
                            <div className="text-[10px] text-white/40 uppercase tracking-widest">
                              Authentication_Required_To_Save_Log
                            </div>
                            <button 
                              onClick={handleGoogleSignIn}
                              className="w-full py-3 bg-white text-black font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-cyan-400 transition-all"
                            >
                              <LogIn size={16} /> Sign_In_With_Google
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="text-[10px] text-white/40 uppercase tracking-widest">
                              Logged_In_As: <span className="text-cyan-400">{auth.currentUser.displayName || 'Anonymous_Agent'}</span>
                            </div>
                            <button 
                              onClick={() => {
                                playSFX('click');
                                saveToLeaderboard();
                              }}
                              className="w-full py-4 bg-red-500 text-white font-bold text-xs uppercase tracking-widest hover:bg-red-400 transition-colors"
                            >
                              Save_Best_Run
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-cyan-400 text-xs font-bold uppercase tracking-widest animate-pulse">
                        Log_Securely_Stored_In_Database
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="flex flex-wrap justify-center gap-4">
                <button 
                  onClick={() => {
                    playSFX('click');
                    resetGame();
                  }}
                  className={`px-8 py-3 ${showLeaderboardOnGameOver ? 'bg-cyan-500' : 'bg-red-500'} text-white font-bold uppercase tracking-widest flex items-center gap-2 hover:opacity-80 transition-all`}
                >
                  Retry_Sequence <RefreshCcw size={16} />
                </button>
                <button 
                  onClick={() => {
                    playSFX('click');
                    const nextValue = !showLeaderboardOnGameOver;
                    setShowLeaderboardOnGameOver(nextValue);
                    if (!nextValue && !isGameStarted) setUiStatus('HIDING');
                  }}
                  className={`px-8 py-3 border ${showLeaderboardOnGameOver ? 'border-cyan-500/40 bg-cyan-500/10' : 'border-white/20'} text-white font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-white/10 transition-colors`}
                >
                  {showLeaderboardOnGameOver ? 'Back_To_Stats' : 'Leaderboards'} <Trophy size={16} />
                </button>
                <button 
                  onClick={() => {
                    playSFX('click');
                    backToMenu();
                  }}
                  className="px-8 py-3 border border-white/20 text-white font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-white/10 transition-colors"
                >
                  Main_Menu <Play size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Info */}
      <div className="absolute bottom-4 w-full px-8 flex justify-between text-[8px] text-white/10 uppercase tracking-widest">
        <div className="flex gap-4">
          <span className="flex items-center gap-1"><div className="w-1 h-1 bg-green-500 rounded-full" /> Engine: Active</span>
          <span className="flex items-center gap-1"><div className="w-1 h-1 bg-green-500 rounded-full" /> Latency: 14ms</span>
          <span className="flex items-center gap-1"><div className="w-1 h-1 bg-purple-500 rounded-full" /> Recording_Session...</span>
        </div>
        <div>Ghost_Unit_01 // © 2144 Neon_Shadows_Labs // V2.0.4-Beta</div>
      </div>
    </div>
  );
};

export default () => (
  <ErrorBoundary>
    <GameEngine />
  </ErrorBoundary>
);
