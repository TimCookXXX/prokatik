import type { DefaultSession } from "next-auth";
import type { SignupFacts } from "@/lib/analytics/signup";

declare module "next-auth" {
  interface User {
    role?: "user" | "moderator" | "admin";
    bannedAt?: Date | null;
    banReason?: string | null;
    bio?: string | null;
    createdAt?: Date;
  }

  interface Session {
    user: {
      id: string;
      role: "user" | "moderator" | "admin";
      bannedAt: Date | null;
      banReason: string | null;
      /** Создание и подтверждение почты — для цели `signup` (lib/analytics/signup.ts). */
      signup: SignupFacts;
    } & DefaultSession["user"];
  }
}
