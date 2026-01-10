import { Type } from "@sinclair/typebox";

import { createReactionSchema } from "./reaction-schema.js";

export const WhatsAppToolSchema = Type.Union([
  createReactionSchema({
    ids: {
      chatJid: Type.String(),
      messageId: Type.String(),
    },
    includeRemove: true,
    extras: {
      participant: Type.Optional(Type.String()),
      accountId: Type.Optional(Type.String()),
      fromMe: Type.Optional(Type.Boolean()),
    },
  }),
  Type.Object({
    action: Type.Literal("send"),
    to: Type.String({ description: "The recipient JID (E.164 or group JID)" }),
    text: Type.Optional(Type.String({ description: "Message body" })),
    media: Type.Optional(Type.String({ description: "Path to media file to attach" })),
    accountId: Type.Optional(Type.String()),
  }),
]);
