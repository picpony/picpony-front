import AboutContent from './AboutContent';
import { readTeamMembers } from '@/lib/team.server';

/**
 * The server shell for /about.
 *
 * The page itself is unchanged and still a client component — it has a Lottie, an ASCII
 * wordmark and a modal, none of which belong on the server. What moved is one read: the team
 * roster is fetched here, cached across visitors for its own TTL, and handed to the island as a
 * prop, so the HTML arrives with the names in it instead of a skeleton and a round trip.
 *
 * This is the smallest instance of the pattern deliberately. `readTeamMembers` is public and
 * tokenless, so there is nothing to partition the cache on and no way for one visitor's answer
 * to reach another — which makes it the right place to prove the seed mechanism before the same
 * treatment reaches the home feed, where both of those questions have real answers.
 *
 * `await`ed rather than streamed behind a `<Suspense>`, because the read is bounded by its own
 * 2.5s timeout and returns `null` rather than throwing. A boundary here would buy a faster
 * first byte and cost the thing this exists for: content in the first byte.
 */
export default async function AboutPage() {
  const teamSeed = await readTeamMembers();
  return <AboutContent teamSeed={teamSeed} />;
}
