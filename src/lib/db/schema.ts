import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const entityType = pgEnum("entity_type", [
  "company",
  "instrument",
  "sector",
  "country",
  "event",
  "concept",
  "indicator",
]);

export const documentType = pgEnum("document_type", ["10-k", "10-q", "20-f", "6-k"]);

export const assertionStatus = pgEnum("assertion_status", [
  "active",
  "retracted",
  "superseded",
]);

export const correctionAction = pgEnum("correction_action", [
  "retract",
  "supersede",
  "override",
]);

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: entityType("type").notNull(),
    canonicalName: text("canonical_name").notNull(),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    identifiers: jsonb("identifiers")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxEntitiesType: index("entities_type_idx").on(t.type),
    idxEntitiesCanonicalName: index("entities_canonical_name_idx").on(
      t.canonicalName,
    ),
  }),
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(), // e.g. "sec_edgar"
    docType: documentType("doc_type").notNull(),
    cik: text("cik").notNull(),
    accessionNo: text("accession_no").notNull(),
    filingDate: date("filing_date").notNull(),
    url: text("url").notNull(),
    hash: text("hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqDocumentsSourceAccession: uniqueIndex(
      "documents_source_accession_unique",
    ).on(t.source, t.accessionNo),
    idxDocumentsCikFilingDate: index("documents_cik_filing_date_idx").on(
      t.cik,
      t.filingDate,
    ),
  }),
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    text: text("text").notNull(),
    startChar: integer("start_char"),
    endChar: integer("end_char"),
    qdrantPointId: text("qdrant_point_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqChunksDocumentIndex: uniqueIndex("document_chunks_doc_index_unique").on(
      t.documentId,
      t.chunkIndex,
    ),
    idxChunksDocumentId: index("document_chunks_document_id_idx").on(
      t.documentId,
    ),
  }),
);

export const extractionRuns = pgTable(
  "extraction_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    parameters: jsonb("parameters")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxExtractionRunsStartedAt: index("extraction_runs_started_at_idx").on(
      t.startedAt,
    ),
  }),
);

export const assertions = pgTable(
  "assertions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectEntityId: uuid("subject_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    predicate: text("predicate").notNull(),
    objectEntityId: uuid("object_entity_id").references(() => entities.id, {
      onDelete: "restrict",
    }),
    literalValue: jsonb("literal_value").$type<unknown>(),
    confidence: real("confidence").notNull(),
    sourceDocumentId: uuid("source_document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "restrict" }),
    sourceChunkId: uuid("source_chunk_id").references(() => documentChunks.id, {
      onDelete: "set null",
    }),
    extractionRunId: uuid("extraction_run_id").references(
      () => extractionRuns.id,
      { onDelete: "set null" },
    ),
    validFrom: timestamp("valid_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    status: assertionStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxAssertionsSubjectPredicate: index("assertions_subject_predicate_idx").on(
      t.subjectEntityId,
      t.predicate,
    ),
    idxAssertionsObject: index("assertions_object_idx").on(t.objectEntityId),
    idxAssertionsStatus: index("assertions_status_idx").on(t.status),
    idxAssertionsSourceDocument: index("assertions_source_document_idx").on(
      t.sourceDocumentId,
    ),
    idxAssertionsValidFrom: index("assertions_valid_from_idx").on(t.validFrom),
  }),
);

export const sourceReliability = pgTable("source_reliability", {
  source: text("source").primaryKey(), // e.g. "sec_edgar"
  weight: real("weight").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const corrections = pgTable(
  "corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetAssertionId: uuid("target_assertion_id")
      .notNull()
      .references(() => assertions.id, { onDelete: "cascade" }),
    action: correctionAction("action").notNull(),
    reason: text("reason"),
    createdBy: text("created_by"),
    newAssertionId: uuid("new_assertion_id").references(() => assertions.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxCorrectionsTarget: index("corrections_target_assertion_idx").on(
      t.targetAssertionId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Structured signals (EPS estimates, flows, etc.)
// ---------------------------------------------------------------------------

export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // We store CIK for easy joining with documents/filings even if the company entity isn't created yet.
    cik: text("cik").notNull(),
    subjectEntityId: uuid("subject_entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),

    // Examples:
    // - "eps_ntm_consensus"
    // - "eps_nq_consensus"
    // - "fund_flow_4w_usd"
    signalKey: text("signal_key").notNull(),
    asOfDate: date("as_of_date").notNull(),

    // Value is numeric, but we keep it as real for MVP simplicity.
    // (If you want full precision, switch to numeric later.)
    value: real("value").notNull(),
    unit: text("unit"), // e.g. "USD", "USD_mn", "ratio", "shares"

    // Provenance
    source: text("source").notNull().default("manual"), // e.g. "factset", "lseg", "bloomberg", "manual"
    sourceRef: text("source_ref"), // e.g. dataset batch id, file name, provider request id
    sourceUrl: text("source_url"),
    confidence: real("confidence").notNull().default(0.9),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idxSignalsCikKeyDate: index("signals_cik_key_date_idx").on(
      t.cik,
      t.signalKey,
      t.asOfDate,
    ),
    idxSignalsSubject: index("signals_subject_entity_idx").on(t.subjectEntityId),
    uniqSignalsKey: uniqueIndex("signals_unique").on(
      t.cik,
      t.signalKey,
      t.asOfDate,
      t.source,
    ),
  }),
);


