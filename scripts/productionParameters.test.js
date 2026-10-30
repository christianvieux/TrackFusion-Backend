import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mergeProductionParameters,
  PRODUCTION_PARAMETER_NAMESPACE,
  PRODUCTION_SECRET_KEYS,
  readProductionAwsRegion,
  validateProductionParameters,
  writePrivateFileAtomically,
} from "./productionParameters.js";

const fakeValues = {
  SESSION_SECRET: "session-secret-00000000000000000000000000000000",
  JWT_SECRET: "jwt-secret-0000000000000000000000000000000000",
  DATABASE_URL: "postgresql://trackfusion:fake-password@127.0.0.1:5432/trackfusionweb_db",
  RESEND_API_KEY: "re_fake_value_that_must_not_be_logged",
};

function responseFor(overrides = {}) {
  return {
    Parameters: PRODUCTION_SECRET_KEYS.map((key) => ({
      Name: `${PRODUCTION_PARAMETER_NAMESPACE}${key}`,
      Type: "SecureString",
      DataType: "text",
      Value: fakeValues[key],
    })),
    InvalidParameters: [],
    ...overrides,
  };
}

const legacyEnvironment = [
  "NODE_ENV=production",
  "AWS_REGION=us-east-1",
  "INSTANCE_SETTING=preserve-this",
  "SESSION_SECRET=legacy-session-secret-that-must-be-replaced",
  "JWT_SECRET=legacy-jwt-secret-that-must-be-replaced",
  "DATABASE_URL=postgresql://trackfusion:legacy@127.0.0.1:5432/trackfusionweb_db",
  "RESEND_API_KEY=legacy-resend-key",
  "",
].join("\n");

test("reconciles exactly four SecureStrings while preserving nonsecret settings", () => {
  const merged = mergeProductionParameters(legacyEnvironment, responseFor());

  expect(merged).toContain("INSTANCE_SETTING=preserve-this");
  expect(merged).not.toContain("legacy-session-secret");
  for (const key of PRODUCTION_SECRET_KEYS) {
    expect(merged).toContain(`${key}='${fakeValues[key]}'`);
    expect(merged.match(new RegExp(`^${key}=`, "gm"))).toHaveLength(1);
  }
  expect(mergeProductionParameters(merged, responseFor())).toBe(merged);
});

test("rejects missing, duplicated, and unexpected parameter identities", () => {
  const complete = responseFor();
  expect(() => validateProductionParameters({
    ...complete,
    Parameters: complete.Parameters.slice(0, 3),
  })).toThrow("exactly four");

  expect(() => validateProductionParameters({
    ...complete,
    Parameters: [...complete.Parameters.slice(0, 3), complete.Parameters[0]],
  })).toThrow("duplicate parameter");

  expect(() => validateProductionParameters({
    ...complete,
    Parameters: [
      ...complete.Parameters.slice(0, 3),
      {
        Name: "/trackfusionweb/production/api/UNEXPECTED",
        Type: "SecureString",
        Value: "value-that-must-not-be-logged",
      },
    ],
  })).toThrow("unexpected parameter name");

  expect(() => validateProductionParameters({
    ...complete,
    InvalidParameters: [`${PRODUCTION_PARAMETER_NAMESPACE}JWT_SECRET`],
  })).toThrow("every approved parameter");
});

test.each([
  ["empty", { Value: "" }, "empty value"],
  ["not SecureString", { Type: "String" }, "not a SecureString"],
  ["unsafe line break", { Value: "secret\nsecond-line" }, "represented safely"],
  ["unsafe quote", { Value: "secret'quote" }, "represented safely"],
])("rejects %s values without echoing them", (_label, mutation, expected) => {
  const response = responseFor();
  response.Parameters[0] = { ...response.Parameters[0], ...mutation };
  let message = "";
  try {
    validateProductionParameters(response);
  } catch (error) {
    message = error.message;
  }
  expect(message).toContain(expected);
  if (response.Parameters[0].Value !== "") {
    expect(message).not.toContain(response.Parameters[0].Value);
  }
});

test("rejects duplicate environment keys and the legacy Secrets Manager source", () => {
  expect(() => mergeProductionParameters(
    `${legacyEnvironment}AWS_REGION=us-west-2\n`,
    responseFor(),
  )).toThrow("Duplicate environment setting: AWS_REGION");

  const withLegacySource = `${legacyEnvironment}AWS_SECRETS_ARN=arn:aws:secretsmanager:example\n`;
  expect(() => readProductionAwsRegion(withLegacySource)).toThrow(
    "AWS_SECRETS_ARN must be removed",
  );
  expect(() => mergeProductionParameters(withLegacySource, responseFor())).toThrow(
    "AWS_SECRETS_ARN must be removed",
  );
});

test("writes a protected destination atomically and never overwrites it", () => {
  const directory = mkdtempSync(join(tmpdir(), "trackfusion-parameters-"));
  const destination = join(directory, ".env");
  try {
    writePrivateFileAtomically(destination, "FIRST=value\n");
    expect(readFileSync(destination, "utf8")).toBe("FIRST=value\n");
    expect(statSync(destination).mode & 0o777).toBe(0o600);

    expect(() => writePrivateFileAtomically(destination, "SECOND=value\n"))
      .toThrow("Refusing to overwrite");
    expect(readFileSync(destination, "utf8")).toBe("FIRST=value\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not include a returned secret in validation errors", () => {
  const marker = "secret-leak-marker-never-print";
  const response = responseFor({
    Parameters: [{
      Name: "/unexpected/name",
      Type: "SecureString",
      Value: marker,
    }],
  });
  let message = "";
  try {
    validateProductionParameters(response);
  } catch (error) {
    message = error.message;
  }
  expect(message).not.toContain(marker);
});
