// dsh-find-file — test/helpers/validate-schema.mjs
//
// Minimal JSON-Schema checker, just enough for this repo's OUTPUT_SCHEMA:
// type, properties, required, additionalProperties:false, items.
// Deliberately dependency-free so `npm test` runs offline everywhere.

const TYPE_CHECKS = {
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  boolean: (v) => typeof v === "boolean",
};

/**
 * @param {unknown} value candidate value
 * @param {object} schema JSON schema subset
 * @param {string} [at] path for error messages
 * @returns {string[]} list of violations (empty = valid)
 */
export function validateSchema(value, schema, at = "$") {
  const errors = [];
  check(value, schema, at, errors);
  return errors;
}

function check(value, schema, at, errors) {
  if (schema.type !== undefined) {
    const ok = (TYPE_CHECKS[schema.type] ?? (() => true))(value);
    if (!ok) {
      errors.push(`${at}: expected ${schema.type}, got ${describe(value)}`);
      return;
    }
  }
  if (schema.type === "object" || (schema.type === undefined && schema.properties !== undefined)) {
    const known = new Set(Object.keys(schema.properties ?? {}));
    for (const key of Object.keys(value)) {
      if (schema.additionalProperties === false && !known.has(key)) {
        errors.push(`${at}.${key}: not allowed by additionalProperties:false`);
      }
    }
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${at}.${key}: required but missing`);
    }
    for (const [key, subschema] of Object.entries(schema.properties ?? {})) {
      if (key in value) check(value[key], subschema, `${at}.${key}`, errors);
    }
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => check(item, schema.items, `${at}[${index}]`, errors));
  }
}

function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
