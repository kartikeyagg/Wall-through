import localization from "../params/localization.json" with { type: "json" };

export const modelParameters = Object.freeze({ localization });

/** Fail early on missing provenance rather than silently treating a guess as measured. */
export function validateParameterSet(parameters) {
  if (!parameters || typeof parameters !== "object") throw new TypeError("Parameter set must be an object");
  for (const [area, entries] of Object.entries(parameters)) {
    if (!entries || typeof entries !== "object") throw new TypeError(`Invalid parameter area: ${area}`);
    for (const [name, entry] of Object.entries(entries)) {
      if (!entry || !Number.isFinite(entry.value) || typeof entry.source !== "string" || !entry.source.trim())
        throw new TypeError(`Parameter ${area}.${name} needs a finite value and source`);
    }
  }
  return parameters;
}

validateParameterSet(modelParameters);

export function parameterValues(area) {
  const entries = modelParameters[area];
  if (!entries) throw new RangeError(`Unknown parameter area: ${area}`);
  return Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, entry.value]));
}

export function guessedParameters() {
  return Object.entries(modelParameters).flatMap(([area, entries]) =>
    Object.entries(entries).filter(([, entry]) => entry.source.startsWith("guess:")).map(([name]) => `${area}.${name}`));
}
