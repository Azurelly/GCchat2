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

export const updateAccountSchema = z
  .object({
    username: usernameSchema.optional(),
    currentPassword: z.string().min(1).max(128).optional(),
    newPassword: z.string().min(8, "Password must be at least 8 characters.").max(128).optional()
  })
  .strict()
  .refine((value) => !value.newPassword || value.currentPassword, {
    message: "Current password is required to change password.",
    path: ["currentPassword"]
  });

export const attachmentInputSchema = z.object({
  url: z.string().url(),
  fileName: z.string().min(1).max(180),
  mimeType: z.string().min(1).max(120),
  size: z.number().int().min(1).max(10 * 1024 * 1024)
});

export const createMessageSchema = z
  .object({
    content: z.string().trim().max(4000).default(""),
    replyToId: z.string().min(1).max(80).nullable().optional(),
    attachments: z.array(attachmentInputSchema).max(4).default([])
  })
  .refine((value) => value.content.length > 0 || value.attachments.length > 0, {
    message: "Message must include text or an attachment."
  });

export const toggleMessageReactionSchema = z
  .object({
    emoji: z.string().trim().min(1).max(80)
  })
  .strict();

export const channelNameSchema = z
  .string()
  .trim()
  .min(1, "Channel name is required.")
  .max(32, "Channel name must be 32 characters or fewer.")
  .regex(/^[a-zA-Z0-9 -]+$/, "Channel names can use letters, numbers, spaces, and dashes.");

export const createChannelSchema = z
  .object({
    name: channelNameSchema
  })
  .strict();

export const deleteChannelSchema = z
  .object({
    confirmationName: z.string().min(1).max(32)
  })
  .strict();

export const updateUserRoleSchema = z
  .object({
    role: z.enum(["USER", "ADMIN"])
  })
  .strict();

export const updateUserBanSchema = z
  .object({
    banned: z.boolean()
  })
  .strict();

export const createCalendarEventSchema = z
  .object({
    title: z.string().trim().min(1, "Event title is required.").max(90),
    description: z.string().trim().max(800).default(""),
    startAt: z.string().datetime({ offset: true })
  })
  .strict();

export const setCalendarEventOptInSchema = z
  .object({
    optedIn: z.boolean()
  })
  .strict();

const customEmojiNameSchema = z
  .string()
  .trim()
  .min(2, "Emoji name must be at least 2 characters.")
  .max(32, "Emoji name must be 32 characters or fewer.")
  .regex(/^[a-z0-9_]+$/i, "Emoji names can use letters, numbers, and underscores.");

export const createCustomEmojiSchema = z
  .object({
    name: customEmojiNameSchema,
    imageUrl: z.string().url()
  })
  .strict();

export const updateCustomEmojiSchema = z
  .object({
    name: customEmojiNameSchema.optional(),
    imageUrl: z.string().url().optional()
  })
  .strict();
