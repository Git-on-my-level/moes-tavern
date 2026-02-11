import fs from 'node:fs/promises';

export type ChainEventBase = {
  blockNumber: number;
  logIndex: number;
  timestamp: number;
};

export type ListingCreatedEvent = ChainEventBase & {
  type: 'ListingCreated';
  listingId: number;
  agentId: number;
  listingURI: string;
  pricing: {
    paymentToken: string;
    basePrice: number;
    unitType: string;
    unitPrice: number;
    minUnits: number;
    maxUnits: number;
    quoteRequired: boolean;
  };
  policy: {
    challengeWindowSec: number;
    postDisputeWindowSec: number;
    sellerBondBps: number;
  };
  active: boolean;
};

export type ListingUpdatedEvent = ChainEventBase & {
  type: 'ListingUpdated';
  listingId: number;
  agentId: number;
  listingURI: string;
  active: boolean;
};

export type TaskPostedEvent = ChainEventBase & {
  type: 'TaskPosted';
  taskId: number;
  listingId: number;
  agentId: number;
  buyer: string;
  taskURI: string;
  proposedUnits: number;
};

export type QuoteProposedEvent = ChainEventBase & {
  type: 'QuoteProposed';
  taskId: number;
  quotedUnits: number;
  quotedTotalPrice: number;
  expiry: number;
};

export type QuoteAcceptedEvent = ChainEventBase & {
  type: 'QuoteAccepted';
  taskId: number;
};

export type TaskFundedEvent = ChainEventBase & {
  type: 'TaskFunded';
  taskId: number;
  amount: number;
};

export type TaskAcceptedEvent = ChainEventBase & {
  type: 'TaskAccepted';
  taskId: number;
};

export type DeliverableSubmittedEvent = ChainEventBase & {
  type: 'DeliverableSubmitted';
  taskId: number;
  artifactURI: string;
  artifactHash: string;
};

export type SubmissionAcceptedEvent = ChainEventBase & {
  type: 'SubmissionAccepted';
  taskId: number;
};

export type SubmissionDisputedEvent = ChainEventBase & {
  type: 'SubmissionDisputed';
  taskId: number;
  disputeURI: string;
};

export type SellerBondFundedEvent = ChainEventBase & {
  type: 'SellerBondFunded';
  taskId: number;
  amount: number;
};

export type TaskSettledEvent = ChainEventBase & {
  type: 'TaskSettled';
  taskId: number;
  buyerPayout: number;
  sellerBondRefund: number;
};

export type TaskCancelledEvent = ChainEventBase & {
  type: 'TaskCancelled';
  taskId: number;
};

export type DisputeOpenedEvent = ChainEventBase & {
  type: 'DisputeOpened';
  taskId: number;
  buyer: string;
  disputeURI: string;
};

export type DisputeResolvedEvent = ChainEventBase & {
  type: 'DisputeResolved';
  taskId: number;
  resolver: string;
  outcome: 'SELLER_WINS' | 'BUYER_WINS' | 'SPLIT' | 'CANCEL';
  resolutionURI: string;
};

export type ListingEvent = ListingCreatedEvent | ListingUpdatedEvent;
export type TaskEvent =
  | TaskPostedEvent
  | QuoteProposedEvent
  | QuoteAcceptedEvent
  | TaskFundedEvent
  | TaskAcceptedEvent
  | DeliverableSubmittedEvent
  | SubmissionAcceptedEvent
  | SubmissionDisputedEvent
  | SellerBondFundedEvent
  | TaskSettledEvent
  | TaskCancelledEvent;
export type DisputeEvent = DisputeOpenedEvent | DisputeResolvedEvent;
export type IndexerEvent = ListingEvent | TaskEvent | DisputeEvent;

export type ListingRecord = {
  listingId: number;
  agentId: number;
  listingURI: string;
  pricing: ListingCreatedEvent['pricing'] | null;
  policy: ListingCreatedEvent['policy'] | null;
  active: boolean;
  createdAt: number | null;
  updatedAt: number | null;
  curation: ListingCuration | null;
};

export type ListingCuration = {
  updatedAt: number;
  badges: {
    metadata_validated: boolean;
    endpoint_verified: boolean;
    probe_passed: boolean;
  };
  riskScore: number;
  probeScore: number;
  probeEvidenceURI: string | null;
  lint: {
    valid: boolean;
    errors: string[];
    warnings: string[];
    spamSignals: string[];
  };
  endpointHealth: {
    total: number;
    okCount: number;
    failedCount: number;
    checkedAt: number;
  };
};

export type TaskRecord = {
  taskId: number;
  listingId: number | null;
  agentId: number | null;
  buyer: string | null;
  taskURI: string | null;
  proposedUnits: number | null;
  quotedUnits: number | null;
  quotedTotalPrice: number | null;
  quoteExpiry: number | null;
  fundedAmount: number | null;
  sellerBond: number | null;
  artifactURI: string | null;
  artifactHash: string | null;
  status:
    | 'OPEN'
    | 'QUOTED'
    | 'ACTIVE'
    | 'SUBMITTED'
    | 'DISPUTED'
    | 'SETTLED'
    | 'CANCELLED';
  postedAt: number | null;
  acceptedAt: number | null;
  submittedAt: number | null;
  submissionAcceptedAt: number | null;
  disputedAt: number | null;
  settledAt: number | null;
  cancelledAt: number | null;
};

export type DisputeRecord = {
  taskId: number;
  buyer: string | null;
  disputeURI: string | null;
  openedAt: number | null;
  resolvedAt: number | null;
  outcome: DisputeResolvedEvent['outcome'] | null;
  resolutionURI: string | null;
};

export type AgentMetrics = {
  agentId: number;
  postedCount: number;
  acceptedCount: number;
  submittedCount: number;
  disputeCount: number;
  settledCount: number;
  autoReleaseCount: number;
  cancelCount: number;
  acceptRate: number;
  disputeRate: number;
  cancelRate: number;
  silentAutoReleaseFrequency: number;
  avgTimeToSubmitSec: number;
};

export type ListingQuery = {
  agentId?: number;
  active?: boolean;
  listingIds?: number[];
};

type PersistedState = {
  listings: ListingRecord[];
  tasks: TaskRecord[];
  disputes: DisputeRecord[];
};

export class Indexer {
  private listings = new Map<number, ListingRecord>();
  private tasks = new Map<number, TaskRecord>();
  private disputes = new Map<number, DisputeRecord>();
  private persistPath?: string;

  constructor(options: { persistPath?: string } = {}) {
    this.persistPath = options.persistPath;
  }

  async load() {
    if (!this.persistPath) return;
    const data = await fs.readFile(this.persistPath, 'utf8');
    const parsed = JSON.parse(data) as PersistedState;
    this.listings = new Map(
      parsed.listings.map((listing) => [listing.listingId, listing]),
    );
    this.tasks = new Map(parsed.tasks.map((task) => [task.taskId, task]));
    this.disputes = new Map(
      parsed.disputes.map((dispute) => [dispute.taskId, dispute]),
    );
  }

  async persist() {
    if (!this.persistPath) return;
    const payload: PersistedState = {
      listings: Array.from(this.listings.values()),
      tasks: Array.from(this.tasks.values()),
      disputes: Array.from(this.disputes.values()),
    };
    await fs.writeFile(this.persistPath, JSON.stringify(payload, null, 2));
  }

  ingest(events: IndexerEvent[]) {
    const ordered = [...events].sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      return a.logIndex - b.logIndex;
    });

    for (const event of ordered) {
      if (event.type === 'ListingCreated' || event.type === 'ListingUpdated') {
        this.applyListingEvent(event);
      } else if (
        event.type === 'DisputeOpened' ||
        event.type === 'DisputeResolved'
      ) {
        this.applyDisputeEvent(event);
      } else {
        this.applyTaskEvent(event);
      }
    }
  }

  getAgentMetrics(agentId: number): AgentMetrics {
    const tasks = Array.from(this.tasks.values()).filter(
      (task) => task.agentId === agentId,
    );
    const postedCount = tasks.filter((task) => task.postedAt !== null).length;
    const acceptedCount = tasks.filter(
      (task) => task.acceptedAt !== null,
    ).length;
    const submittedCount = tasks.filter(
      (task) => task.submittedAt !== null,
    ).length;
    const disputeCount = tasks.filter(
      (task) => task.disputedAt !== null,
    ).length;
    const settledCount = tasks.filter((task) => task.settledAt !== null).length;
    const cancelCount = tasks.filter(
      (task) => task.cancelledAt !== null,
    ).length;
    const autoReleaseCount = tasks.filter(
      (task) =>
        task.settledAt !== null &&
        task.submissionAcceptedAt === null &&
        task.disputedAt === null,
    ).length;

    const timeToSubmitValues = tasks
      .filter((task) => task.acceptedAt !== null && task.submittedAt !== null)
      .map((task) => (task.submittedAt ?? 0) - (task.acceptedAt ?? 0));
    const avgTimeToSubmitSec =
      timeToSubmitValues.length === 0
        ? 0
        : timeToSubmitValues.reduce((sum, value) => sum + value, 0) /
          timeToSubmitValues.length;

    return {
      agentId,
      postedCount,
      acceptedCount,
      submittedCount,
      disputeCount,
      settledCount,
      autoReleaseCount,
      cancelCount,
      acceptRate: postedCount === 0 ? 0 : acceptedCount / postedCount,
      disputeRate: submittedCount === 0 ? 0 : disputeCount / submittedCount,
      cancelRate: postedCount === 0 ? 0 : cancelCount / postedCount,
      silentAutoReleaseFrequency:
        settledCount === 0 ? 0 : autoReleaseCount / settledCount,
      avgTimeToSubmitSec,
    };
  }

  getListings(query: ListingQuery = {}): ListingRecord[] {
    let listings = Array.from(this.listings.values());
    if (query.agentId !== undefined) {
      listings = listings.filter(
        (listing) => listing.agentId === query.agentId,
      );
    }
    if (query.active !== undefined) {
      listings = listings.filter((listing) => listing.active === query.active);
    }
    if (query.listingIds) {
      const lookup = new Set(query.listingIds);
      listings = listings.filter((listing) => lookup.has(listing.listingId));
    }
    return listings.sort((a, b) => a.listingId - b.listingId);
  }

  getTasksByAgent(agentId: number): TaskRecord[] {
    return Array.from(this.tasks.values())
      .filter((task) => task.agentId === agentId)
      .sort((a, b) => a.taskId - b.taskId);
  }

  private applyListingEvent(event: ListingEvent) {
    if (event.type === 'ListingCreated') {
      this.listings.set(event.listingId, {
        listingId: event.listingId,
        agentId: event.agentId,
        listingURI: event.listingURI,
        pricing: event.pricing,
        policy: event.policy,
        active: event.active,
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        curation: null,
      });
      return;
    }

    const existing = this.listings.get(event.listingId);
    this.listings.set(event.listingId, {
      listingId: event.listingId,
      agentId: event.agentId,
      listingURI: event.listingURI,
      pricing: existing?.pricing ?? null,
      policy: existing?.policy ?? null,
      active: event.active,
      createdAt: existing?.createdAt ?? null,
      updatedAt: event.timestamp,
      curation: existing?.curation ?? null,
    });
  }

  setListingCuration(listingId: number, curation: ListingCuration) {
    const listing = this.listings.get(listingId);
    if (!listing) {
      throw new Error(`Listing ${listingId} not found`);
    }
    this.listings.set(listingId, {
      ...listing,
      curation,
    });
  }

  private applyTaskEvent(event: TaskEvent) {
    const task = this.ensureTask(event.taskId);

    switch (event.type) {
      case 'TaskPosted':
        task.listingId = event.listingId;
        task.agentId = event.agentId;
        task.buyer = event.buyer;
        task.taskURI = event.taskURI;
        task.proposedUnits = event.proposedUnits;
        task.status = 'OPEN';
        task.postedAt = event.timestamp;
        break;
      case 'QuoteProposed':
        task.quotedUnits = event.quotedUnits;
        task.quotedTotalPrice = event.quotedTotalPrice;
        task.quoteExpiry = event.expiry;
        task.status = 'QUOTED';
        break;
      case 'QuoteAccepted':
        task.status = 'ACTIVE';
        task.acceptedAt = event.timestamp;
        break;
      case 'TaskFunded':
        task.fundedAmount = event.amount;
        break;
      case 'TaskAccepted':
        task.status = 'QUOTED';
        task.quotedUnits = task.proposedUnits;
        const listing = this.listings.get(task.listingId ?? 0);
        if (listing?.pricing) {
          task.quotedTotalPrice =
            listing.pricing.basePrice +
            (task.proposedUnits ?? 0) * listing.pricing.unitPrice;
        }
        break;
      case 'DeliverableSubmitted':
        task.artifactURI = event.artifactURI;
        task.artifactHash = event.artifactHash;
        task.status = 'SUBMITTED';
        task.submittedAt = event.timestamp;
        break;
      case 'SubmissionAccepted':
        task.submissionAcceptedAt = event.timestamp;
        break;
      case 'SubmissionDisputed':
        task.disputedAt = event.timestamp;
        task.status = 'DISPUTED';
        break;
      case 'SellerBondFunded':
        task.sellerBond = event.amount;
        break;
      case 'TaskSettled':
        task.status = 'SETTLED';
        task.settledAt = event.timestamp;
        break;
      case 'TaskCancelled':
        task.status = 'CANCELLED';
        task.cancelledAt = event.timestamp;
        break;
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }

    this.tasks.set(task.taskId, task);
  }

  private applyDisputeEvent(event: DisputeEvent) {
    const task = this.ensureTask(event.taskId);
    const existing = this.disputes.get(event.taskId) ?? {
      taskId: event.taskId,
      buyer: null,
      disputeURI: null,
      openedAt: null,
      resolvedAt: null,
      outcome: null,
      resolutionURI: null,
    };

    if (event.type === 'DisputeOpened') {
      existing.buyer = event.buyer;
      existing.disputeURI = event.disputeURI;
      existing.openedAt = event.timestamp;
      task.disputedAt = event.timestamp;
      task.status = 'DISPUTED';
    } else {
      existing.resolvedAt = event.timestamp;
      existing.outcome = event.outcome;
      existing.resolutionURI = event.resolutionURI;
    }

    this.disputes.set(event.taskId, existing);
    this.tasks.set(task.taskId, task);
  }

  private ensureTask(taskId: number): TaskRecord {
    const existing = this.tasks.get(taskId);
    if (existing) return existing;
    const task: TaskRecord = {
      taskId,
      listingId: null,
      agentId: null,
      buyer: null,
      taskURI: null,
      proposedUnits: null,
      quotedUnits: null,
      quotedTotalPrice: null,
      quoteExpiry: null,
      fundedAmount: null,
      sellerBond: null,
      artifactURI: null,
      artifactHash: null,
      status: 'OPEN',
      postedAt: null,
      acceptedAt: null,
      submittedAt: null,
      submissionAcceptedAt: null,
      disputedAt: null,
      settledAt: null,
      cancelledAt: null,
    };
    this.tasks.set(taskId, task);
    return task;
  }
}
