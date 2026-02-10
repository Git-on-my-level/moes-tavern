export type ListingSignal = {
  acceptRate: number;
  disputeRate: number;
  priceScore: number;
};

export function scoreListing(signal: ListingSignal) {
  const acceptance = Math.max(0, Math.min(1, signal.acceptRate));
  const disputePenalty = Math.max(0, Math.min(1, signal.disputeRate));
  const price = Math.max(0, Math.min(1, signal.priceScore));
  return acceptance * 0.6 + price * 0.3 + (1 - disputePenalty) * 0.1;
}
