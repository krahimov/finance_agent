import neo4j, { type Driver } from "neo4j-driver";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }
  return value;
}

export type Neo4jConfig = {
  uri: string;
  username: string;
  password: string;
};

export function getNeo4jConfig(): Neo4jConfig {
  return {
    uri: requireEnv("NEO4J_URI"),
    username: requireEnv("NEO4J_USERNAME"),
    password: requireEnv("NEO4J_PASSWORD"),
  };
}

const globalForNeo4j = globalThis as unknown as {
  __neo4jDriver?: Driver;
};

export function getNeo4jDriver(): Driver {
  if (globalForNeo4j.__neo4jDriver) return globalForNeo4j.__neo4jDriver;

  const { uri, username, password } = getNeo4jConfig();
  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
    disableLosslessIntegers: true,
  });

  if (process.env.NODE_ENV !== "production") {
    globalForNeo4j.__neo4jDriver = driver;
  }

  return driver;
}


