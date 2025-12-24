export function getSecUserAgent(): string {
  // SEC requests a descriptive User-Agent including contact info.
  // https://www.sec.gov/os/accessing-edgar-data
  return (
    process.env.SEC_USER_AGENT?.trim() ||
    "market_knowledge_graph (SEC ingestion; contact: dev@example.com)"
  );
}


