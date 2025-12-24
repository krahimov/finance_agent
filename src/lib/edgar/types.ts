export type EdgarSubmission = {
  cik: string;
  entityType: string;
  name: string;
  tickers?: string[];
  exchanges?: string[];
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      form: string[];
      primaryDocument: string[];
      primaryDocDescription?: string[];
    };
  };
};


