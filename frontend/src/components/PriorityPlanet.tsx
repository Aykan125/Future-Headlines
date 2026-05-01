import { Card, SectionTitle } from './ui';

interface PriorityPlanetProps {
  planet: string | null;
}

const PLANET_TAGS: Record<string, string[]> = {
  EARTH:   ['Nature', 'Environment', 'Climate', 'Humanity', 'Justice'],
  MARS:    ['War', 'Conflict', 'Military', 'Defense', 'Security'],
  MERCURY: ['Communication', 'Media', 'Journalism', 'Networks', 'Information'],
  VENUS:   ['Art', 'Beauty', 'Culture', 'Entertainment', 'Creativity'],
  JUPITER: ['Power', 'Governance', 'Politics', 'Leadership', 'Institutions'],
  SATURN:  ['Time', 'Aging', 'Legacy', 'Tradition', 'History'],
  NEPTUNE: ['Dreams', 'Spirituality', 'Consciousness', 'Illusion', 'Religion'],
  URANUS:  ['Innovation', 'Revolution', 'Disruption', 'Technology', 'Breakthroughs'],
  PLUTO:   ['Transformation', 'Hidden forces', 'Secrets', 'Rebirth', 'Upheaval'],
};

export function PriorityPlanet({ planet }: PriorityPlanetProps) {
  if (!planet) {
    return null;
  }

  const tags = PLANET_TAGS[planet] ?? [];

  return (
    <Card padding="sm">
      <SectionTitle>Priority Planet</SectionTitle>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-violet-700">{planet}</span>
        <span className="text-xs text-gray-400">+2 bonus</span>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="text-xs px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-600 font-medium"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
