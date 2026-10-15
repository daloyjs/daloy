// workerd entry for the cross-runtime smoke suite (see ./shared.mjs and ./workerd.mjs).
import * as core from "../../dist/index.js";
import { toFetchHandler } from "../../dist/adapters/cloudflare.js";
import { buildSmokeApp } from "./shared.mjs";

export default toFetchHandler(buildSmokeApp(core));
