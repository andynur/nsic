import { dashboard } from "../db/repo/dashboard.ts";
import { getProject } from "../db/repo/projects.ts";
import { s } from "../lib/schema.ts";
import { h, json, q, HttpError, notFound } from "./http.ts";

export const dashboardRoutes = {
  "/api/dashboard": {
    GET: h(req => {
      const query = q(req);
      const parsed = s.object({ days: s.enum(["7", "30"] as const), project: s.string({ min: 1, max: 100 }).optional() }).parse({
        days: query.get("days") ?? "30", ...(query.has("project") ? { project: query.get("project") } : {}),
      });
      if (!parsed.ok) throw new HttpError(400, "validation", "Use days=7 or days=30 and a valid project ID");
      const { days, project } = parsed.value;
      if (project && !getProject(project)) notFound("project");
      return json(dashboard(days === "7" ? 7 : 30, project));
    }),
  },
};
