import { z } from "zod";

const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(32, "Username must be 32 characters or fewer.")
  .regex(/^[a-zA-Z0-9_.-]+$/, "Username can use letters, numbers, dots, dashes, and underscores.");

export const registerSchema = z.object({
  username: usernameSchema,
  password: z.string().min(8, "Password must be at least 8 characters.").max(128)
});

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(128)
});

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40).optional(),
    bio: z.string().max(190).optional(),
    avatarUrl: z.string().url().nullable().optional()
  })
  .strict();

export const attachmentInputSchema = z.object({
  url: z.string().url(),
  fileName: z.string().min(1).max(180),
  mimeType: z.string().min(1).max(120),
  size: z.number().int().min(1).max(10 * 1024 * 1024)
});

export const createMessageSchema = z
  .object({
    content: z.string().trim().max(4000).default(""),
    attachments: z.array(attachmentInputSchema).max(4).default([])
  })
  .refine((value) => value.content.length > 0 || value.attachments.length > 0, {
    message: "Message must include text or an attachment."
  });
