// SPA router using URLPattern + History API (14 §1), no library.
import { createContext, useContext, useEffect, useState, type ReactNode, type MouseEvent } from "react";

type Match = { name: string; params: Record<string, string> };
export type RouteDef = { name: string; pattern: string };

const RouterCtx = createContext<{ path: string; match: Match | null; navigate: (to: string) => void }>({ path: "/", match: null, navigate: () => {} });

export function navigate(to: string) {
  if (to === location.pathname + location.search) return;
  history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}

export function Router({ routes, children }: { routes: RouteDef[]; children: ReactNode }) {
  const [path, setPath] = useState(location.pathname + location.search);
  useEffect(() => {
    const on = () => {
      setPath(location.pathname + location.search);
      window.scrollTo(0, 0);
    };
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  let match: Match | null = null;
  for (const r of routes) {
    const m = new URLPattern({ pathname: r.pattern }).exec({ pathname: location.pathname });
    if (m) {
      match = { name: r.name, params: Object.fromEntries(Object.entries(m.pathname.groups).map(([k, v]) => [k, decodeURIComponent(v ?? "")])) };
      break;
    }
  }
  return <RouterCtx.Provider value={{ path, match, navigate }}>{children}</RouterCtx.Provider>;
}

export const useRoute = () => useContext(RouterCtx);
export const useQuery = () => new URLSearchParams(useContext(RouterCtx).path.split("?")[1] ?? "");

export function Link({ to, children, className, ...rest }: { to: string; children: ReactNode; className?: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const { path } = useRoute();
  const current = path.split("?")[0] === to || (to !== "/" && path.startsWith(to + "/"));
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} className={className} aria-current={current ? "page" : undefined} {...rest}>
      {children}
    </a>
  );
}
