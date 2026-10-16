/**
 * Minimal zod → JSON Schema converter for provider tool definitions.
 *
 * Providers need plain JSON Schema for their `tools` payloads. This covers the
 * shapes the financial-tools workstream realistically uses (objects, strings,
 * numbers, booleans, enums, arrays, optionals, unions, dates). Anything exotic
 * degrades to `{}` (accept anything) rather than throwing, and the
 * orchestrator still validates arguments with the real zod schema before a
 * handler runs — so a loose schema here can never let bad args through.
 */
import { z } from "zod";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = z.ZodTypeAny & { _def: any };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function defOf(s: AnySchema): any {
  return s._def;
}

function unwrap(s: AnySchema): AnySchema {
  const d = defOf(s);
  // ZodOptional / ZodNullable / ZodDefault / ZodEffects(refine/transform)
  if (
    d.typeName === "ZodOptional" ||
    d.typeName === "ZodNullable" ||
    d.typeName === "ZodDefault" ||
    d.typeName === "ZodEffects"
  ) {
    return unwrap(d.innerType as AnySchema);
  }
  return s;
}

function isOptional(s: AnySchema): boolean {
  const d = defOf(s);
  return (
    d.typeName === "ZodOptional" ||
    d.typeName === "ZodDefault" ||
    (d.typeName === "ZodEffects" && isOptional(d.innerType as AnySchema))
  );
}

/** Convert a zod schema to a JSON Schema object. Never throws. */
export function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  try {
    return convert(schema as AnySchema);
  } catch {
    return {};
  }
}

function convert(s: AnySchema): Record<string, unknown> {
  const d = defOf(s);
  const description = s.description as string | undefined;
  const base: Record<string, unknown> = description ? { description } : {};

  switch (d.typeName as string) {
    case "ZodString": {
      const out: Record<string, unknown> = { ...base, type: "string" };
      for (const check of d.checks ?? []) {
        if (check.kind === "min") out.minLength = check.value;
        if (check.kind === "max") out.maxLength = check.value;
        if (check.kind === "email") out.format = "email";
        if (check.kind === "regex") out.pattern = check.regex?.source;
      }
      return out;
    }
    case "ZodNumber": {
      const out: Record<string, unknown> = { ...base, type: "number" };
      for (const check of d.checks ?? []) {
        if (check.kind === "int") out.type = "integer";
        if (check.kind === "min") out.minimum = check.value;
        if (check.kind === "max") out.maximum = check.value;
      }
      return out;
    }
    case "ZodBoolean":
      return { ...base, type: "boolean" };
    case "ZodDate":
      return { ...base, type: "string", format: "date-time" };
    case "ZodLiteral":
      return { ...base, enum: [d.value] };
    case "ZodEnum":
      return { ...base, type: "string", enum: [...(d.values as unknown[])] };
    case "ZodNativeEnum": {
      const values = Object.values(d.values as Record<string, unknown>).filter(
        (v) => typeof v === "string" || typeof v === "number"
      );
      return { ...base, enum: values };
    }
    case "ZodArray":
      return { ...base, type: "array", items: convert(d.type as AnySchema) };
    case "ZodObject": {
      const shape = d.shape() as Record<string, AnySchema>;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, field] of Object.entries(shape)) {
        properties[key] = convert(unwrap(field));
        if (!isOptional(field)) required.push(key);
      }
      const out: Record<string, unknown> = {
        ...base,
        type: "object",
        properties,
        additionalProperties: false,
      };
      if (required.length > 0) out.required = required;
      return out;
    }
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      return {
        ...base,
        anyOf: (d.options as AnySchema[]).map((o) => convert(o)),
      };
    case "ZodRecord":
      return {
        ...base,
        type: "object",
        additionalProperties: convert(d.valueType as AnySchema),
      };
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodEffects":
      return convert(unwrap(s));
    case "ZodTuple":
      return {
        ...base,
        type: "array",
        items: (d.items as AnySchema[]).map((i) => convert(i)),
      };
    default:
      return { ...base };
  }
}
