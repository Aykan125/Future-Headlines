import { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import { HostLobby } from './components/HostLobby';
import { JoinLobby } from './components/JoinLobby';
import { JoinByLinkPage } from './pages/JoinByLinkPage';
import { useSocket } from './hooks/useSocket';
import { Card, Button } from './components/ui';

const API_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

function App() {
  const navigate = useNavigate();
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [initialized, setInitialized] = useState(false);

  const [sessionData, setSessionData] = useState<{
    joinCode: string;
    playerId: string;
    isHost: boolean;
  } | null>(null);

  const { connected, sessionState, headlines, roundSummary, finalSummary, joinLobby, leaveLobby, startGame, submitHeadline, loadHeadlines, requestSummary, requestFinalSummary } = useSocket();

  // load session from localstorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('futureHeadlines_session');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // skip auto-rejoin on /join/:joinCode so a new invite link isn't blocked by an old session
        const isJoinPage = window.location.pathname.startsWith('/join/');
        if (!isJoinPage && parsed.joinCode && parsed.playerId) {
          setSessionData(parsed);
          joinLobby(parsed.joinCode, parsed.playerId);
          navigate(`/lobby/${parsed.joinCode}`, { replace: true });
        }
      } catch (err) {
        console.error('Failed to parse stored session:', err);
        localStorage.removeItem('futureHeadlines_session');
      }
    }
    setInitialized(true);
  }, []);

  // persist sessiondata to localstorage
  useEffect(() => {
    if (sessionData) {
      localStorage.setItem('futureHeadlines_session', JSON.stringify(sessionData));
    }
  }, [sessionData]);

  const handleCreateSession = async () => {
    if (!nickname.trim()) {
      setError('Please enter a nickname');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostNickname: nickname.trim() }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create session');
      }

      const data = await response.json();
      const newSessionData = {
        joinCode: data.session.joinCode,
        playerId: data.player.id,
        isHost: true,
      };

      setSessionData(newSessionData);

      const joined = await joinLobby(data.session.joinCode, data.player.id);
      if (joined) {
        navigate(`/lobby/${data.session.joinCode}`);
      } else {
        setError('Failed to connect to lobby');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create session');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinSession = async (joinCode: string, playerNickname: string) => {
    setLoading(true);
    setError('');

    try {
      const code = joinCode.trim().toUpperCase();
      const response = await fetch(`${API_URL}/api/sessions/${code}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: playerNickname.trim() }),
      });

      if (!response.ok) {
        const errData = await response.json();
        // if game already started, try to recover existing player by nickname
        if (response.status === 400 && errData.error === 'Cannot join session') {
          const rejoinResponse = await fetch(`${API_URL}/api/sessions/${code}/rejoin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname: playerNickname.trim() }),
          });
          if (!rejoinResponse.ok) {
            const rejoinData = await rejoinResponse.json();
            throw new Error(rejoinData.message || 'Game in progress — nickname not found in this session');
          }
          const rejoinData = await rejoinResponse.json();
          const newSessionData = {
            joinCode: code,
            playerId: rejoinData.player.id,
            isHost: rejoinData.player.isHost,
          };
          setSessionData(newSessionData);
          const joined = await joinLobby(code, rejoinData.player.id);
          if (joined) {
            navigate(`/lobby/${code}`);
          } else {
            setError('Failed to connect to lobby');
          }
          return;
        }
        throw new Error(errData.error || errData.message || 'Failed to join session');
      }

      const data = await response.json();
      const newSessionData = {
        joinCode: data.session.joinCode,
        playerId: data.player.id,
        isHost: false,
      };

      setSessionData(newSessionData);

      const joined = await joinLobby(data.session.joinCode, data.player.id);
      if (joined) {
        navigate(`/lobby/${data.session.joinCode}`);
      } else {
        setError('Failed to connect to lobby');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to join session');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    leaveLobby();
    setSessionData(null);
    localStorage.removeItem('futureHeadlines_session');
    navigate('/');
    setNickname('');
    setError('');
  };

  const handleStartGame = async () => {
    if (!sessionData) return;
    const success = await startGame(sessionData.joinCode);
    if (success) console.log('Game started!');
  };

  const handleSubmitHeadline = async (headline: string) => {
    if (!sessionData) return { success: false, error: 'Not connected to a session' };
    return submitHeadline(sessionData.joinCode, headline);
  };

  // load headlines when phase changes to playing
  useEffect(() => {
    if (sessionState?.phase === 'PLAYING' && sessionData?.joinCode) {
      loadHeadlines(sessionData.joinCode);
    }
  }, [sessionState?.phase, sessionData?.joinCode, loadHeadlines]);

  // request round summary on reconnect during break
  useEffect(() => {
    if (sessionState?.phase === 'BREAK' && sessionData?.joinCode && !roundSummary) {
      requestSummary(sessionData.joinCode, sessionState.currentRound);
    }
  }, [sessionState?.phase, sessionState?.currentRound, sessionData?.joinCode, roundSummary, requestSummary]);

  // request final narrative summary on finished and load all headlines for game-end stats
  useEffect(() => {
    if (sessionState?.phase === 'FINISHED' && sessionData?.joinCode) {
      if (!finalSummary) {
        requestFinalSummary(sessionData.joinCode, sessionState.currentRound);
      }
      loadHeadlines(sessionData.joinCode);
    }
  }, [sessionState?.phase, sessionState?.currentRound, sessionData?.joinCode, finalSummary, requestFinalSummary, loadHeadlines]);

  const loadingScreen = (
    <div className="h-[100dvh] overflow-hidden bg-gradient-to-b from-gray-50 to-gray-100/80 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-gray-200 border-t-indigo-500 mx-auto mb-3" />
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    </div>
  );

  const lobbyElement = !initialized ? (
    loadingScreen
  ) : !sessionData ? (
    <Navigate to="/" replace />
  ) : sessionState ? (
    sessionData.isHost ? (
      <HostLobby
        joinCode={sessionState.joinCode}
        players={sessionState.players}
        currentPlayerId={sessionData.playerId}
        phase={sessionState.phase}
        currentRound={sessionState.currentRound}
        maxRounds={sessionState.maxRounds}
        playMinutes={sessionState.playMinutes}
        phaseStartedAt={sessionState.phaseStartedAt}
        phaseEndsAt={sessionState.phaseEndsAt}
        serverNow={sessionState.serverNow}
        inGameNow={sessionState.inGameNow}
        timelineSpeedRatio={sessionState.timelineSpeedRatio}
        headlines={headlines}
        roundSummary={roundSummary}
        finalSummary={finalSummary}
        onStartGame={handleStartGame}
        onBack={handleBack}
        onSubmitHeadline={handleSubmitHeadline}
      />
    ) : (
      <JoinLobby
        joinCode={sessionState.joinCode}
        players={sessionState.players}
        currentPlayerId={sessionData.playerId}
        isHost={sessionData.isHost}
        phase={sessionState.phase}
        currentRound={sessionState.currentRound}
        maxRounds={sessionState.maxRounds}
        playMinutes={sessionState.playMinutes}
        phaseStartedAt={sessionState.phaseStartedAt}
        phaseEndsAt={sessionState.phaseEndsAt}
        serverNow={sessionState.serverNow}
        inGameNow={sessionState.inGameNow}
        timelineSpeedRatio={sessionState.timelineSpeedRatio}
        headlines={headlines}
        roundSummary={roundSummary}
        finalSummary={finalSummary}
        onBack={handleBack}
        onSubmitHeadline={handleSubmitHeadline}
      />
    )
  ) : (
    loadingScreen
  );

  return (
    <Routes>
      <Route path="/" element={
        <div className="h-[100dvh] overflow-hidden bg-gradient-to-b from-gray-50 to-gray-100/80 flex items-center justify-center p-4">
          <div className="max-w-sm w-full space-y-6">
            <div className="text-center space-y-1">
              <h1 className="text-4xl font-bold text-gray-900">Future Headlines</h1>
              <p className="text-sm text-gray-500">Create a game and invite players with a link</p>
            </div>

            <div className="flex items-center justify-center gap-2">
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
              <span className="text-xs text-gray-500">{connected ? 'Connected' : 'Disconnected'}</span>
            </div>

            <Card padding="lg" className="space-y-5">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">
                  Nickname
                </label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="Enter your nickname"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent bg-gray-50"
                  maxLength={20}
                  onKeyDown={(e) => e.key === 'Enter' && !loading && handleCreateSession()}
                />
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                  {error}
                </div>
              )}

              <Button
                fullWidth
                size="lg"
                onClick={handleCreateSession}
                disabled={loading || !connected}
              >
                {loading ? 'Creating...' : 'Create New Game'}
              </Button>
            </Card>

            <p className="text-xs text-center text-gray-400">
              After creating, you'll get an invite link to share with players.
            </p>
          </div>
        </div>
      } />

      <Route path="/join/:joinCode" element={
        <JoinByLinkPage
          connected={connected}
          loading={loading}
          error={error}
          onJoinSession={handleJoinSession}
        />
      } />

      <Route path="/lobby/:joinCode" element={lobbyElement} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
