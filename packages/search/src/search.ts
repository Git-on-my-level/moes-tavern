import MiniSearch from "minisearch";
import type { ListingMetadata } from "@moes/curation";
import type { AgentMetrics, ListingCuration } from "@moes/indexer";

export type ListingPricing = {
  unitType: string;
  unitPrice: number;
  basePrice: number;
  minUnits: number;
  maxUnits: number;
};

export type SearchListing = {
  listingId: number;
  agentId: number;
  metadata: ListingMetadata;
  pricing: ListingPricing;
  metrics: AgentMetrics;
  curation?: ListingCuration | null;
};

export type PriceBucket = {
  id: string;
  min: number;
  max: number;
};

export const PRICE_BUCKETS: PriceBucket[] = [
  { id: "under-50", min: 0, max: 50 },
  { id: "50-100", min: 50, max: 100 },
  { id: "100-250", min: 100, max: 250 },
  { id: "250-500", min: 250, max: 500 },
  { id: "500-plus", min: 500, max: Number.POSITIVE_INFINITY }
];

export type SearchWeights = {
  relevance: number;
  trust: number;
  economics: number;
};

export type SearchOptions = {
  text?: string;
  unitType?: string;
  priceBucket?: string;
  weights?: Partial<SearchWeights>;
};

export type SearchResult = {
  listingId: number;
  listing: SearchListing;
  score: number;
  relevanceScore: number;
  trustScore: number;
  economicsScore: number;
};

export type SearchFacets = {
  unitType: Record<string, number>;
  priceBucket: Record<string, number>;
};

export type SearchResponse = {
  results: SearchResult[];
  facets: SearchFacets;
};

type SearchDoc = {
  listingId: number;
  title: string;
  description: string;
  tags: string;
};

type PriceStats = {
  min: number;
  max: number;
};

export type SearchIndex = {
  mini: MiniSearch<SearchDoc>;
  listings: Map<number, SearchListing>;
  priceStatsByUnitType: Map<string, PriceStats>;
};

const DEFAULT_WEIGHTS: SearchWeights = {
  relevance: 0.5,
  trust: 0.35,
  economics: 0.15
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function buildSearchIndex(listings: SearchListing[]): SearchIndex {
  const mini = new MiniSearch<SearchDoc>({
    idField: "listingId",
    fields: ["title", "description", "tags"],
    storeFields: ["listingId"],
    processTerm: (term) => term.toLowerCase()
  });

  const docs: SearchDoc[] = listings.map((listing) => ({
    listingId: listing.listingId,
    title: listing.metadata.title ?? "",
    description: listing.metadata.description ?? "",
    tags: Array.isArray(listing.metadata.tags) ? listing.metadata.tags.join(" ") : ""
  }));

  mini.addAll(docs);

  const listingMap = new Map<number, SearchListing>();
  const priceStatsByUnitType = new Map<string, PriceStats>();

  for (const listing of listings) {
    listingMap.set(listing.listingId, listing);
    const unitType = listing.pricing.unitType;
    const unitPrice = listing.pricing.unitPrice;
    const existing = priceStatsByUnitType.get(unitType);
    if (!existing) {
      priceStatsByUnitType.set(unitType, { min: unitPrice, max: unitPrice });
    } else {
      existing.min = Math.min(existing.min, unitPrice);
      existing.max = Math.max(existing.max, unitPrice);
    }
  }

  return { mini, listings: listingMap, priceStatsByUnitType };
}

export function searchListings(index: SearchIndex, options: SearchOptions = {}): SearchResponse {
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const text = options.text?.trim() ?? "";

  let candidates: { listingId: number; relevanceScore: number }[] = [];

  if (text.length > 0) {
    const results = index.mini.search(text, {
      prefix: true,
      fuzzy: 0.2,
      combineWith: "OR"
    });
    const maxScore = results.reduce((max, result) => Math.max(max, result.score), 0) || 1;
    candidates = results.map((result) => ({
      listingId: Number(result.id),
      relevanceScore: result.score / maxScore
    }));
  } else {
    candidates = Array.from(index.listings.values()).map((listing) => ({
      listingId: listing.listingId,
      relevanceScore: 0
    }));
  }

  const facetListings = candidates
    .map((entry) => index.listings.get(entry.listingId))
    .filter((listing): listing is SearchListing => Boolean(listing));

  const facets = computeFacets(facetListings);

  const filteredCandidates = candidates.filter((entry) => {
    const listing = index.listings.get(entry.listingId);
    if (!listing) return false;
    if (options.unitType && listing.pricing.unitType !== options.unitType) return false;
    if (options.priceBucket) {
      const bucket = getPriceBucketId(listing.pricing.unitPrice);
      if (bucket !== options.priceBucket) return false;
    }
    return true;
  });

  const results: SearchResult[] = filteredCandidates
    .map((entry) => {
      const listing = index.listings.get(entry.listingId);
      if (!listing) return null;
      const trustScore = computeTrustScore(listing);
      const economicsScore = computePriceScore(listing, index.priceStatsByUnitType);
      const score =
        entry.relevanceScore * weights.relevance +
        trustScore * weights.trust +
        economicsScore * weights.economics;
      return {
        listingId: entry.listingId,
        listing,
        score,
        relevanceScore: entry.relevanceScore,
        trustScore,
        economicsScore
      };
    })
    .filter((result): result is SearchResult => Boolean(result))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.listingId - b.listingId;
    });

  return { results, facets };
}

function computeFacets(listings: SearchListing[]): SearchFacets {
  const unitType: Record<string, number> = {};
  const priceBucket: Record<string, number> = {};

  for (const listing of listings) {
    const unit = listing.pricing.unitType;
    unitType[unit] = (unitType[unit] ?? 0) + 1;

    const bucketId = getPriceBucketId(listing.pricing.unitPrice);
    priceBucket[bucketId] = (priceBucket[bucketId] ?? 0) + 1;
  }

  return { unitType, priceBucket };
}

function getPriceBucketId(unitPrice: number): string {
  for (const bucket of PRICE_BUCKETS) {
    if (unitPrice >= bucket.min && unitPrice < bucket.max) {
      return bucket.id;
    }
  }
  return PRICE_BUCKETS[PRICE_BUCKETS.length - 1]?.id ?? "unknown";
}

function computeTrustScore(listing: SearchListing): number {
  const metrics = listing.metrics;
  const acceptRate = clamp01(metrics.acceptRate);
  const disputeRate = clamp01(metrics.disputeRate);
  const silentRate = clamp01(metrics.silentAutoReleaseFrequency);

  const curation = listing.curation ?? null;
  const probeScore = clamp01(curation?.probeScore ?? 0);
  const badges = curation?.badges ?? {
    metadata_validated: false,
    endpoint_verified: false,
    probe_passed: false
  };

  const badgeCount = [
    badges.metadata_validated,
    badges.endpoint_verified,
    badges.probe_passed
  ].filter(Boolean).length;

  const badgeBonus = badgeCount * 0.05;
  const trust =
    acceptRate * 0.4 +
    (1 - disputeRate) * 0.25 +
    (1 - silentRate) * 0.15 +
    probeScore * 0.2 +
    badgeBonus;

  return clamp01(trust);
}

function computePriceScore(
  listing: SearchListing,
  priceStatsByUnitType: Map<string, PriceStats>
): number {
  const stats = priceStatsByUnitType.get(listing.pricing.unitType);
  if (!stats) return 0.5;
  if (stats.max === stats.min) return 1;
  const normalized = (listing.pricing.unitPrice - stats.min) / (stats.max - stats.min);
  return clamp01(1 - normalized);
}
