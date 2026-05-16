/**
 * OpenAPI 3.1 discriminator helpers.
 *
 * Two complementary primitives:
 *
 *  - `discriminator(propertyName, mapping?)` is the bare spec builder. Use it
 *    when you already have a hand-rolled schema and just want to attach the
 *    `discriminator` field cleanly.
 *
 *  - `discriminatedUnion(propertyName, variants, opts?)` is a Standard Schema
 *    wrapper that doubles as a runtime validator and an OpenAPI emitter:
 *    `~standard.validate` dispatches on the discriminator value, and
 *    `.toJSONSchema()` returns `{ oneOf, discriminator }` so DaloyJS' OpenAPI
 *    generator picks it up automatically.
 *
 * Spec reference: https://spec.openapis.org/oas/v3.1.0#discriminator-object
 */

import type { StandardSchemaV1 } from "./schema.js";

export interface DiscriminatorObject {
  propertyName: string;
  mapping?: Record<string, string>;
}

/**
 * Build an OpenAPI 3.1 Discriminator Object. Throws on an empty
 * `propertyName` so misconfigurations fail at boot rather than producing a
 * silently invalid spec.
 */
export function discriminator(
  propertyName: string,
  mapping?: Record<string, string>
): DiscriminatorObject {
  if (typeof propertyName !== "string" || propertyName.length === 0) {
    throw new TypeError("discriminator(): propertyName must be a non-empty string");
  }
  return mapping ? { propertyName, mapping } : { propertyName };
}

export interface DiscriminatedUnionOptions {
  /**
   * Optional explicit OpenAPI mapping from discriminator value to schema $ref.
   * Defaults to `undefined` (clients infer by matching the literal).
   */
  mapping?: Record<string, string>;
  /**
   * Optional vendor string surfaced via Standard Schema. Defaults to
   * `"daloy/discriminated-union"`.
   */
  vendor?: string;
}

type VariantOutputs<V extends Record<string, StandardSchemaV1>> = {
  [K in keyof V]: StandardSchemaV1.InferOutput<V[K]>;
}[keyof V];

type VariantInputs<V extends Record<string, StandardSchemaV1>> = {
  [K in keyof V]: StandardSchemaV1.InferInput<V[K]>;
}[keyof V];

export type DiscriminatedUnion<
  V extends Record<string, StandardSchemaV1>
> = StandardSchemaV1<VariantInputs<V>, VariantOutputs<V>> & {
  toJSONSchema(): {
    oneOf: unknown[];
    discriminator: DiscriminatorObject;
  };
};

/**
 * Build a discriminated-union schema. The runtime validator looks up
 * `value[propertyName]` and delegates to the matching variant; the OpenAPI
 * projection emits `{ oneOf: [...], discriminator: { propertyName, mapping } }`.
 *
 * @example
 * const Cat = z.object({ kind: z.literal("cat"), meow: z.boolean() });
 * const Dog = z.object({ kind: z.literal("dog"), bark: z.boolean() });
 * const Animal = discriminatedUnion("kind", { cat: Cat, dog: Dog });
 */
export function discriminatedUnion<
  P extends string,
  V extends Record<string, StandardSchemaV1>
>(
  propertyName: P,
  variants: V,
  opts?: DiscriminatedUnionOptions
): DiscriminatedUnion<V> {
  if (typeof propertyName !== "string" || propertyName.length === 0) {
    throw new TypeError(
      "discriminatedUnion(): propertyName must be a non-empty string"
    );
  }
  const variantEntries = Object.entries(variants);
  if (variantEntries.length === 0) {
    throw new TypeError(
      "discriminatedUnion(): at least one variant is required"
    );
  }

  const vendor = opts?.vendor ?? "daloy/discriminated-union";
  const mapping = opts?.mapping;

  const validator: StandardSchemaV1.Props<
    VariantInputs<V>,
    VariantOutputs<V>
  > = {
    version: 1,
    vendor,
    validate: async (
      value: unknown
    ): Promise<StandardSchemaV1.Result<VariantOutputs<V>>> => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return {
          issues: [
            {
              message: `Expected object with discriminator property "${propertyName}"`,
              path: [],
            },
          ],
        };
      }
      const discriminatorValue = (value as Record<string, unknown>)[propertyName];
      if (typeof discriminatorValue !== "string") {
        return {
          issues: [
            {
              message: `Discriminator property "${propertyName}" must be a string`,
              path: [{ key: propertyName }],
            },
          ],
        };
      }
      const variant = variants[discriminatorValue];
      if (!variant) {
        return {
          issues: [
            {
              message: `Unknown discriminator value "${discriminatorValue}" for "${propertyName}"`,
              path: [{ key: propertyName }],
            },
          ],
        };
      }
      const result = variant["~standard"].validate(value);
      const settled = result instanceof Promise ? await result : result;
      return settled as StandardSchemaV1.Result<VariantOutputs<V>>;
    },
  };

  const schema: DiscriminatedUnion<V> = {
    "~standard": validator,
    toJSONSchema() {
      const oneOf = variantEntries.map(([, v]) => variantToJsonSchema(v));
      return {
        oneOf,
        discriminator: discriminator(propertyName, mapping),
      };
    },
  };

  return schema;
}

function variantToJsonSchema(schema: StandardSchemaV1): unknown {
  const anySchema = schema as { toJSONSchema?: () => unknown };
  if (typeof anySchema.toJSONSchema === "function") {
    try {
      return anySchema.toJSONSchema();
    } catch {
      /* fall through */
    }
  }
  return {};
}
