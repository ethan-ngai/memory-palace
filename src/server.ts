import { defaultStreamHandler } from "@tanstack/react-router/ssr/server";
import { createStartHandler } from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";

export default createServerEntry({
  fetch: createStartHandler({
    handler: defaultStreamHandler,
  }),
});
