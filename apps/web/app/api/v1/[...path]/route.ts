import { route as platformRoute } from "../../../../src/routes";
import { collectorRoute } from "../../../../src/collector-routes";
function route(request: Request) {
  const path = new URL(request.url).pathname.slice("/api/v1/".length);
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
