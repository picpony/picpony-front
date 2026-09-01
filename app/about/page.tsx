import AboutContent from './AboutContent';
import { readTeamMembers } from '@/lib/team.server';

/**
 * Server shell for /about. The page itself is unchanged and still a client component; what
 * moved is one read — the team roster, fetched here, cached across visitors for its own TTL,
 * and handed to the island as a prop, so the HTML arrives with the names in it.
 *
 * The smallest instance of the pattern deliberately: `readTeamMembers` is public and
 * tokenless, so there is nothing to partition the cache on — the right place to prove the
 * seed mechanism before the same treatment reaches the home feed.
 *
 * `await`ed rather than streamed behind `<Suspense>`: the read is bounded by its own 2.5s
 * timeout and returns null rather than throwing, and a boundary here would buy a faster
 * first byte at the cost of the thing this exists for — content in the first byte.
 */
export default async function AboutPage() {
  const teamSeed = await readTeamMembers();
  return <AboutContent teamSeed={teamSeed} />;
}
