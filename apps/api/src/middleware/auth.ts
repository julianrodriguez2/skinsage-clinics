import { NextFunction, Request, Response } from "express";
import { AuthContext, verifyAccessToken } from "../auth";
import { Role } from "../types";

export interface AuthenticatedRequest extends Request {
  user?: AuthContext;
}

export function requireAuth() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing token" });
    }
    const token = header.replace("Bearer ", "");
    const ctx = verifyAccessToken(token);
    if (!ctx) return res.status(401).json({ error: "Invalid or expired token" });
    req.user = ctx;
    next();
  };
}

export function requireRole(roles: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userRole = req.user?.role;
    if (!userRole) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(userRole)) {
      return res.status(403).json({ error: "Forbidden: insufficient role" });
    }
    next();
  };
}
