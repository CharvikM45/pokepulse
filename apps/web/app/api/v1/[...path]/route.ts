import { cardRoute } from "../../../../src/card-routes";
import { route as platformRoute } from "../../../../src/routes";
import { collectorRoute } from "../../../../src/collector-routes";
function route(request: Request) {
  const path = new URL(request.url).pathname.slice("/api/v1/".length);
  if (
    /^(cards(?:\/|$)|card-sets(?:\/|$)|artists(?:\/|$)|me\/(?:portfolio(?:\/|$)|card-actions(?:\/|$)|card-holdings$|collection-lots(?:\/|$)|collection-export$|collection-import$)|admin\/card-catalog$)/.test(
      path,
    )
  )
    return cardRoute(request);
  return /^(sets(?:\/|$)|stores(?:\/|$)|releases$|sightings(?:\/|$)|packs\/open$|me\/(?:lab$|pack-openings(?:\/|$)|collections(?:\/|$))|admin\/(?:collector(?:\/|$)|sightings(?:\/|$)))/.test(
    path,
  )
    ? collectorRoute(request)
    : platformRoute(request);
}
export const dynamic = "force-dynamic";
export const GET = route,
  POST = route,
  PATCH = route,
  DELETE = route;
