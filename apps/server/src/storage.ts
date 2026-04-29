import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { UploadKind, UploadResponse } from "@gcchat/shared";
import type { ServerEnv } from "./env";
import { HttpError } from "./errors";

export interface UploadFile {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
}

export interface AssetStorage {
  upload(kind: UploadKind, file: UploadFile): Promise<UploadResponse>;
}

const allowedAvatarMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const allowedAttachmentMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/aac",
  "audio/flac",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);
const maxFileSize = 10 * 1024 * 1024;

export class SupabaseAssetStorage implements AssetStorage {
  private readonly client: SupabaseClient;

  public constructor(private readonly env: ServerEnv) {
    if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
      throw new HttpError(503, "Supabase storage is not configured");
    }

    this.client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  public async upload(kind: UploadKind, file: UploadFile): Promise<UploadResponse> {
    validateUpload(kind, file);

    const bucket =
      kind === "avatar" ? this.env.supabaseAvatarsBucket : this.env.supabaseAttachmentsBucket;
    const objectPath = `${kind}s/${randomUUID()}-${sanitizeFileName(file.originalName)}`;

    const { error } = await this.client.storage.from(bucket).upload(objectPath, file.buffer, {
      contentType: file.mimeType,
      upsert: false
    });

    if (error) {
      throw new HttpError(502, "Could not upload file", error.message);
    }

    const { data } = this.client.storage.from(bucket).getPublicUrl(objectPath);

    return {
      url: data.publicUrl,
      fileName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      kind
    };
  }
}

export class DisabledAssetStorage implements AssetStorage {
  public async upload(_kind: UploadKind, _file: UploadFile): Promise<UploadResponse> {
    throw new HttpError(503, "Supabase storage is not configured");
  }
}

export class MemoryAssetStorage implements AssetStorage {
  public async upload(kind: UploadKind, file: UploadFile): Promise<UploadResponse> {
    validateUpload(kind, file);

    return {
      url: `https://assets.local/${kind}/${randomUUID()}-${sanitizeFileName(file.originalName)}`,
      fileName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      kind
    };
  }
}

export function createAssetStorage(env: ServerEnv): AssetStorage {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    return new DisabledAssetStorage();
  }

  return new SupabaseAssetStorage(env);
}

function validateUpload(kind: UploadKind, file: UploadFile) {
  const allowedMimeTypes =
    kind === "avatar" || kind === "emoji" ? allowedAvatarMimeTypes : allowedAttachmentMimeTypes;

  if (!allowedMimeTypes.has(file.mimeType)) {
    throw new HttpError(
      400,
      kind === "avatar" || kind === "emoji"
        ? "Only JPG, PNG, WebP, and GIF images are supported"
        : "This file type is not supported yet"
    );
  }

  if (file.size > maxFileSize) {
    throw new HttpError(400, "Files must be 10 MB or smaller");
  }
}

function sanitizeFileName(fileName: string) {
  const extension = path.extname(fileName).slice(0, 12);
  const baseName = path.basename(fileName, extension).replace(/[^a-zA-Z0-9_.-]/g, "-");
  return `${baseName.slice(0, 80) || "upload"}${extension}`;
}
