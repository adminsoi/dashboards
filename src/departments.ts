/**
 * The department registry — the single place that defines what each dashboard
 * shows and where each number comes from.
 *
 * `source` on every tile is load-bearing, not documentation: the renderer uses
 * it to label a tile's provenance, and any tile whose source is not yet
 * integrated renders as "—" behind a PLACEHOLDER banner rather than a number.
 * SOI never shows a fabricated figure as if it were real.
 */

/** Where a tile's value comes from. Drives provenance labelling in the UI. */
export type SourceId =
  /** SAM.gov federal opportunities — LIVE in the backend today. */
  | "samgov"
  /** Pentagon 2000 ERP — scaffolded; backend returns 501 until wired. */
  | "pentagon"
  /** PartsBase marketplace — live once its credentials are fixed. */
  | "partsbase"
  /** This app's own health probes of the SOI service fleet — LIVE. */
  | "services"
  /** HR information system — no integration exists yet. */
  | "hris";

export type TileFormat = "count" | "currency" | "percent" | "days" | "status";

export interface TileDef {
  key: string;
  label: string;
  /** One short line explaining what the number means. */
  hint: string;
  format: TileFormat;
  source: SourceId;
}

export interface Department {
  slug: string;
  name: string;
  tagline: string;
  /** Theme accent: SOI red or SOI blue. Kept to two values on purpose. */
  accent: "red" | "blue";
  /**
   * Whether this department's figures are internal-only and must never be
   * pasted into client-facing material. Rendered as a visible notice.
   */
  internalOnly: boolean;
  tiles: TileDef[];
}

export const DEPARTMENTS: Department[] = [
  {
    slug: "government",
    name: "Government",
    tagline: "Federal solicitations and set-aside coverage.",
    accent: "blue",
    // SAM.gov is public data, so this is the one dashboard that is not
    // internal-only. It still sits behind SSO like everything else.
    internalOnly: false,
    tiles: [
      {
        key: "openSolicitations",
        label: "Open solicitations",
        hint: "Active aircraft-parts notices on SAM.gov.",
        format: "count",
        source: "samgov",
      },
      {
        key: "closingSoon",
        label: "Closing within 7 days",
        hint: "Notices whose response deadline falls inside a week.",
        format: "count",
        source: "samgov",
      },
      {
        key: "postedThisWeek",
        label: "Posted this week",
        hint: "Notices published in the last seven days.",
        format: "count",
        source: "samgov",
      },
      {
        key: "setAsideCount",
        label: "Set-aside notices",
        hint: "Notices carrying a small-business or other set-aside.",
        format: "count",
        source: "samgov",
      },
    ],
  },
  {
    slug: "procurement",
    name: "Procurement",
    tagline: "Quote pipeline and sourcing turnaround.",
    accent: "red",
    internalOnly: true,
    tiles: [
      {
        key: "rfqsAwaitingQuote",
        label: "RFQs awaiting quote",
        hint: "Inbound requests not yet priced.",
        format: "count",
        source: "pentagon",
      },
      {
        key: "quotesSubmitted",
        label: "Quotes submitted (30d)",
        hint: "Quotes issued to buyers in the last 30 days.",
        format: "count",
        source: "pentagon",
      },
      {
        key: "quotesOpen",
        label: "Quotes open",
        hint: "Submitted quotes with no decision yet.",
        format: "count",
        source: "pentagon",
      },
      {
        key: "avgQuoteTurnaroundDays",
        label: "Avg quote turnaround",
        hint: "Mean time from RFQ received to quote sent.",
        format: "days",
        source: "pentagon",
      },
    ],
  },
  {
    slug: "purchasing",
    name: "Purchasing",
    tagline: "Supplier orders, confirmations, and lead-time exposure.",
    accent: "red",
    internalOnly: true,
    tiles: [
      {
        key: "openPurchaseOrders",
        label: "Open purchase orders",
        hint: "POs issued to suppliers and not yet closed.",
        format: "count",
        source: "pentagon",
      },
      {
        key: "awaitingConfirmation",
        label: "Awaiting confirmation",
        hint: "POs with no supplier acknowledgement.",
        format: "count",
        source: "pentagon",
      },
      {
        key: "pastDueLines",
        label: "Past-due lines",
        hint: "Order lines beyond their promised date.",
        format: "count",
        source: "pentagon",
      },
      {
        key: "avgLeadTimeDays",
        label: "Avg supplier lead time",
        hint: "Rolling mean across confirmed orders.",
        format: "days",
        source: "pentagon",
      },
    ],
  },
  {
    slug: "finance",
    name: "Finance",
    tagline: "Receivables, payables, and invoice throughput.",
    accent: "blue",
    internalOnly: true,
    tiles: [
      {
        key: "arOutstanding",
        label: "AR outstanding",
        hint: "Invoiced and unpaid.",
        format: "currency",
        source: "pentagon",
      },
      {
        key: "apDue30",
        label: "AP due in 30 days",
        hint: "Supplier obligations falling due within the month.",
        format: "currency",
        source: "pentagon",
      },
      {
        key: "invoicesPending",
        label: "Invoices pending issue",
        hint: "Shipped work not yet invoiced.",
        format: "count",
        source: "pentagon",
      },
      {
        key: "dso",
        label: "Days sales outstanding",
        hint: "Average collection period.",
        format: "days",
        source: "pentagon",
      },
    ],
  },
  {
    slug: "hr",
    name: "Human Resources",
    tagline: "Headcount, hiring, and training compliance.",
    accent: "red",
    internalOnly: true,
    tiles: [
      {
        key: "headcount",
        label: "Active headcount",
        hint: "Employees on the current roster.",
        format: "count",
        source: "hris",
      },
      {
        key: "openRequisitions",
        label: "Open requisitions",
        hint: "Approved roles actively being recruited.",
        format: "count",
        source: "hris",
      },
      {
        key: "onboardingInProgress",
        label: "Onboarding in progress",
        hint: "Starters inside their first 30 days.",
        format: "count",
        source: "hris",
      },
      {
        key: "trainingOverdue",
        label: "Training overdue",
        hint: "Required training past its due date.",
        format: "count",
        source: "hris",
      },
    ],
  },
  {
    slug: "it",
    name: "Information Technology",
    tagline: "Sign-in, service health, and integration status.",
    accent: "blue",
    internalOnly: true,
    tiles: [
      {
        key: "servicesUp",
        label: "Services healthy",
        hint: "Services answering their health probes.",
        format: "status",
        source: "services",
      },
      {
        key: "backendStatus",
        label: "Data backend",
        hint: "The optional backend supplying dashboard figures.",
        format: "status",
        source: "services",
      },
      {
        key: "integrationsPending",
        label: "Integrations pending",
        hint: "Data sources this app expects but cannot reach yet.",
        format: "count",
        source: "services",
      },
      {
        key: "ssoTenant",
        label: "SSO tenant",
        hint: "Entra tenant enforcing sign-in for this app.",
        format: "status",
        source: "services",
      },
    ],
  },
  {
    slug: "operations",
    name: "Operations",
    tagline: "Fulfilment, inventory depth, and AOG exposure.",
    accent: "red",
    internalOnly: true,
    tiles: [
      {
        key: "shipmentsInTransit",
        label: "Shipments in transit",
        hint: "Consignments dispatched and not yet delivered.",
        format: "count",
        source: "pentagon",
      },
      {
        key: "onTimeDelivery",
        label: "On-time delivery",
        hint: "Share of deliveries inside the promised window.",
        format: "percent",
        source: "pentagon",
      },
      {
        key: "inventoryLines",
        label: "Inventory lines",
        hint: "Distinct stocked part numbers.",
        format: "count",
        source: "pentagon",
      },
      {
        key: "aogOpen",
        label: "AOG items open",
        hint: "Aircraft-on-ground requests awaiting resolution.",
        format: "count",
        source: "pentagon",
      },
    ],
  },
];

export function findDepartment(slug: string): Department | undefined {
  return DEPARTMENTS.find((d) => d.slug === slug);
}

/** Human-readable provenance, shown under every tile. */
export const SOURCE_LABELS: Record<SourceId, string> = {
  samgov: "SAM.gov",
  pentagon: "Pentagon 2000",
  partsbase: "PartsBase",
  services: "Service probes",
  hris: "HR system",
};
