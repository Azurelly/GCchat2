import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export interface ServerEnv {
  port: number;
  clientOrigin: string;
  jwtSecret: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  supabaseAvatarsBucket: string;
  supabaseAttachmentsBucket: string;
}

export function loadEnv(): ServerEnv {
  const jwtSecret = process.env.JWT_SECRET ?? "dev-insecure-change-me";

  if (jwtSecret === "dev-insecure-change-me" && process.env.NODE_ENV !== "test") {
    console.warn("JWT_SECRET is not set. Using an insecure development secret.");
  }

  return {
    port: Number(process.env.PORT ?? 4197),
    clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
    jwtSecret,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseAvatarsBucket: process.env.SUPABASE_AVATARS_BUCKET ?? "avatars",
    supabaseAttachmentsBucket:
      process.env.SUPABASE_ATTACHMENTS_BUCKET ?? "message-attachments"
  };
}
