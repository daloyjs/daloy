/**
 * Comment and string stripping shared by the source-scanning CI gates.
 *
 * The gates used to track block comments line by line with
 * `line.lastIndexOf("/*")` on the raw text. A wildcard route (`"/*"`) or a
 * media type (`"*\/*"`) inside a string therefore looked like a comment
 * opener and silently switched the gate off until the next `*\/`, and a
 * template literal was blanked whole, hiding any call inside `${...}`.
 *
 * This walks the whole file once as a small state machine (code, the three
 * string kinds with `${}` nesting, regex literals, `//` and block comments)
 * so "is this character code?" is decided by syntax, not by a per-line guess.
 */

/** Per-line views of a source file, index-aligned with `source.split(/\r?\n/)`. */
export interface StrippedSource {
  /** Comments removed; string, template and regex literals kept verbatim. */
  readonly noComments: readonly string[];
  /**
   * Comments removed and the text of string and template literals blanked
   * (quotes kept, so `"x"` becomes `""`). Code inside `${...}` is kept, and
   * regex literals are kept verbatim.
   */
  readonly code: readonly string[];
}

/** Characters after which a `/` starts a regex literal rather than a division. */
const REGEX_PRECEDERS = new Set("(,=:[!&|?{};+-*%<>~^".split(""));
const REGEX_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|case|in|of|delete|void|throw|new|yield|await)$/;

/**
 * Split `source` into lines with comments removed, in two flavours.
 *
 * @param source - Full text of a JavaScript or TypeScript file.
 * @returns The comment-free lines, with and without literal text.
 */
export function stripSource(source: string): StrippedSource {
  const noComments: string[] = [];
  const code: string[] = [];
  let keep = "";
  let bare = "";
  const flush = (): void => {
    noComments.push(keep);
    code.push(bare);
    keep = "";
    bare = "";
  };

  type Mode = "code" | "single" | "double" | "template" | "regex" | "line" | "block";
  let mode: Mode = "code";
  /** Brace depth inside each open `${...}`; one entry per nested template. */
  const templateDepths: number[] = [];
  let regexInClass = false;
  const n = source.length;

  for (let i = 0; i < n; i++) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === "\r" && next === "\n") continue;
    if (c === "\n") {
      if (mode === "line") mode = "code";
      // An unterminated quote or regex cannot span lines; recover as code.
      if (mode === "single" || mode === "double" || mode === "regex") mode = "code";
      flush();
      continue;
    }
    switch (mode) {
      case "code": {
        if (c === "/" && next === "/") {
          mode = "line";
          i++;
        } else if (c === "/" && next === "*") {
          mode = "block";
          i++;
        } else if (c === "'" || c === '"' || c === "`") {
          mode = c === "'" ? "single" : c === '"' ? "double" : "template";
          keep += c;
          bare += c;
        } else if (c === "/" && startsRegex(bare)) {
          mode = "regex";
          regexInClass = false;
          keep += c;
          bare += c;
        } else {
          if (templateDepths.length > 0) {
            if (c === "{") templateDepths[templateDepths.length - 1]!++;
            else if (c === "}") {
              if (templateDepths[templateDepths.length - 1] === 0) {
                templateDepths.pop();
                mode = "template";
                keep += c;
                bare += c;
                break;
              }
              templateDepths[templateDepths.length - 1]!--;
            }
          }
          keep += c;
          bare += c;
        }
        break;
      }
      case "single":
      case "double": {
        const quote = mode === "single" ? "'" : '"';
        keep += c;
        if (c === "\\" && next !== undefined && next !== "\n") {
          keep += next;
          i++;
        } else if (c === quote) {
          bare += c;
          mode = "code";
        }
        break;
      }
      case "template": {
        keep += c;
        if (c === "\\" && next !== undefined && next !== "\n") {
          keep += next;
          i++;
        } else if (c === "`") {
          bare += c;
          mode = "code";
        } else if (c === "$" && next === "{") {
          keep += next;
          bare += "${";
          i++;
          templateDepths.push(0);
          mode = "code";
        }
        break;
      }
      case "regex": {
        keep += c;
        bare += c;
        if (c === "\\" && next !== undefined && next !== "\n") {
          keep += next;
          bare += next;
          i++;
        } else if (c === "[") regexInClass = true;
        else if (c === "]") regexInClass = false;
        else if (c === "/" && !regexInClass) mode = "code";
        break;
      }
      case "line":
        break;
      case "block": {
        if (c === "*" && next === "/") {
          mode = "code";
          i++;
          // A comment separates tokens: `a/**/b` must not read as `ab`.
          keep += " ";
          bare += " ";
        }
        break;
      }
    }
  }
  flush();
  return { noComments, code };
}

/** True when a `/` following `before` (the code so far on this line) opens a regex literal. */
function startsRegex(before: string): boolean {
  const trimmed = before.trimEnd();
  if (trimmed.length === 0) return true;
  const last = trimmed[trimmed.length - 1]!;
  if (REGEX_PRECEDERS.has(last)) return true;
  return REGEX_KEYWORDS.test(trimmed);
}
