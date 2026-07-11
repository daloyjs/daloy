import { z } from "zod";

import { defineRoute } from "../../../src/types.js";

export const listBooksRoute = defineRoute({
  method: "GET",
  path: "/books",
  operationId: "listBooks",
  responses: {
    200: {
      description: "Books",
      body: z.array(z.object({ id: z.string(), title: z.string() })),
    },
  },
  handler: () => ({ status: 200, body: [{ id: "1", title: "Dune" }] }),
});
