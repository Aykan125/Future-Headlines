/**
 * Tests for the scoring service (DB-aware functions).
 */

import pool from '../../src/db/pool';
import {
  applyHeadlineEvaluation,
  getLeaderboard,
  getHeadlineScoreBreakdown,
  getPlayerPlanetState,
} from '../../src/game/scoringService';
import { HeadlineEvaluationPayload } from '../../src/game/scoringTypes';

// Mock the database pool
jest.mock('../../src/db/pool', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

describe('Scoring Service', () => {
  let mockClient: {
    query: jest.Mock;
    release: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock client for transactions
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    (pool.connect as jest.Mock).mockResolvedValue(mockClient);
  });

  describe('applyHeadlineEvaluation', () => {
    const basePayload: HeadlineEvaluationPayload = {
      sessionId: 'session-123',
      playerId: 'player-456',
      headlineId: 'headline-789',
      plausibilityLevel: 3,
      selectedBand: 3,
      uniqueOtherAuthors: 3,
      aiPlanetRankings: ['MARS', 'VENUS', 'EARTH'],
      roundNo: 1,
    };

    const mockPlayer = {
      id: 'player-456',
      session_id: 'session-123',
      nickname: 'TestPlayer',
      total_score: 50,
      planet_usage_state: null,
    };

    const mockHeadline = {
      id: 'headline-789',
      session_id: 'session-123',
      player_id: 'player-456',
      round_no: 1,
      total_headline_score: null,
    };

    const setupSuccessfulTransaction = () => {
      mockClient.query
        // BEGIN
        .mockResolvedValueOnce({})
        // Load player
        .mockResolvedValueOnce({ rows: [mockPlayer] })
        // Load headline
        .mockResolvedValueOnce({ rows: [mockHeadline] })
        // Update headline
        .mockResolvedValueOnce({})
        // Update player
        .mockResolvedValueOnce({})
        // Get leaderboard
        .mockResolvedValueOnce({
          rows: [
            { id: 'player-456', nickname: 'TestPlayer', total_score: 108 },
            { id: 'player-other', nickname: 'OtherPlayer', total_score: 30 },
          ],
        })
        // COMMIT
        .mockResolvedValueOnce({});
    };

    it('should successfully score a headline and update player total', async () => {
      setupSuccessfulTransaction();

      const result = await applyHeadlineEvaluation(basePayload);

      // Check breakdown
      expect(result.breakdown.baseline).toBe(1); // B
      expect(result.breakdown.plausibility).toBe(2); // A1 (level 3)
      expect(result.breakdown.connectionScore).toBe(9); // 3 unique others = 9 pts
      expect(result.breakdown.selfStory).toBe(0); // Deprecated
      expect(result.breakdown.othersStory).toBe(0); // Deprecated
      // Planet bonus: With null state, initializes fresh tally with random priority
      // Priority planet could be any of the 8 planets, and it may or may not match AI rankings
      // In tally system: 0 or 2 (flat bonus if matches top-3, else 0)
      expect([0, 2]).toContain(result.breakdown.planetBonus);
      // Total: 1 + 2 + 9 + (0 or 2) = 12 or 14
      expect([12, 14]).toContain(result.breakdown.total);

      // Check new total
      expect([50 + 12, 50 + 14]).toContain(result.newTotalScore);

      // Check leaderboard
      expect(result.leaderboard).toHaveLength(2);
      expect(result.leaderboard[0].rank).toBe(1);
      expect(result.leaderboard[0].nickname).toBe('TestPlayer');
    });

    it('should use existing planet tally state from player', async () => {
      // New tally-based format with currentPriority set to VENUS
      const playerWithState = {
        ...mockPlayer,
        planet_usage_state: {
          tally: { MARS: 5, VENUS: 0, EARTH: 3 },
          previousPriority: null,
          currentPriority: 'VENUS', // VENUS is current priority, should match
        },
      };

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [playerWithState] }) // Load player
        .mockResolvedValueOnce({ rows: [mockHeadline] }) // Load headline
        .mockResolvedValueOnce({}) // Update headline
        .mockResolvedValueOnce({}) // Update player
        .mockResolvedValueOnce({ rows: [{ id: 'player-456', nickname: 'Test', total_score: 100 }] })
        .mockResolvedValueOnce({}); // COMMIT

      const result = await applyHeadlineEvaluation(basePayload);

      // VENUS is current priority and is in AI rankings at #2
      // Flat +2 bonus for any match in top-3
      expect(result.breakdown.planetBonus).toBe(2);
      // Total: 1 (baseline) + 2 (plausibility) + 9 (3 unique others) + 2 (planet) = 14
      expect(result.breakdown.total).toBe(14);
    });

    it('should throw PLAYER_NOT_FOUND when player does not exist', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // No player found
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(applyHeadlineEvaluation(basePayload)).rejects.toMatchObject({
        code: 'PLAYER_NOT_FOUND',
      });
    });

    it('should throw HEADLINE_NOT_FOUND when headline does not exist', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [mockPlayer] }) // Load player
        .mockResolvedValueOnce({ rows: [] }) // No headline found
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(applyHeadlineEvaluation(basePayload)).rejects.toMatchObject({
        code: 'HEADLINE_NOT_FOUND',
      });
    });

    it('should throw HEADLINE_SESSION_MISMATCH when headline is from different session', async () => {
      const wrongSessionHeadline = { ...mockHeadline, session_id: 'other-session' };

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [mockPlayer] })
        .mockResolvedValueOnce({ rows: [wrongSessionHeadline] })
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(applyHeadlineEvaluation(basePayload)).rejects.toMatchObject({
        code: 'HEADLINE_SESSION_MISMATCH',
      });
    });

    it('should throw HEADLINE_PLAYER_MISMATCH when headline belongs to different player', async () => {
      const wrongPlayerHeadline = { ...mockHeadline, player_id: 'other-player' };

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [mockPlayer] })
        .mockResolvedValueOnce({ rows: [wrongPlayerHeadline] })
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(applyHeadlineEvaluation(basePayload)).rejects.toMatchObject({
        code: 'HEADLINE_PLAYER_MISMATCH',
      });
    });

    it('should throw HEADLINE_ALREADY_SCORED when headline was already scored', async () => {
      const scoredHeadline = { ...mockHeadline, total_headline_score: 45 };

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [mockPlayer] })
        .mockResolvedValueOnce({ rows: [scoredHeadline] })
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(applyHeadlineEvaluation(basePayload)).rejects.toMatchObject({
        code: 'HEADLINE_ALREADY_SCORED',
      });
    });

    it('should rollback transaction on error', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [mockPlayer] })
        .mockResolvedValueOnce({ rows: [mockHeadline] })
        .mockRejectedValueOnce(new Error('DB error')) // Update headline fails
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(applyHeadlineEvaluation(basePayload)).rejects.toThrow('DB error');

      // Verify ROLLBACK was called
      const calls = mockClient.query.mock.calls;
      const rollbackCall = calls.find(
        (call) => call[0] === 'ROLLBACK'
      );
      expect(rollbackCall).toBeDefined();
    });

    it('should always release client', async () => {
      setupSuccessfulTransaction();

      await applyHeadlineEvaluation(basePayload);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should release client even on error', async () => {
      mockClient.query
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('Error'))
        .mockResolvedValueOnce({});

      await expect(applyHeadlineEvaluation(basePayload)).rejects.toThrow();
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should correctly update headline with all scoring columns', async () => {
      setupSuccessfulTransaction();

      await applyHeadlineEvaluation(basePayload);

      // Find the UPDATE headline query
      const updateHeadlineCall = mockClient.query.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('UPDATE game_session_headlines')
      );

      expect(updateHeadlineCall).toBeDefined();
      const params = updateHeadlineCall![1];

      // Verify all scoring columns are passed
      expect(params).toContain(1); // baseline_score
      expect(params).toContain(3); // plausibility_level (stored value)
      expect(params).toContain(2); // plausibility_score
      expect(params).toContain('3'); // others_story_connection_level (unique other author count as string)
      expect(params).toContain(9); // others_story_score (connection score for 3 unique others)
      expect(params).toContain('MARS'); // planet_1
      expect(params).toContain('VENUS'); // planet_2
      expect(params).toContain('EARTH'); // planet_3
      // Planet bonus is 0 or 2 (flat bonus in tally system)
      expect(params.some((p: unknown) => p === 0 || p === 2)).toBe(true);
      // Total: 1 + 2 + 9 + (0 or 2) = 12 or 14
      expect(params.some((p: unknown) => p === 12 || p === 14)).toBe(true);
    });
  });

  describe('getLeaderboard', () => {
    it('should return players ordered by score with ranks', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [
          { id: 'p1', nickname: 'First', total_score: 100 },
          { id: 'p2', nickname: 'Second', total_score: 75 },
          { id: 'p3', nickname: 'Third', total_score: 50 },
        ],
      });

      const leaderboard = await getLeaderboard('session-123');

      expect(leaderboard).toHaveLength(3);
      expect(leaderboard[0]).toEqual({
        playerId: 'p1',
        nickname: 'First',
        totalScore: 100,
        rank: 1,
      });
      expect(leaderboard[1].rank).toBe(2);
      expect(leaderboard[2].rank).toBe(3);
    });

    it('should return empty array for session with no players', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      const leaderboard = await getLeaderboard('empty-session');
      expect(leaderboard).toEqual([]);
    });
  });

  describe('getHeadlineScoreBreakdown', () => {
    it('should return breakdown for scored headline', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [
          {
            baseline_score: 10,
            plausibility_score: 2,
            self_story_score: 0,
            others_story_score: 3, // Now stores connectionScore
            planet_bonus_score: 5,
            total_headline_score: 20,
          },
        ],
      });

      const breakdown = await getHeadlineScoreBreakdown('headline-123');

      expect(breakdown).toEqual({
        baseline: 10,
        plausibility: 2,
        connectionScore: 3, // others_story_score now holds connectionScore
        selfStory: 0, // Deprecated, always 0
        othersStory: 0, // Deprecated, always 0
        planetBonus: 5,
        total: 20,
      });
    });

    it('should return null for unscored headline', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [
          {
            baseline_score: null,
            plausibility_score: null,
            self_story_score: null,
            others_story_score: null,
            planet_bonus_score: null,
            total_headline_score: null,
          },
        ],
      });

      const breakdown = await getHeadlineScoreBreakdown('headline-123');
      expect(breakdown).toBeNull();
    });

    it('should return null for non-existent headline', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      const breakdown = await getHeadlineScoreBreakdown('nonexistent');
      expect(breakdown).toBeNull();
    });
  });

  describe('getPlayerPlanetState', () => {
    it('should return migrated player planet state from database', async () => {
      // New tally-based format
      const mockState = {
        tally: { MARS: 2, VENUS: 0, EARTH: 1 },
        previousPriority: 'MARS',
        currentPriority: 'VENUS',
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ planet_usage_state: mockState }],
      });

      const state = await getPlayerPlanetState('player-123');
      expect(state.tally['MARS']).toBe(2);
      expect(state.tally['VENUS']).toBe(0);
      expect(state.currentPriority).toBe('VENUS');
    });

    it('should migrate legacy LRU state to tally state', async () => {
      // Legacy LRU format
      const legacyState = {
        MARS: { lastUsedRound: 2 },
        VENUS: { lastUsedRound: null },
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ planet_usage_state: legacyState }],
      });

      const state = await getPlayerPlanetState('player-123');

      // Should be migrated to tally format
      expect(state.tally).toBeDefined();
      expect(state.tally['MARS']).toBe(0); // All start at 0 in migration
      expect(state.previousPriority).toBeNull();
      expect(state.currentPriority).toBeNull();
    });

    it('should return initialized state for player with null state', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ planet_usage_state: null }],
      });

      const state = await getPlayerPlanetState('player-123');

      // Should be initialized with default planets in tally format
      expect(state.tally).toBeDefined();
      expect(Object.keys(state.tally).length).toBeGreaterThan(0);
      expect(state.tally['MARS']).toBe(0);
      expect(state.previousPriority).toBeNull();
      expect(state.currentPriority).toBeNull();
    });

    it('should return initialized state for non-existent player', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      const state = await getPlayerPlanetState('nonexistent');
      expect(state.tally).toBeDefined();
      expect(Object.keys(state.tally).length).toBeGreaterThan(0);
    });
  });
});

