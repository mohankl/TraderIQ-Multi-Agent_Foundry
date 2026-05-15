import { NextRequest, NextResponse } from "next/server";

export default function proxy(req: NextRequest) {
  if (req.nextUrl.pathname === "/api/copilotkit/run") {
    const url = req.nextUrl.clone();
    url.pathname = "/api/copilotkit/run/_";
    return NextResponse.rewrite(url);
  }
}

export const config = {
  matcher: "/api/copilotkit/run",
};
