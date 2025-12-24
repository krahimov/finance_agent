import { getSecUserAgent } from "./userAgent";
import type { EdgarSubmission } from "./types";

export async function fetchSubmission(cik: string): Promise<EdgarSubmission> {
  const cik10 = cik.replace(/^0+/, "").padStart(10, "0");
  const url = `https://data.sec.gov/submissions/CIK${cik10}.json`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": getSecUserAgent(),
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`SEC submission fetch failed (${res.status}) for CIK ${cik}`);
  }

  return (await res.json()) as EdgarSubmission;
}

export async function fetchFilingDocumentText(opts: {
  cik: string;
  accessionNo: string;
  primaryDocument: string;
}): Promise<string> {
  const url = buildFilingDocumentUrl(opts);

  const res = await fetch(url, {
    headers: {
      "User-Agent": getSecUserAgent(),
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `SEC filing document fetch failed (${res.status}) for ${opts.accessionNo}`,
    );
  }

  return await res.text();
}

export function buildFilingDocumentUrl(opts: {
  cik: string;
  accessionNo: string;
  primaryDocument: string;
}): string {
  const cikNoLeadingZeros = opts.cik.replace(/^0+/, "");
  const accessionNoNoDashes = opts.accessionNo.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNoLeadingZeros}/${accessionNoNoDashes}/${opts.primaryDocument}`;
}


