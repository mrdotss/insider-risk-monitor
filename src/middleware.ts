import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  // Public routes that don't require authentication
  const publicRoutes = ["/login", "/api/auth", "/api/ingest"];
  const isPublicRoute = publicRoutes.some(
    (route) => nextUrl.pathname.startsWith(route)
  );

  // API routes for ingestion don't need session auth (they use API keys)
  if (nextUrl.pathname.startsWith("/api/ingest")) {
    return NextResponse.next();
  }

  // Allow public routes
  if (isPublicRoute) {
    // Redirect to home if already logged in and trying to access login
    if (isLoggedIn && nextUrl.pathname === "/login") {
      return NextResponse.redirect(new URL("/", nextUrl));
    }
    return NextResponse.next();
  }

  // Redirect to login if not authenticated
  if (!isLoggedIn) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Match all routes except static files and _next
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
