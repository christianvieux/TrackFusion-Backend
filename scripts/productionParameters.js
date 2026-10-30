import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export const PRODUCTION_PARAMETER_NAMESPACE = "/trackfusionweb/production/api/";
export const PRODUCTION_SECRET_KEYS = Object.freeze([
  "SESSION_SECRET",
  "JWT_SECRET",
  "DATABASE_URL",
  "RESEND_API_KEY",
]);
export const PRODUCTION_PARAMETER_NAMES = Object.freeze(
  PRODUCTION_SECRET_KEYS.map((key) => `${PRODUCTION_PARAMETER_NAMESPACE}${key}`),
);

const PARAMETER_TO_KEY = new Map(
  PRODUCTION_SECRET_KEYS.map((key) => [
    `${PRODUCTION_PARAMETER_NAMESPACE}${key}`,
    key,
  ]),
);
const GENERATED_SECRET_COMMENT =
  "# Generated from the approved production Parameter Store allowlist.";

function parseEnvironment(content) {
  if (typeof content !== "string") {
    throw new Error("The candidate environment must be text");
  }

  const lines = content.split("\n");
  const settings = new Map();
  for (const [index, line] of lines.entries()) {
    if (line === "" || /^\s*#/.test(line)) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) {
      throw new Error(`Invalid environment entry at line ${index + 1}`);
    }
    const [, key, rawValue] = match;
    if (settings.has(key)) {
      throw new Error(`Duplicate environment setting: ${key}`);
    }
    settings.set(key, { index, rawValue });
  }
  return { lines, settings };
}

function decodeSimpleEnvironmentValue(rawValue, key) {
  const value = rawValue.trim();
  if (
    value.length >= 2 &&
    ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"')))
  ) {
    return value.slice(1, -1);
  }
  if (/\s|["']/.test(value)) {
    throw new Error(`${key} must use a simple environment-file value`);
  }
  return value;
}

export function readProductionAwsRegion(environmentContent) {
  const { settings } = parseEnvironment(environmentContent);
  if (settings.has("AWS_SECRETS_ARN")) {
    throw new Error(
      "AWS_SECRETS_ARN must be removed before Parameter Store activation",
    );
  }
  const entry = settings.get("AWS_REGION");
  if (!entry) throw new Error("AWS_REGION is missing from the candidate environment");
  const region = decodeSimpleEnvironmentValue(entry.rawValue, "AWS_REGION");
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) {
    throw new Error("AWS_REGION is invalid in the candidate environment");
  }
  return region;
}

function validateSecretValue(key, value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Parameter Store returned an empty value for ${key}`);
  }
  if (/[\0\r\n']/.test(value)) {
    throw new Error(
      `Parameter Store returned a value for ${key} that cannot be represented safely`,
    );
  }
  if (["SESSION_SECRET", "JWT_SECRET"].includes(key) && value.length < 32) {
    throw new Error(`Parameter Store returned an invalid value for ${key}`);
  }
  if (key === "DATABASE_URL") {
    let databaseUrl;
    try {
      databaseUrl = new URL(value);
    } catch {
      throw new Error("Parameter Store returned an invalid value for DATABASE_URL");
    }
    if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
      throw new Error("Parameter Store returned an invalid value for DATABASE_URL");
    }
  }
}

export function validateProductionParameters(response) {
  if (!response || typeof response !== "object") {
    throw new Error("Parameter Store returned an invalid response");
  }
  if (
    response.InvalidParameters !== undefined &&
    (!Array.isArray(response.InvalidParameters) ||
      response.InvalidParameters.length !== 0)
  ) {
    throw new Error("Parameter Store did not return every approved parameter");
  }
  if (!Array.isArray(response.Parameters)) {
    throw new Error("Parameter Store response is missing Parameters");
  }

  const values = new Map();
  for (const parameter of response.Parameters) {
    const key = PARAMETER_TO_KEY.get(parameter?.Name);
    if (!key) {
      throw new Error("Parameter Store returned an unexpected parameter name");
    }
    if (values.has(key)) {
      throw new Error(`Parameter Store returned a duplicate parameter for ${key}`);
    }
    if (parameter.Type !== "SecureString") {
      throw new Error(`Parameter Store parameter ${key} is not a SecureString`);
    }
    if (parameter.DataType !== undefined && parameter.DataType !== "text") {
      throw new Error(`Parameter Store parameter ${key} has an unexpected data type`);
    }
    validateSecretValue(key, parameter.Value);
    values.set(key, parameter.Value);
  }

  const missing = PRODUCTION_SECRET_KEYS.filter((key) => !values.has(key));
  if (missing.length > 0 || values.size !== PRODUCTION_SECRET_KEYS.length) {
    throw new Error("Parameter Store did not return exactly four approved parameters");
  }
  return values;
}

export function mergeProductionParameters(environmentContent, response) {
  const { lines, settings } = parseEnvironment(environmentContent);
  if (settings.has("AWS_SECRETS_ARN")) {
    throw new Error(
      "AWS_SECRETS_ARN must be removed before Parameter Store activation",
    );
  }

  const values = validateProductionParameters(response);
  const secretKeys = new Set(PRODUCTION_SECRET_KEYS);
  const retainedLines = lines.filter((line) => {
    if (line === GENERATED_SECRET_COMMENT) return false;
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    return !match || !secretKeys.has(match[1]);
  });
  while (retainedLines.at(-1) === "") retainedLines.pop();

  retainedLines.push(
    "",
    GENERATED_SECRET_COMMENT,
    ...PRODUCTION_SECRET_KEYS.map((key) => `${key}='${values.get(key)}'`),
    "",
  );
  return retainedLines.join("\n");
}

export function writePrivateFileAtomically(destination, content) {
  try {
    lstatSync(destination);
    throw new Error("Refusing to overwrite an existing destination environment");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const destinationDirectory = dirname(destination);
  const temporary = join(
    destinationDirectory,
    `.${basename(destination)}.${process.pid}.${randomBytes(8).toString("hex")}`,
  );
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    writeFileSync(descriptor, content, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, 0o600);
    linkSync(temporary, destination);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function parseParameterResponse(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Parameter Store response is not valid JSON");
  }
}

export function runCli(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (command === "region" && args.length === 1) {
    process.stdout.write(`${readProductionAwsRegion(readFileSync(args[0], "utf8"))}\n`);
    return;
  }
  if (command === "merge" && args.length === 3) {
    const content = mergeProductionParameters(
      readFileSync(args[0], "utf8"),
      parseParameterResponse(args[1]),
    );
    writePrivateFileAtomically(args[2], content);
    console.log("Production Parameter Store configuration reconciled");
    return;
  }
  throw new Error(
    "Usage: productionParameters.js region <environment> | merge <environment> <parameters.json> <destination>",
  );
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/productionParameters.js")) {
  try {
    runCli();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
