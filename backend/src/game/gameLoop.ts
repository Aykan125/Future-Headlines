import pool from '../db/pool.js';
import {
  GamePhase,
  GameSessionConfig,
  GameSessionRuntimeState,
} from './types.js';
import { Server } from 'socket.io';
import { migratePlanetState } from './planetWeighting.js';
import { DEFAULT_PLANETS } from './scoringTypes.js';
import { generateRoundSummary, generateFinalNarrativeSummary } from './summaryService.js';
import { getPlayerScoreBreakdowns } from './scoringService.js';
import { SEED_HEADLINES } from './seedHeadlines.js';

/**
 * test mode: when GAME_TEST_MODE=true, all time-based durations
 * (tutorial, breaks, rounds, cooldown) are scaled by 1/16 so the
 * full game flow can be exercised in ~3 minutes instead of ~46.
 * does not affect production behaviour — flag must be explicitly set.
 */
const TEST_MODE = process.env.GAME_TEST_MODE === 'true';
const TIME_SCALE = TEST_MODE ? 1 / 16 : 1;

if (TEST_MODE) {
  console.log('[GameLoop] ⚡ GAME_TEST_MODE active — all durations scaled by 1/16');
}

const ROUND_SPEED_WEIGHTS = [2, 4, 6, 8];
const TOTAL_INGAME_MS = 20 * 365.25 * 24 * 60 * 60 * 1000;
const TUTORIAL_DURATION_MS = Math.round(3 * 60 * 1000 * TIME_SCALE); // 3 min normally, ~11s in test mode

/**
 * per-break configuration indexed by round number just completed.
 * after round 1 → BREAK_SCHEDULE[0], after round 2 → BREAK_SCHEDULE[1], etc.
 *
 * selective summary generation: only break 2 (after round 2) has a summary,
 * and it covers rounds 1-2. the final summary (covering all 4 rounds) is
 * generated on the FINISHED transition instead.
 */
interface BreakConfig {
  durationMin: number;
  generateSummary: boolean;
  summaryFromRound: number | null; // inclusive; null means no summary
}

const BREAK_SCHEDULE: BreakConfig[] = [
  { durationMin: 3 * TIME_SCALE, generateSummary: false, summaryFromRound: null },  // after r1
  { durationMin: 5 * TIME_SCALE, generateSummary: true, summaryFromRound: 1 },      // after r2: covers r1-r2
  { durationMin: 3 * TIME_SCALE, generateSummary: false, summaryFromRound: null },  // after r3
];

/** exported for testing */
export function getBreakConfig(roundNo: number): BreakConfig {
  const idx = roundNo - 1;
  if (idx < 0 || idx >= BREAK_SCHEDULE.length) {
    // fallback for rounds outside the schedule
    return { durationMin: 3, generateSummary: false, summaryFromRound: null };
  }
  return BREAK_SCHEDULE[idx];
}

/** exported for testing */
export function computeRoundSpeedRatio(roundNo: number, playMinutes: number): number {
  const totalWeight = ROUND_SPEED_WEIGHTS.reduce((a, b) => a + b, 0);
  const roundWeight =
    ROUND_SPEED_WEIGHTS[roundNo - 1] ??
    ROUND_SPEED_WEIGHTS[ROUND_SPEED_WEIGHTS.length - 1];
  const roundInGameMs = (roundWeight / totalWeight) * TOTAL_INGAME_MS;
  return roundInGameMs / (playMinutes * 60_000);
}

/**
 * pure function to compute the next phase and round based on current state.
 * exported for testing.
 */
export function computeNextPhase(
  currentPhase: GamePhase,
  currentRound: number,
  maxRounds: number
): { phase: GamePhase; round: number } {
  if (currentPhase === 'TUTORIAL') {
    return { phase: 'PLAYING', round: 1 };
  }

  if (currentPhase === 'PLAYING') {
    // after playing the last round, go directly to finished (no final break)
    if (currentRound >= maxRounds) {
      return { phase: 'FINISHED', round: currentRound };
    }
    // after non-final rounds, go to break (same round)
    return { phase: 'BREAK', round: currentRound };
  } else if (currentPhase === 'BREAK') {
    if (currentRound >= maxRounds) {
      return { phase: 'FINISHED', round: currentRound };
    } else {
      return { phase: 'PLAYING', round: currentRound + 1 };
    }
  } else {
    // should not happen in normal flow
    return { phase: 'FINISHED', round: currentRound };
  }
}

/**
 * in-memory representation of a running game loop for a single session
 */
class GameLoopInstance {
  private timerHandle: NodeJS.Timeout | null = null;
  private seedDripHandle: NodeJS.Timeout | null = null;
  private archivePlayerId: string | null = null;
  private state: GameSessionRuntimeState;
  private io: Server;

  constructor(config: GameSessionConfig, io: Server) {
    this.state = {
      ...config,
      phase: 'WAITING',
      currentRound: 0,
      phaseStartedAt: null,
      phaseEndsAt: null,
      inGameStartAt: null,
    };
    this.io = io;
  }

  getState(): GameSessionRuntimeState {
    return { ...this.state };
  }

  async loadFromDatabase(): Promise<void> {
    const result = await pool.query(
      `SELECT phase, current_round, phase_started_at, phase_ends_at, 
              in_game_start_at, play_minutes, break_minutes, max_rounds,
              timeline_speed_ratio
       FROM game_sessions 
       WHERE id = $1`,
      [this.state.sessionId]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      this.state.phase = row.phase as GamePhase;
      this.state.currentRound = row.current_round;
      this.state.phaseStartedAt = row.phase_started_at
        ? new Date(row.phase_started_at)
        : null;
      this.state.phaseEndsAt = row.phase_ends_at
        ? new Date(row.phase_ends_at)
        : null;
      this.state.inGameStartAt = row.in_game_start_at
        ? new Date(row.in_game_start_at)
        : null;
      this.state.playMinutes = row.play_minutes;
      this.state.breakMinutes = row.break_minutes;
      this.state.maxRounds = row.max_rounds;
      this.state.timelineSpeedRatio = row.timeline_speed_ratio;
    }
  }

  async startGame(archivePlayerId?: string): Promise<void> {
    if (this.state.phase !== 'WAITING') {
      throw new Error(
        `Cannot start game from phase ${this.state.phase}, must be WAITING`
      );
    }

    if (archivePlayerId) {
      this.archivePlayerId = archivePlayerId;
    }

    await this.transitionToPhase('TUTORIAL', 0);
  }

  async transitionToPhase(
    toPhase: GamePhase,
    newRound?: number
  ): Promise<void> {
    const fromPhase = this.state.phase;
    const roundNo = newRound !== undefined ? newRound : this.state.currentRound;

    console.log(
      `[GameLoop ${this.state.joinCode}] Transitioning: ${fromPhase} → ${toPhase} (round ${roundNo})`
    );

    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }

    // calculate timing for new phase
    const now = new Date();
    let phaseStartedAt = now;
    let phaseEndsAt: Date | null = null;
    let inGameStartAt = this.state.inGameStartAt;

    // accumulate in-game time from the outgoing phase before resetting phaseStartedAt
    if (inGameStartAt && this.state.phaseStartedAt) {
      const realElapsed = now.getTime() - this.state.phaseStartedAt.getTime();
      const inGameElapsed = realElapsed * this.state.timelineSpeedRatio;
      inGameStartAt = new Date(inGameStartAt.getTime() + inGameElapsed);
    }

    if (toPhase === 'TUTORIAL') {
      this.state.timelineSpeedRatio = 0;
      phaseEndsAt = new Date(now.getTime() + TUTORIAL_DURATION_MS);
    } else if (toPhase === 'PLAYING') {
      if (!inGameStartAt) {
        inGameStartAt = now;
      }
      // in test mode, scale round duration and speed ratio by the same factor
      // so the in-game timeline still spans the full 20 years across the
      // compressed real-time round.
      const effectivePlayMinutes = this.state.playMinutes * TIME_SCALE;
      this.state.timelineSpeedRatio = computeRoundSpeedRatio(roundNo, effectivePlayMinutes);
      phaseEndsAt = new Date(now.getTime() + effectivePlayMinutes * 60 * 1000);
    } else if (toPhase === 'BREAK') {
      this.state.timelineSpeedRatio = 0;
      const breakCfg = getBreakConfig(roundNo);
      phaseEndsAt = new Date(now.getTime() + breakCfg.durationMin * 60 * 1000);
    } else if (toPhase === 'FINISHED') {
      phaseStartedAt = now;
      phaseEndsAt = null;
    }

    this.state.phase = toPhase;
    this.state.currentRound = roundNo;
    this.state.phaseStartedAt = phaseStartedAt;
    this.state.phaseEndsAt = phaseEndsAt;
    this.state.inGameStartAt = inGameStartAt;

    await this.persistStateTransition(fromPhase, toPhase, roundNo);

    await this.broadcastGameState();

    // start seed drip-feed when entering tutorial
    if (toPhase === 'TUTORIAL' && this.archivePlayerId) {
      this.startSeedDrip();
    }

    // stop seed drip when leaving tutorial
    if (fromPhase === 'TUTORIAL' && this.seedDripHandle) {
      clearInterval(this.seedDripHandle);
      this.seedDripHandle = null;
    }

    // generate round summary on break transition (only if this break has one)
    if (toPhase === 'BREAK') {
      const breakCfg = getBreakConfig(roundNo);
      if (breakCfg.generateSummary && breakCfg.summaryFromRound !== null) {
        this.generateAndBroadcastSummary(roundNo, breakCfg.summaryFromRound).catch((err) => {
          console.error(
            `[GameLoop ${this.state.joinCode}] Summary generation failed:`,
            err
          );
        });
      }
    }

    // generate final narrative summary on transition to finished
    if (toPhase === 'FINISHED' && fromPhase !== 'FINISHED') {
      this.generateAndBroadcastFinalNarrative().catch((err) => {
        console.error(
          `[GameLoop ${this.state.joinCode}] Final narrative summary generation failed:`,
          err
        );
      });
    }

    // schedule next transition if not finished
    if (toPhase !== 'FINISHED' && phaseEndsAt) {
      const nextPhase = this.computeNextPhase(toPhase, roundNo);
      const delay = phaseEndsAt.getTime() - now.getTime();

      this.timerHandle = setTimeout(() => {
        this.transitionToPhase(nextPhase.phase, nextPhase.round).catch((err) =>
          console.error(
            `[GameLoop ${this.state.joinCode}] Auto-transition failed:`,
            err
          )
        );
      }, delay);

      console.log(
        `[GameLoop ${this.state.joinCode}] Scheduled transition to ${nextPhase.phase} in ${Math.round(delay / 1000)}s`
      );
    }
  }

  private computeNextPhase(
    currentPhase: GamePhase,
    currentRound: number
  ): { phase: GamePhase; round: number } {
    return computeNextPhase(currentPhase, currentRound, this.state.maxRounds);
  }

  private async persistStateTransition(
    fromPhase: GamePhase,
    toPhase: GamePhase,
    roundNo: number
  ): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE game_sessions
         SET phase = $1,
             current_round = $2,
             phase_started_at = $3,
             phase_ends_at = $4,
             in_game_start_at = $5,
             timeline_speed_ratio = $6,
             status = $7,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $8`,
        [
          toPhase,
          roundNo,
          this.state.phaseStartedAt,
          this.state.phaseEndsAt,
          this.state.inGameStartAt,
          this.state.timelineSpeedRatio,
          toPhase, // keep status in sync with phase for now
          this.state.sessionId,
        ]
      );

      await client.query(
        `INSERT INTO game_session_state_transitions 
         (session_id, from_phase, to_phase, round_no)
         VALUES ($1, $2, $3, $4)`,
        [this.state.sessionId, fromPhase, toPhase, roundNo]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async broadcastGameState(): Promise<void> {
    // get full session state from database (includes players)
    const result = await pool.query(
      `SELECT
        s.id,
        s.join_code,
        s.status,
        s.host_player_id,
        s.phase,
        s.current_round,
        s.play_minutes,
        s.break_minutes,
        s.max_rounds,
        s.phase_started_at,
        s.phase_ends_at,
        s.in_game_start_at,
        s.timeline_speed_ratio,
        CURRENT_TIMESTAMP as server_now,
        json_agg(
          json_build_object(
            'id', p.id,
            'nickname', p.nickname,
            'isHost', p.is_host,
            'joinedAt', p.joined_at,
            'totalScore', p.total_score,
            'planetUsageState', p.planet_usage_state
          ) ORDER BY p.joined_at
        ) as players
      FROM game_sessions s
      LEFT JOIN session_players p ON s.id = p.session_id AND p.is_system = FALSE
      WHERE s.id = $1
      GROUP BY s.id`,
      [this.state.sessionId]
    );

    if (result.rows.length === 0) {
      console.error(
        `[GameLoop ${this.state.joinCode}] Session not found in database`
      );
      return;
    }

    const session = result.rows[0];
    const serverNow = new Date(session.server_now);

    // compute in-game time
    let inGameNow: Date | null = null;
    if (session.in_game_start_at && session.phase_started_at) {
      const inGameStart = new Date(session.in_game_start_at);
      const phaseStart = new Date(session.phase_started_at);
      const realElapsed = serverNow.getTime() - phaseStart.getTime();
      const inGameElapsed = realElapsed * session.timeline_speed_ratio;
      inGameNow = new Date(inGameStart.getTime() + inGameElapsed);
    }

    const breakdowns = await getPlayerScoreBreakdowns(this.state.sessionId);

    // extract currentPriority from each player's planet state
    const processedPlayers = session.players
      .filter((p: any) => p.id !== null)
      .map((p: any) => {
        const planetState = migratePlanetState(p.planetUsageState, DEFAULT_PLANETS);
        const bd = breakdowns.get(p.id);
        return {
          id: p.id,
          nickname: p.nickname,
          isHost: p.isHost,
          joinedAt: p.joinedAt,
          totalScore: p.totalScore ?? 0,
          priorityPlanet: planetState.currentPriority,
          scoreBreakdown: bd ?? { baseline: 0, plausibility: 0, connection: 0, planetBonus: 0 },
        };
      });

    const gameState = {
      id: session.id,
      joinCode: session.join_code,
      status: session.status,
      hostPlayerId: session.host_player_id,
      phase: session.phase,
      currentRound: session.current_round,
      playMinutes: session.play_minutes,
      breakMinutes: session.break_minutes,
      maxRounds: session.max_rounds,
      phaseStartedAt: session.phase_started_at
        ? new Date(session.phase_started_at).toISOString()
        : null,
      phaseEndsAt: session.phase_ends_at
        ? new Date(session.phase_ends_at).toISOString()
        : null,
      serverNow: serverNow.toISOString(),
      inGameNow: inGameNow ? inGameNow.toISOString() : null,
      timelineSpeedRatio: session.timeline_speed_ratio,
      players: processedPlayers,
    };

    // broadcast to all players in the session room
    const roomName = `session:${this.state.joinCode}`;
    this.io.to(roomName).emit('game:state', gameState);

    console.log(
      `[GameLoop ${this.state.joinCode}] Broadcasted game:state to room ${roomName}`
    );
  }

  /**
   * generate and broadcast round summary asynchronously.
   * called after transitioning to break phase.
   */
  private async generateAndBroadcastSummary(toRound: number, fromRound: number = toRound): Promise<void> {
    const roomName = `session:${this.state.joinCode}`;

    // emit "generating" status immediately (use toRound as the storage key)
    this.io.to(roomName).emit('round:summary', {
      roundNo: toRound,
      status: 'generating',
    });

    console.log(
      `[GameLoop ${this.state.joinCode}] Generating summary for rounds ${fromRound}-${toRound}...`
    );

    try {
      const result = await generateRoundSummary({
        sessionId: this.state.sessionId,
        fromRound,
        toRound,
        maxRounds: this.state.maxRounds,
      });

      this.io.to(roomName).emit('round:summary', {
        roundNo: toRound,
        status: 'completed',
        summary: result.summary,
      });

      console.log(
        `[GameLoop ${this.state.joinCode}] Summary generated for rounds ${fromRound}-${toRound} (${result.usage?.inputTokens ?? 0} in, ${result.usage?.outputTokens ?? 0} out tokens)`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.io.to(roomName).emit('round:summary', {
        roundNo: toRound,
        status: 'error',
        error: errorMessage,
      });

      console.error(
        `[GameLoop ${this.state.joinCode}] Summary generation failed for rounds ${fromRound}-${toRound}:`,
        error
      );
    }
  }

  /**
   * generate the final game-end narrative summary asynchronously.
   * broadcast as a `game:final_summary` event so the frontend can render
   * the experience reports on the GameEnd page.
   */
  private async generateAndBroadcastFinalNarrative(): Promise<void> {
    const roomName = `session:${this.state.joinCode}`;
    const roundNo = this.state.maxRounds;

    // emit "generating" status immediately
    this.io.to(roomName).emit('game:final_summary', {
      roundNo,
      status: 'generating',
    });

    console.log(
      `[GameLoop ${this.state.joinCode}] Generating final narrative summary...`
    );

    try {
      const result = await generateFinalNarrativeSummary({
        sessionId: this.state.sessionId,
        maxRounds: this.state.maxRounds,
      });

      this.io.to(roomName).emit('game:final_summary', {
        roundNo,
        status: 'completed',
        summary: result.summary,
      });

      console.log(
        `[GameLoop ${this.state.joinCode}] Final narrative summary generated (${result.usage?.inputTokens ?? 0} in, ${result.usage?.outputTokens ?? 0} out tokens)`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.io.to(roomName).emit('game:final_summary', {
        roundNo,
        status: 'error',
        error: errorMessage,
      });

      console.error(
        `[GameLoop ${this.state.joinCode}] Final narrative summary generation failed:`,
        error
      );
    }
  }

  private startSeedDrip(): void {
    const seeds = [...SEED_HEADLINES];
    const intervalMs = Math.floor(TUTORIAL_DURATION_MS / (seeds.length + 1));
    let index = 0;

    console.log(
      `[GameLoop ${this.state.joinCode}] Starting seed drip: ${seeds.length} headlines over ${TUTORIAL_DURATION_MS / 1000}s (every ${Math.round(intervalMs / 1000)}s)`
    );

    this.seedDripHandle = setInterval(async () => {
      if (index >= seeds.length) {
        if (this.seedDripHandle) {
          clearInterval(this.seedDripHandle);
          this.seedDripHandle = null;
        }
        return;
      }

      const seed = seeds[index];
      const inGameSubmittedAt = new Date(seed.inGameYear, seed.inGameMonth - 1, 1).toISOString();

      try {
        const result = await pool.query(
          `INSERT INTO game_session_headlines
            (session_id, player_id, round_no, headline_text, plausibility_level, llm_status, in_game_submitted_at)
           VALUES ($1, $2, 1, $3, 3, 'seed', $4)
           RETURNING id, created_at`,
          [this.state.sessionId, this.archivePlayerId, seed.text, inGameSubmittedAt]
        );

        const row = result.rows[0];
        const roomName = `session:${this.state.joinCode}`;

        this.io.to(roomName).emit('headline:new', {
          id: row.id,
          sessionId: this.state.sessionId,
          playerId: this.archivePlayerId,
          playerNickname: 'Archive',
          roundNo: 1,
          storyDirection: seed.text,
          text: seed.text,
          diceRoll: null,
          selectedBand: null,
          plausibilityBand: 3,
          plausibilityLabel: 'plausible',
          planets: [],
          allBands: null,
          createdAt: new Date(row.created_at).toISOString(),
          inGameSubmittedAt,
        });
      } catch (error) {
        console.error(
          `[GameLoop ${this.state.joinCode}] Failed to insert seed headline ${index}:`,
          error
        );
      }

      index++;
    }, intervalMs);
  }

  stop(): void {
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
    if (this.seedDripHandle) {
      clearInterval(this.seedDripHandle);
      this.seedDripHandle = null;
    }
    console.log(`[GameLoop ${this.state.joinCode}] Stopped`);
  }
}

/**
 * singleton manager for all active game loops
 */
class GameLoopManager {
  private loops: Map<string, GameLoopInstance> = new Map();
  private io: Server | null = null;

  setSocketIO(io: Server): void {
    this.io = io;
  }

  async ensureLoopForSession(
    sessionId: string,
    joinCode: string
  ): Promise<GameLoopInstance> {
    if (this.loops.has(sessionId)) {
      return this.loops.get(sessionId)!;
    }

    if (!this.io) {
      throw new Error('Socket.IO server not initialized in GameLoopManager');
    }

    // load config from database
    const result = await pool.query(
      `SELECT id, join_code, play_minutes, break_minutes, max_rounds, timeline_speed_ratio
       FROM game_sessions
       WHERE id = $1`,
      [sessionId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const row = result.rows[0];
    const config: GameSessionConfig = {
      sessionId: row.id,
      joinCode: row.join_code,
      playMinutes: row.play_minutes,
      breakMinutes: row.break_minutes,
      maxRounds: row.max_rounds,
      timelineSpeedRatio: row.timeline_speed_ratio,
    };

    const loop = new GameLoopInstance(config, this.io);
    await loop.loadFromDatabase();
    this.loops.set(sessionId, loop);

    console.log(`[GameLoopManager] Created loop for session ${joinCode}`);

    return loop;
  }

  async handleHostStartGame(sessionId: string, joinCode: string, archivePlayerId?: string): Promise<void> {
    const loop = await this.ensureLoopForSession(sessionId, joinCode);
    await loop.startGame(archivePlayerId);
  }

  stopLoop(sessionId: string): void {
    const loop = this.loops.get(sessionId);
    if (loop) {
      loop.stop();
      this.loops.delete(sessionId);
    }
  }

  stopAll(): void {
    for (const loop of this.loops.values()) {
      loop.stop();
    }
    this.loops.clear();
    console.log('[GameLoopManager] Stopped all loops');
  }
}

export const gameLoopManager = new GameLoopManager();

