import ClaimBadgeContent from './ClaimBadgeContent';

export const metadata = { title: '领取徽章' };

export default async function ClaimBadgePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  return <ClaimBadgeContent claimToken={typeof token === 'string' ? token.trim() : ''} />;
}
