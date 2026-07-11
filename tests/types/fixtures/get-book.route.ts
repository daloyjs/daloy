import { z } from "zod";

import { defineRoute } from "../../../src/types.js";

export const getBookRoute = defineRoute({
  method: "GET",
  path: "/books/:id",
  operationId: "getBook",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Book",
      body: z.object({ id: z.string(), title: z.string() }),
    },
    404: { description: "Not found" },
  },
  handler: ({ params }) => ({
    status: 200,
    body: { id: params.id, title: "Dune" },
  }),
});
