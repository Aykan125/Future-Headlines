import { useState } from 'react';
import { GameLayout } from './GameLayout';
import { Card, Button } from './ui';
import { Headline, RoundSummary as RoundSummaryType, FinalSummary } from '../hooks/useSocket';
import { useGameTimeProgress } from '../hooks/useGameTimeProgress';

interface HostLobbyProps {
  joinCode: string;
  players: any[];
  currentPlayerId: string;
  phase: string;
  currentRound: number;
  maxRounds: number;
  playMinutes: number;
  phaseStartedAt: string | null;
  phaseEndsAt: string | null;
  serverNow: string;
  inGameNow: string | null;
  timelineSpeedRatio: number;
  headlines: Headline[];
  roundSummary: RoundSummaryType | null;
  finalSummary: FinalSummary | null;
  onStartGame: () => void;
  onBack: () => void;
  onSubmitHeadline: (headline: string) => Promise<{ success: boolean; error?: string; cooldownMs?: number }>;
}

export function HostLobby({
  joinCode,
  players,
  currentPlayerId,
  phase,
  currentRound,
  maxRounds,
  playMinutes,
  phaseStartedAt,
  phaseEndsAt,
  serverNow,
  inGameNow,
  timelineSpeedRatio,
  headlines,
  roundSummary,
  finalSummary,
  onStartGame,
  onBack,
  onSubmitHeadline,
}: HostLobbyProps) {
  const [copied, setCopied] = useState(false);

  const { totalGameMins, currentGameMins } = useGameTimeProgress({
    phase,
    currentRound,
    maxRounds,
    playMinutes,
    phaseStartedAt,
    serverNow,
  });

  const currentPlayer = players.find((p) => p.id === currentPlayerId);
  const priorityPlanet = currentPlayer?.priorityPlanet ?? null;
  const myScore = currentPlayer?.totalScore ?? 0;

  const inviteLink = `${window.location.origin}/join/${joinCode}`;

  const copyInviteLink = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lobbyContent = (
    <>
      <div className="text-center space-y-1">
        <h1 className="text-3xl font-bold text-gray-900">Game Lobby</h1>
        <p className="text-sm text-gray-500">Share the invite link with players</p>
      </div>

      <Card padding="lg" className="text-center space-y-3">
        <p className="text-xs text-gray-400 uppercase tracking-wider">Game Code</p>
        <span className="text-4xl font-mono font-bold text-indigo-600 tracking-widest block">
          {joinCode}
        </span>
        <div className="pt-2 border-t border-gray-100">
          <Button variant="secondary" size="sm" onClick={copyInviteLink}>
            {copied ? 'Link Copied!' : 'Copy Invite Link'}
          </Button>
        </div>
      </Card>

      <Button
        fullWidth
        size="lg"
        onClick={onStartGame}
        disabled={players.length < 2}
      >
        {players.length < 2 ? 'Need 2+ players to start' : 'Start Game'}
      </Button>

      <p className="text-xs text-center text-gray-400">
        Share the invite link so other players can join.
      </p>
    </>
  );

  return (
    <GameLayout
      joinCode={joinCode}
      players={players}
      currentPlayerId={currentPlayerId}
      phase={phase}
      currentRound={currentRound}
      maxRounds={maxRounds}
      phaseEndsAt={phaseEndsAt}
      serverNow={serverNow}
      inGameNow={inGameNow}
      timelineSpeedRatio={timelineSpeedRatio}
      headlines={headlines}
      roundSummary={roundSummary}
      finalSummary={finalSummary}
      priorityPlanet={priorityPlanet}
      myScore={myScore}
      totalGameMins={totalGameMins}
      currentGameMins={currentGameMins}
      onSubmitHeadline={onSubmitHeadline}
      onBack={onBack}
      lobbyContent={lobbyContent}
    />
  );
}
