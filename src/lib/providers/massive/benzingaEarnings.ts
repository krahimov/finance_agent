import { massiveGetJson } from "./client";

export type MassiveBenzingaEarningsRow = {
  benzinga_id?: string;
  ticker?: string;
  company_name?: string;
  currency?: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM:SS
  fiscal_period?: string; // Q1/Q2/H1/FY
  fiscal_year?: number;
  estimated_eps?: number | null;
  actual_eps?: number | null;
  eps_surprise?: number | null;
  eps_surprise_percent?: number | null;
  last_updated?: string; // ISO8601
  eps_method?: string; // gaap/adj/ffo
  importance?: number;
  notes?: string;
  [k: string]: unknown;
};

export type MassiveBenzingaEarningsResponse = {
  next_url?: string | null;
  request_id?: string | number;
  results?: MassiveBenzingaEarningsRow[];
  status?: string;
  [k: string]: unknown;
};

export async function fetchBenzingaEarnings(opts: {
  ticker?: string;
  dateGte?: string; // YYYY-MM-DD
  dateLte?: string; // YYYY-MM-DD
  lastUpdatedGte?: string; // ISO8601 or YYYY-MM-DD
  limit?: number; // max 50000
  sort?: string; // e.g. "last_updated.desc"
}): Promise<MassiveBenzingaEarningsResponse> {
  return await massiveGetJson<MassiveBenzingaEarningsResponse>({
    path: "/benzinga/v1/earnings",
    query: {
      ticker: opts.ticker,
      "date.gte": opts.dateGte,
      "date.lte": opts.dateLte,
      "last_updated.gte": opts.lastUpdatedGte,
      limit: opts.limit ?? 5000,
      sort: opts.sort ?? "last_updated.desc",
    },
  });
}


