import { useEffect, useRef, useState } from 'react';
import { Headline } from '../hooks/useSocket';
import { Card, SectionTitle } from './ui';

interface HeadlineFeedProps {
  headlines: Headline[];
  currentPlayerId: string;
}

export function HeadlineFeed({ headlines, currentPlayerId }: HeadlineFeedProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  // sticks to the bottom until the user manually scrolls up
  const followBottomRef = useRef(true);
  // true while a programmatic scroll is in flight, so the scroll handler ignores it
  const programmaticScrollRef = useRef(false);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [copied, setCopied] = useState(false);

  // snap to bottom on new headlines, only when the user hasn't scrolled away
  useEffect(() => {
    if (!feedRef.current || !followBottomRef.current) return;
    programmaticScrollRef.current = true;
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
    // release the flag on the next frame, after the scroll event has fired
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  }, [headlines.length]);

  const handleScroll = () => {
    if (!feedRef.current) return;
    if (programmaticScrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const atBottom = distanceFromBottom < 50;
    followBottomRef.current = atBottom;
    setShowJumpButton(!atBottom);
  };

  const jumpToLatest = () => {
    if (!feedRef.current) return;
    programmaticScrollRef.current = true;
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
    followBottomRef.current = true;
    setShowJumpButton(false);
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  };

  const handleCopy = async () => {
    const formatted = headlines
      .map((h) => {
        const date = h.inGameSubmittedAt
          ? new Date(h.inGameSubmittedAt).toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric',
            })
          : '';
        return `[${date}] ${h.playerNickname} — ${h.text}`;
      })
      .join('\n');
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const displayedHeadlines = headlines;

  if (displayedHeadlines.length === 0) {
    return (
      <Card className="flex flex-col h-full min-h-0">
        <SectionTitle>Timeline</SectionTitle>
        <div className="flex-1 flex flex-col items-center justify-center text-gray-300 py-12">
          <svg className="h-10 w-10 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
            />
          </svg>
          <p className="text-sm text-gray-400">No headlines yet</p>
          <p className="text-xs text-gray-300 mt-1">Be the first to submit one!</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Timeline
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            disabled={displayedHeadlines.length === 0}
            className="text-[10px] text-gray-400 hover:text-indigo-500 disabled:opacity-30 disabled:hover:text-gray-400 transition-colors flex items-center gap-1"
            title="Copy timeline (dates, authors, headlines)"
          >
            {copied ? (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy
              </>
            )}
          </button>
          <span className="text-xs text-gray-400">{displayedHeadlines.length}</span>
        </div>
      </div>

      <div
        ref={feedRef}
        onScroll={handleScroll}
        className="space-y-2.5 flex-1 overflow-y-auto pr-1 min-h-0"
      >
        {displayedHeadlines.map((headline) => {
          const isOwn = headline.playerId === currentPlayerId;
          const isArchive = headline.playerNickname === 'Archive';

          const hasScore = headline.totalScore != null;
          const primaryPlanet = headline.planets?.[0];

          const PLANET_BORDER: Record<string, string> = {
            EARTH: 'border-l-green-300',
            MARS: 'border-l-red-300',
            MERCURY: 'border-l-cyan-300',
            VENUS: 'border-l-pink-300',
            JUPITER: 'border-l-orange-300',
            SATURN: 'border-l-yellow-300',
            NEPTUNE: 'border-l-blue-300',
            URANUS: 'border-l-teal-300',
            PLUTO: 'border-l-purple-300',
          };

          const planetBorder = !isArchive && primaryPlanet
            ? `border-l-2 ${PLANET_BORDER[primaryPlanet] ?? ''}`
            : '';

          return (
            <div
              key={headline.id}
              className={`group relative px-3 py-2.5 rounded-lg border ${planetBorder} ${
                isArchive
                  ? 'bg-amber-50/40 border-amber-100'
                  : isOwn
                  ? 'bg-indigo-50/60 border-indigo-100'
                  : 'bg-gray-50/60 border-gray-100'
              }`}
            >
              <div className="flex justify-between items-center mb-1">
                <span className={`text-xs font-medium ${isArchive ? 'text-amber-600' : isOwn ? 'text-indigo-600' : 'text-gray-500'}`}>
                  {headline.playerNickname}
                  {isArchive && <span className="ml-1 text-amber-400">(history)</span>}
                  {!isArchive && isOwn && <span className="ml-1 text-gray-400">(you)</span>}
                </span>
                <span className="text-[11px] font-semibold text-gray-600">
                  R{headline.roundNo} &middot; {headline.inGameSubmittedAt
                    ? new Date(headline.inGameSubmittedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                    : ''}
                </span>
              </div>
              <p className="text-sm text-gray-800 leading-relaxed">
                &ldquo;{headline.text}&rdquo;
              </p>
              {hasScore && (
                <div className="absolute right-2 bottom-2 hidden group-hover:flex items-center gap-2 px-2 py-1 rounded-md bg-white/95 shadow-sm border border-gray-200 text-[10px] z-10 pointer-events-none">
                  <span className="text-gray-400">+{headline.baselineScore}</span>
                  <span className="text-indigo-500">+{headline.plausibilityScore} plaus</span>
                  <span className="text-emerald-500">+{headline.connectionScore} conn</span>
                  <span className="text-violet-500">+{headline.planetBonusScore} planet</span>
                  <span className="font-semibold text-gray-600 ml-1">= {headline.totalScore}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showJumpButton && (
        <button
          onClick={jumpToLatest}
          className="mt-2 text-center text-xs text-indigo-500 hover:text-indigo-700 py-1 transition-colors"
        >
          Scroll to latest
        </button>
      )}
    </Card>
  );
}
