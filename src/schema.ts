/**
 * Standard Schema v1 — minimal subset.
 * https://github.com/standard-schema/standard-schema
 *
 * By coding to this interface, DaloyJS supports Zod, Valibot, ArkType,
 * TypeBox-as-StandardSchema, and any future validator that exposes
 * `~standard`. No vendor lock-in.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The Standard Schema contract object every compatible validator exposes. */
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export namespace StandardSchemaV1 {
  /**
   * The `~standard` contract exposed by a Standard Schema validator: spec
   * version, vendor tag, and the vendor-neutral `validate` entry point.
   */
  export interface Props<Input = unknown, Output = Input> {
    /** Spec version implemented by the validator. Always `1`. */
    readonly version: 1;
    /** Name of the validator library (e.g. `"zod"`, `"valibot"`). */
    readonly vendor: string;
    /** Validates a value; may be sync or async. Returns `{ value }` on success or `{ issues }` on failure. */
    readonly validate: (
      value: unknown
    ) => Result<Output> | Promise<Result<Output>>;
    /** Type-only carrier for {@link InferInput}/{@link InferOutput}; never populated at runtime. */
    readonly types?: Types<Input, Output>;
  }

  /** Outcome of {@link Props.validate}: a {@link SuccessResult} or a {@link FailureResult}. */
  export type Result<Output> = SuccessResult<Output> | FailureResult;

  /** Successful validation: the parsed/coerced output value and no issues. */
  export interface SuccessResult<Output> {
    /** The validated (and possibly transformed) output value. */
    readonly value: Output;
    /** Always `undefined` on success; lets `result.issues` discriminate the union. */
    readonly issues?: undefined;
  }

  /** Failed validation: one or more {@link Issue}s and no output value. */
  export interface FailureResult {
    /** The validation problems found; always non-empty on failure. */
    readonly issues: ReadonlyArray<Issue>;
  }

  /** One validation problem reported by a validator. */
  export interface Issue {
    /** Human-readable description of the problem. */
    readonly message: string;
    /** Location of the problem as a key path from the root; omitted for root-level issues. */
    readonly path?: ReadonlyArray<PropertyKey | PathSegment>;
  }

  /** Object-wrapped path entry used by validators that attach extra metadata to path keys. */
  export interface PathSegment {
    /** The property key this segment addresses. */
    readonly key: PropertyKey;
  }

  /** Type-level input/output carrier referenced by {@link Props.types}; runtime value is never read. */
  export interface Types<Input, Output> {
    /** The type accepted by the validator before parsing/coercion. */
    readonly input: Input;
    /** The type produced by the validator after parsing/coercion. */
    readonly output: Output;
  }

  /** Infers the input (pre-validation) type of a Standard Schema validator. */
  export type InferInput<S extends StandardSchemaV1> =
    NonNullable<S["~standard"]["types"]>["input"];
  /** Infers the output (post-validation) type of a Standard Schema validator. */
  export type InferOutput<S extends StandardSchemaV1> =
    NonNullable<S["~standard"]["types"]>["output"];
}

/**
 * Run a Standard-Schema validator over an arbitrary input. Awaits async
 * validators automatically and returns the spec-defined
 * `{ value }` / `{ issues }` result.
 *
 * DaloyJS calls this internally for every declared request schema; you can
 * also use it directly inside hooks or business logic.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { validate } from "@daloyjs/core";
 *
 * const schema = z.object({ name: z.string() });
 * const result = await validate(schema, { name: "Ada" });
 * if (result.issues) throw new Error(result.issues[0].message);
 * console.log(result.value.name);
 * ```
 *
 * @param schema - Any Standard-Schema-compatible validator.
 * @param value - The value to validate.
 * @returns Fulfills with the validation result.
 * @since 0.1.0
 */
export async function validate<S extends StandardSchemaV1>(
  schema: S,
  value: unknown
): Promise<StandardSchemaV1.Result<StandardSchemaV1.InferOutput<S>>> {
  const r = schema["~standard"].validate(value);
  return r instanceof Promise ? r : (r as any);
}

/**
 * Duck-typed runtime check that an unknown value looks like a Standard
 * Schema validator (has a `~standard.validate` function). Useful in helpers
 * that accept either a schema or a raw value.
 *
 * @param x - Value to test.
 * @returns `true` when `x` exposes the Standard Schema contract.
 * @since 0.1.0
 */
export function isStandardSchema(x: unknown): x is StandardSchemaV1 {
  return (
    !!x &&
    typeof x === "object" &&
    "~standard" in (x as object) &&
    typeof (x as any)["~standard"]?.validate === "function"
  );
}
